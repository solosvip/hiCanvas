import { documentRecordTypes } from './canvas-documents.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { createCanvasStorage, canvasDir as defaultRoot, readJsonFile, writeJsonAtomic } from './storage.mjs'
import { httpError, withFileLock } from './file-lock.mjs'
import { mergeLegacyPages, restoreSingleCanvasView, singlePageId } from './single-canvas.mjs'

export function createConversations(root = defaultRoot) {
  root = resolve(root)
  const directory = join(root, 'conversations')
  const indexFile = join(directory, 'index.json')
  const storageFor = id => createCanvasStorage(id === 'legacy' ? root : join(directory, id))
  const lock = (id, fn) => withFileLock(join(directory, `${id}.lock`), fn)
  const stateFile = id => join(directory, id, 'state.json')
  const now = () => new Date().toISOString()
  function validId(id) {
    if (typeof id !== 'string' || !/^(legacy|[a-f0-9-]{36})$/.test(id)) throw httpError('无效的画板 ID。')
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
    if (!conversation) throw httpError('找不到这个画板，请检查画板 ID；未创建替代画板。', 404)
    if (conversation.deletedAt) throw httpError('这个画板已删除，请选择其他画板或明确新建。', 410, { storage: 'conversation-deleted' })
    return conversation
  }
  function title(value) {
    if (value === undefined) return '新画板'
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) throw httpError('画板名称需要 1 至 100 个字。')
    return value.trim()
  }
  async function open({ conversationId, bindingKey, title: name, createNew = false } = {}) {
    if (createNew && conversationId) throw httpError('新建画板时不能同时指定已有画板 ID。')
    if (bindingKey !== undefined && (typeof bindingKey !== 'string' || !bindingKey.trim() || bindingKey.length > 500)) throw httpError('需要有效的外部会话键。')
    const key = bindingKey === undefined ? null : createHash('sha256').update(bindingKey).digest('hex')
    return lock('index', async () => {
      const data = await index()
      const boundId = key && data.bindings[key]
      if (boundId && !createNew && conversationId && conversationId !== boundId) throw httpError('这个会话键已绑定其他画板；请使用原画板，或明确新建。', 409)
      const id = createNew ? undefined : conversationId || boundId
      let conversation
      if (id) {
        validId(id)
        conversation = data.conversations.find(c => c.id === id)
        if (!conversation) throw httpError('找不到指定画板，未创建替代画板。', 404)
        if (conversation.deletedAt) throw httpError('这个画板已删除，请选择其他画板或明确新建。', 410, { storage: 'conversation-deleted' })
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
      // URL 会折叠普通及百分号编码的 ..；只比较原始前缀会漏过跨画板地址。
      if (!normalized.startsWith(`/c/${id}/assets/`) && !normalized.startsWith(`/c/${id}/page-assets/`)) throw httpError('不能引用另一个画板的本机资源。')
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
    const merged = structuredClone(state.snapshot)
    const migration = mergeLegacyPages(merged)
    if (migration) {
      const archive = join(directory, id, 'before-single-canvas.json')
      try { await readJsonFile(archive) } catch (error) {
        if (error.code !== 'ENOENT') throw error
        await writeJsonAtomic(archive, state)
      }
      state = { ...state, snapshot: await checked(merged), revision: randomUUID(), singleCanvasMigration: migration }
      await writeJsonAtomic(stateFile(id), state)
    }
    return { ...state, conversationId: id, storage: 'conversation' }
  }
  async function read(id) {
    validId(id)
    return lock(id, async () => { await requireConversation(id); return readState(id) })
  }
  async function mutate(id, expectedRevision, transform) {
    validId(id)
    return lock(id, async () => {
      await requireConversation(id)
      const current = await readState(id)
      if (typeof expectedRevision !== 'string' || !expectedRevision) throw httpError('写入前必须读取画板并提供版本。', 428)
      if (expectedRevision !== current.revision) throw httpError('画板已被其他操作更新。请读取最新版本后合并修改。', 409, { storage: 'revision-conflict', revision: current.revision })
      const snapshot = await qualify(await checked(await transform(structuredClone(current.snapshot))), id)
      if (singlePageId(snapshot) !== singlePageId(current.snapshot)) throw httpError('不能替换画板的内部画布。')
      const result = { snapshot, revision: randomUUID(), updatedAt: now(), ...(current.singleCanvasMigration && { singleCanvasMigration: current.singleCanvasMigration }) }
      await writeJsonAtomic(stateFile(id), result)
      return { ...result, previousRevision: current.revision, conversationId: id, storage: 'conversation', ok: true }
    })
  }
  async function sidecar(id, type, value) {
    await requireConversation(id)
    const store = createCanvasStorage(join(directory, id))
    const path = type === 'view' ? store.viewStateFile : store.selectionFile
    const normalize = async data => type === 'view' ? restoreSingleCanvasView(data, (await read(id)).singleCanvasMigration) : data
    if (value !== undefined) {
      const normalized = await normalize(value)
      return lock(id, async () => { await requireConversation(id); await writeJsonAtomic(path, normalized); return normalized })
    }
    try { return await normalize(await readJsonFile(path)) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (id === 'legacy') {
      const original = storageFor(id)
      try { return await normalize(await readJsonFile(type === 'view' ? original.viewStateFile : original.selectionFile)) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return null
  }
  return {
    root, open, requireConversation, read, mutate, sidecar,
    withActiveConversation(id, operation) {
      validId(id)
      return lock(`lifecycle-${id}`, async () => { await requireConversation(id); return operation() })
    },
    storageFor: async id => { await requireConversation(id); return storageFor(id) },
    assetsDir: async id => { const s = await requireConversation(id); return join(s.id === 'legacy' ? root : join(directory, id), 'assets') },
    async list() { return (await index()).conversations.filter(c => !c.deletedAt).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)) },
    async remove(id, expectedRevision) {
      validId(id)
      if (!expectedRevision) throw httpError('删除前必须读取画板并提供版本。', 428)
      // 与保存共用画板锁；索引仅追加删除标记，原文件与旧绑定保留，避免迟到写入或重连复活。
      return lock(`lifecycle-${id}`, () => lock(id, () => lock('index', async () => {
        const data = await index()
        const conversation = data.conversations.find(c => c.id === id)
        if (!conversation) throw httpError('找不到这个画板。', 404)
        if (!conversation.deletedAt) {
          const current = await readState(id)
          if (expectedRevision !== current.revision) throw httpError('画板已更新，请检查最新内容后再删除。', 409, { storage: 'revision-conflict', revision: current.revision })
          conversation.deletedAt = now()
          await writeJsonAtomic(indexFile, data)
        }
        const next = data.conversations.filter(c => !c.deletedAt).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        return { ok: true, conversationId: id, nextConversationId: next?.id || null }
      })))
    },
    async rename(id, name) {
      return lock('index', async () => {
        const data = await index()
        const conversation = data.conversations.find(c => c.id === validId(id))
        if (!conversation) throw httpError('找不到这个画板。', 404)
        if (conversation.deletedAt) throw httpError('这个画板已删除。', 410, { storage: 'conversation-deleted' })
        conversation.title = title(name)
        await writeJsonAtomic(indexFile, data)
        return conversation
      })
    }
  }
}

export const conversations = createConversations()
