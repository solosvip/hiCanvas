import { canvasApiUrl, conversationApi } from './client.js'

export function canvasRequestError(data, status) {
  const error = Object.assign(new Error(data.error || `本机请求失败：${status}`), { status, storage: data.storage })
  if (status === 410 || data.storage === 'conversation-deleted') window.dispatchEvent(new Event('hicanvas:board-deleted'))
  return error
}

// 首次连接和断线恢复都核验状态，覆盖删除发生在未订阅期间的情况。
export function watchCanvasLifecycle(onChange, {
  source = new window.EventSource(canvasApiUrl('/api/canvas-events')),
  check = () => conversationApi(canvasApiUrl('/api/canvas')),
  deleted = () => window.dispatchEvent(new Event('hicanvas:board-deleted')),
} = {}) {
  let closed = false, checking = false, pending = false
  async function verify() {
    if (closed) return
    if (checking) { pending = true; return }
    checking = true
    try { await check() } catch (error) {
      if (!closed && (error.status === 410 || error.storage === 'conversation-deleted')) deleted()
    } finally {
      checking = false
      if (pending) { pending = false; void verify() }
    }
  }
  source.addEventListener('canvas-changed', onChange)
  source.addEventListener('canvas-deleted', deleted)
  source.addEventListener('open', verify)
  source.onerror = verify
  return { close() {
    closed = true
    source.removeEventListener('canvas-changed', onChange)
    source.removeEventListener('canvas-deleted', deleted)
    source.removeEventListener('open', verify)
    source.onerror = null
    source.close()
  } }
}
