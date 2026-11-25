import { documentRecordTypes } from './canvas-documents.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { createCanvasStorage, canvasDir as defaultRoot, readJsonFile, writeJsonAtomic } from './storage.mjs'
import { httpError, withFileLock } from './file-lock.mjs'

export function createConversations(root = defaultRoot) {
  root = resolve(root)
  const directory = join(root, 'conversations')
  const indexFile = join(directory, 'index.json')
  const storageFor = id => createCanvasStorage(id === 'legacy' ? root : join(directory, id))
  const lock = (id, fn) => withFileLock(join(directory, `${id}.lock`), fn)
  const stateFile = id => join(directory, id, 'state.json')
  const now = () => new Date().toISOString()
  function validId(id) {
    if (typeof id !== 'string' || !/^(legacy|[a-f0-9-]{36})$/.test(id)) throw httpError('无效的对话 ID。')
    return id
  }
  async function index() {
    try {
      const data = await readJsonFile(indexFile)
      if (data.version !== 1 || !Array.isArray(data.conversations) || !data.bindings) throw new Error('Invalid conversation index')
      return data
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return { version: 1, conversations: [{ id: 'legacy', title: '我的画板', createdAt: now() }], bindings: {} }
    }
  }
  async function requireConversation(id) {
    validId(id)
    const conversation = (await index()).conversations.find(c => c.id === id)
    if (!conversation) throw httpError('找不到这个对话，请检查对话 ID；未创建替代对话。', 404)
    return conversation
  }
  function title(value) {
    if (value === undefined) return '新对话'
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) throw httpError('对话名称需要 1 至 100 个字。')
    return value.trim()
  }
  async function open({ conversationId, bindingKey, title: name, createNew = false } = {}) {
    if (createNew && conversationId) throw httpError('新建对话时不能同时指定已有对话 ID。')
    if (bindingKey !== undefined && (typeof bindingKey !== 'string' || !bindingKey.trim() || bindingKey.length > 500)) throw httpError('需要有效的外部会话键。')
    const key = bindingKey === undefined ? null : createHash('sha256').update(bindingKey).digest('hex')
    return lock('index', async () => {
      const data = await index()
      const boundId = key && data.bindings[key]
      if (boundId && !createNew && conversationId && conversationId !== boundId) throw httpError('这个会话键已绑定其他对话；请使用原对话，或明确新建。', 409)
      const id = createNew ? undefined : conversationId || boundId
      let conversation
      if (id) {
        validId(id)
        conversation = data.conversations.find(c => c.id === id)
        if (!conversation) throw httpError('找不到指定对话，未创建替代对话。', 404)
      } else {
        conversation = { id: randomUUID(), title: title(name), createdAt: now() }
        data.conversations.push(conversation)
      }
      if (key) data.bindings[key] = conversation.id
      await writeJsonAtomic(indexFile, data)
      return conversation
    })
  }
  async function qualify(snapshot, id) {
    if (!snapshot) return snapshot
    function resource(value) {
      if (typeof value !== 'string') return value
      let parsed
      try { parsed = new URL(value, 'http://hicanvas.local') } catch { return value }
      const local = ['hicanvas.local', 'localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      if (!local || !/^\/(?:assets|page-assets|c)\//.test(parsed.pathname)) return value
      const normalized = /^\/(assets|page-assets)\//.test(parsed.pathname) ? `/c/${id}${parsed.pathname}` : parsed.pathname
      // URL 会折叠普通及百分号编码的 ..；只比较原始前缀会漏过跨对话地址。
      if (!normalized.startsWith(`/c/${id}/assets/`) && !normalized.startsWith(`/c/${id}/page-assets/`)) throw httpError('不能引用另一个对话的本机资源。')
      return `${normalized}${parsed.search}${parsed.hash}`
    }
    const result = structuredClone(snapshot)
    for (const record of Object.values(result.store)) {
      if (record.typeName === 'asset' && record.props) {
        for (const field of ['src', 'favicon']) if (field in record.props) record.props[field] = resource(record.props[field])
      }
      if (record.typeName === 'shape' && record.props && 'url' in record.props) record.props.url = resource(record.props.url)
      if (record.typeName === 'user') record.imageUrl = resource(record.imageUrl)
    }
    return result
  }
  async function checked(snapshot) {
    const { sanitizeCanvasSnapshotForServer } = storageFor('legacy')
    if (!snapshot?.store || Object.entries(snapshot.store).some(([key, record]) => record?.id !== key || !documentRecordTypes.has(record?.typeName))) throw httpError('画板记录 ID 或类型无效。')
    const result = await sanitizeCanvasSnapshotForServer(snapshot)
    if (!result.snapshot || result.skippedRecords.length || Object.keys(result.snapshot.store).some(k => result.snapshot.store[k]?.id !== k) || !Object.values(result.snapshot.store).some(r => r.typeName === 'page')) throw httpError('画板含无效记录；已拒绝保存，原内容保持不变。')
    const records = result.snapshot.store
    for (const record of Object.values(records)) {
      if (record.typeName !== 'shape') continue
      let parent = records[record.parentId]
      const visited = new Set([record.id])
      while (parent?.typeName === 'shape') {
        if (visited.has(parent.id)) throw httpError('形状的父子关系形成循环。')
        visited.add(parent.id)
        parent = records[parent.parentId]
      }
      if (parent?.typeName !== 'page') throw httpError('形状必须属于有效页面。')
    }
    return result.snapshot
  }
  async function readState(id) {
    let state
    try { state = await readJsonFile(stateFile(id)) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const legacy = id === 'legacy' ? (await storageFor(id).loadCanvasSnapshot()).snapshot : null
      const { createCowartSnapshotWithDefaultPage } = await import('../src/canvasSnapshot.js')
      const initial = legacy ?? createCowartSnapshotWithDefaultPage()
      if (!legacy) for (const record of Object.values(initial.store)) if (record.typeName === 'page') record.name = '第 1 页'
      state = { revision: randomUUID(), snapshot: await checked(initial) }
      state.snapshot = await qualify(state.snapshot, id)
      await writeJsonAtomic(stateFile(id), state)
    }
    if (typeof state.revision !== 'string' || !state.snapshot) throw new Error('损坏的画板文件，已停止读取。')
    await checked(state.snapshot)
    return { ...state, conversationId: id, storage: 'conversation' }
  }
  async function read(id) {
    await requireConversation(id)
    return lock(id, () => readState(id))
  }
  async function mutate(id, expectedRevision, transform) {
    await requireConversation(id)
    return lock(id, async () => {
      const current = await readState(id)
      if (typeof expectedRevision !== 'string' || !expectedRevision) throw httpError('写入前必须读取画板并提供版本。', 428)
      if (expectedRevision !== current.revision) throw httpError('画板已被其他操作更新。请读取最新版本后合并修改。', 409, { storage: 'revision-conflict', revision: current.revision })
      const snapshot = await qualify(await checked(await transform(structuredClone(current.snapshot))), id)
      const result = { snapshot, revision: randomUUID(), updatedAt: now() }
      await writeJsonAtomic(stateFile(id), result)
      return { ...result, previousRevision: current.revision, conversationId: id, storage: 'conversation', ok: true }
    })
  }
  async function sidecar(id, type, value) {
    await requireConversation(id)
    const store = createCanvasStorage(join(directory, id))
    const path = type === 'view' ? store.viewStateFile : store.selectionFile
    if (value !== undefined) return lock(id, async () => { await writeJsonAtomic(path, value); return value })
    try { return await readJsonFile(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (id === 'legacy') {
      const original = storageFor(id)
      try { return await readJsonFile(type === 'view' ? original.viewStateFile : original.selectionFile) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return null
  }
  return {
    root, open, requireConversation, read, mutate, sidecar,
    storageFor: async id => { await requireConversation(id); return storageFor(id) },
    assetsDir: async id => { const s = await requireConversation(id); return join(s.id === 'legacy' ? root : join(directory, id), 'assets') },
    async list() { return (await index()).conversations.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)) },
    async rename(id, name) {
      return lock('index', async () => {
        const data = await index()
        const conversation = data.conversations.find(c => c.id === validId(id))
        if (!conversation) throw httpError('找不到这个对话。', 404)
        conversation.title = title(name)
        await writeJsonAtomic(indexFile, data)
        return conversation
      })
    }
  }
}

export const conversations = createConversations()
