// Shared host-only lease protocol. Keep the token even when a begin receipt
// arrives after cancellation: cleanup must not depend on an upload URL.
// Guarded media imports pass their record-basis fields lazily: the ticket that
// owns them is created after the attempt, and begin is the first server call.
export function createMediaUploadAttempt({ metadata, fileCount, signal, beginFields }) {
  let importToken
  const headers = { 'content-type': 'application/json', 'x-hicanvas-client': '1', 'x-hicanvas-actor': metadata.actor || 'http' }
  async function post(body, activeSignal) {
    const response = await fetch(`/api/canvas/reference?conversation=${encodeURIComponent(metadata.conversationId)}`, { method: 'POST', signal: activeSignal, headers, body: JSON.stringify(body), ...(body.purpose === 'file-import-abort' && { keepalive: true }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || '媒体上传失败。')
    return result
  }
  async function request(args, requestSignal = signal) {
    if (args.purpose !== 'file-import-prepare' && args.purpose !== 'file-import-abort' && !importToken) {
      const started = await post({ purpose: 'file-import-begin', fileCount, ...beginFields?.() }, requestSignal)
      importToken = started.importToken
      if (typeof importToken !== 'string' || !importToken) throw new Error('媒体导入凭证无效。')
      requestSignal.throwIfAborted()
    }
    return post({ ...args, ...(args.purpose !== 'file-import-prepare' && { importToken }) }, requestSignal)
  }
  return Object.freeze({ request, hasToken: () => Boolean(importToken), abort: () => importToken ? request({ purpose: 'file-import-abort' }, AbortSignal.timeout(2000)) : Promise.resolve({ remaining: 0, removed: 0 }) })
}
