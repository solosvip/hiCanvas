import { randomUUID } from 'node:crypto'
import { join, resolve, basename, relative, sep } from 'node:path'
import { realpath, lstat } from 'node:fs/promises'
import { withFileLock, httpError } from './file-lock.mjs'
import { createAttemptFiles } from './asset-attempt-files.mjs'

// Lock order: 上传队列 → 画板锁. Save checks/protection run inside the board
// lock and never wait for an upload queue: reversing this order deadlocks a
// cancellation waiting for a save that is itself waiting for that cancellation.
export const mediaImportLimits = Object.freeze({ leaseMs: 300000, perBoard: 8, perWorkspace: 32, files: 100, retries: 2, retryMs: 1000 })
const managers = new Map()
const boardDir = (root, id) => id === 'legacy' ? root : join(root, 'conversations', id)
const boardLock = (root, id, operation) => withFileLock(join(root, 'conversations', `${id}.lock`), operation)
function resourceUrls(snapshot, id) {
  const urls = new Set()
  function add(value) {
    if (typeof value !== 'string') return
    let url
    try { url = new URL(value, 'http://hicanvas.local') } catch { return }
    if (!['hicanvas.local', 'localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return
    const path = /^\/assets\//.test(url.pathname) ? `/c/${id}${url.pathname}` : url.pathname
    const prefix = `/c/${id}/assets/`
    if (!path.startsWith(prefix)) return
    let name
    try { name = decodeURIComponent(path.slice(prefix.length)) } catch { return }
    if (!name.includes('-media-import-')) return
    if (!name || basename(name) !== name || /[\\/]/.test(name)) throw httpError('导入资源路径无效。')
    urls.add(prefix + encodeURIComponent(name))
  }
  for (const record of Object.values(snapshot.store)) {
    if (record.typeName === 'asset') for (const key of ['src', 'image', 'favicon']) add(record.props?.[key])
    if (record.typeName === 'shape') { add(record.props?.url); add(record.meta?.cowartHtmlDraftAssetUrl) }
    if (record.typeName === 'user') add(record.imageUrl)
  }
  return urls
}
async function existingFile(root, id, url) {
  const base = await realpath(boardDir(root, id)), dir = await realpath(join(boardDir(root, id), 'assets')), delta = relative(base, dir)
  if (delta === '..' || delta.startsWith('..' + sep) || delta.startsWith(sep)) throw httpError('导入资源目录无效。', 403)
  const file = await lstat(join(dir, decodeURIComponent(url.split('/').at(-1))))
  if (!file.isFile()) throw httpError('导入资源已经失效。', 409)
}

// The two hooks are the only integration into the common save path. Checking
// only newly introduced import URLs preserves legacy missing-asset semantics.
export async function checkMediaImportFiles(root, id, before, after) {
  const previous = resourceUrls(before, id), manager = managers.get(resolve(root))
  for (const url of resourceUrls(after, id)) {
    if (previous.has(url)) continue
    if (manager?.owners.get(url)?.state === 'closing') throw httpError('本次媒体导入已取消。', 409)
    try { await existingFile(root, id, url) } catch (error) {
      if (error.status) throw error
      throw httpError('导入资源已经失效，请重新导入。', 409)
    }
  }
}
export function protectMediaImportFiles(root, id, snapshot) {
  const manager = managers.get(resolve(root))
  if (!manager) return
  for (const url of resourceUrls(snapshot, id)) {
    const attempt = manager.owners.get(url)
    if (!attempt) continue
    attempt.files.protect(new Set([url])); manager.owners.delete(url)
    // An earlier item may be saved by another actor while the next upload is
    // queued. Retain the credential and lease until the entire batch arrived.
    if (!attempt.files.size && attempt.state === 'active' && attempt.count === attempt.expectedFiles) manager.finish(attempt)
  }
}

export function createMediaImportAttempts(workspace) {
  const root = resolve(workspace.root)
  if (managers.has(root)) return managers.get(root).api
  const attempts = new Map(), owners = new Map(), ended = new Map()
  const actorValid = actor => { if (typeof actor !== 'string' || !actor.trim() || actor.length > 300) throw httpError('导入需要有效操作者。') }
  function finish(attempt) {
    clearTimeout(attempt.timer); attempts.delete(attempt.token)
    ended.set(attempt.token, { id: attempt.id, actor: attempt.actor, until: Date.now() + mediaImportLimits.leaseMs })
    while (ended.size > mediaImportLimits.perWorkspace) ended.delete(ended.keys().next().value)
  }
  function serial(attempt, operation) {
    const pending = attempt.queue.then(operation)
    attempt.queue = pending.catch(() => {})
    return pending
  }
  function lookup(id, token, actor) {
    actorValid(actor)
    const attempt = attempts.get(token)
    if (!attempt || attempt.id !== id || attempt.actor !== actor) throw httpError('本次导入凭证无效或已结束。', 403)
    return attempt
  }
  async function cleanup(attempt) {
    return serial(attempt, async () => {
      let result
      try {
        // Never recreate a removed workspace merely to acquire its lock.
        await lstat(boardDir(root, attempt.id))
        result = await boardLock(root, attempt.id, async () => {
          attempt.state = 'closing'
          return attempt.files.rollback()
        })
      } catch (error) {
        result = error.code === 'ENOENT' ? await attempt.files.rollback() : { removed: 0, remaining: attempt.files.size, failures: [error] }
      }
      for (const [url, owner] of owners) if (owner === attempt && !attempt.files.has(url)) owners.delete(url)
      if (!result.remaining) finish(attempt)
      else if (attempt.retries++ < mediaImportLimits.retries) {
        attempt.timer = setTimeout(() => { void cleanup(attempt).catch(() => {}) }, mediaImportLimits.retryMs); attempt.timer.unref?.()
      }
      return { removed: result.removed, remaining: result.remaining, cleanupFailed: result.failures.length }
    })
  }
  function close(attempt) { attempt.stopping = true; clearTimeout(attempt.timer); return cleanup(attempt) }
  const api = {
    async begin(id, actor, expectedFiles = mediaImportLimits.files, guard) {
      actorValid(actor); await workspace.requireConversation(id)
      if (!Number.isInteger(expectedFiles) || expectedFiles < 1 || expectedFiles > mediaImportLimits.files) throw httpError('媒体文件数量必须在1到100之间。')
      if (guard !== undefined) {
        if (!guard || Object.keys(guard).length !== 3 || !['expectedRevision', 'recordBasis', 'intent'].every(key => Object.hasOwn(guard, key)) || !guard.recordBasis || guard.intent?.type !== 'media_import_target' || typeof guard.intent.pageId !== 'string' || guard.intent.replaceId !== undefined && typeof guard.intent.replaceId !== 'string' || Object.keys(guard.intent).some(key => !['type', 'pageId', 'replaceId'].includes(key))) throw httpError('媒体导入条件不完整或意图无效。')
        guard = structuredClone(guard)
      }
      const begin = () => {
        if (attempts.size >= mediaImportLimits.perWorkspace || [...attempts.values()].filter(a => a.id === id).length >= mediaImportLimits.perBoard) throw httpError('等待清理的媒体导入过多，请稍后重试。', 429)
        const attempt = { id, actor, guard, token: randomUUID(), state: 'active', files: createAttemptFiles(boardDir(root, id)), queue: Promise.resolve(), retries: 0, count: 0, expectedFiles }
        attempt.timer = setTimeout(() => { void close(attempt).catch(() => {}) }, mediaImportLimits.leaseMs); attempt.timer.unref?.()
        attempts.set(attempt.token, attempt)
        return { importToken: attempt.token, expiresInMs: mediaImportLimits.leaseMs }
      }
      return guard ? workspace.inspectCommands(id, guard.expectedRevision, () => [guard.intent], begin, { recordBasis: guard.recordBasis }) : begin()
    },
    async upload(id, token, actor, bytes, extension) {
      const attempt = lookup(id, token, actor)
      const upload = async () => {
        await workspace.requireConversation(id)
        if (attempt.stopping || attempt.state !== 'active') throw httpError('本次媒体导入已结束。', 409)
        if (attempt.count >= attempt.expectedFiles) throw httpError('本次媒体导入文件数量超限。', 413)
        attempt.count++
        const fileName = `${randomUUID()}-media-import-${randomUUID()}.${extension}`
        const saved = { fileName, assetPath: join(boardDir(root, id), 'assets', fileName), assetUrl: `/c/${id}/assets/${encodeURIComponent(fileName)}` }
        // Register before writing so a partial write is owned too. The ledger
        // only records after wx; an EEXIST target is never ours to remove.
        owners.set(saved.assetUrl, attempt)
        try { await attempt.files.write(saved, bytes) } catch (error) { if (!attempt.files.has(saved.assetUrl)) owners.delete(saved.assetUrl); throw error }
        if (attempt.stopping) throw httpError('本次媒体导入已取消。', 409)
        return saved
      }
      // Guarded inspection owns this same board lock; never nest boardLock.
      return serial(attempt, () => attempt.guard
        ? workspace.inspectCommands(id, attempt.guard.expectedRevision, () => [attempt.guard.intent], upload, { recordBasis: attempt.guard.recordBasis })
        : boardLock(root, id, upload))
    },
    abort(id, token, actor) {
      const receipt = ended.get(token)
      if (receipt?.id === id && receipt.actor === actor && receipt.until > Date.now()) return { removed: 0, remaining: 0, cleanupFailed: 0 }
      return close(lookup(id, token, actor))
    },
  }
  managers.set(root, { api, owners, finish })
  return api
}
