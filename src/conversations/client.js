let conversationId = null
export function currentConversationId() { return conversationId }
export function conversationUrl(id) { return `/?conversation=${encodeURIComponent(id)}` }
export function canvasApiUrl(path) {
  if (!conversationId) throw new Error('画板尚未加载，已停止读写。')
  const url = new URL(path, window.location.origin)
  url.searchParams.set('conversation', conversationId)
  return url.pathname + url.search
}
export async function conversationApi(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: { 'content-type': 'application/json', 'x-hicanvas-client': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw Object.assign(new Error(data.error || '画板操作失败。'), { status: response.status, storage: data.storage })
  return data
}
export async function initializeConversation() {
  const health = await conversationApi('/api/health')
  if (health.canvasMode !== 'single') throw new Error('旧版画板服务仍在运行，请先保存作品并更新服务，再重新打开 hiCanvas。')
  let id = new URLSearchParams(window.location.search).get('conversation')
  if (!id) {
    try { id = localStorage.getItem('hicanvas:last-conversation') } catch { /* 浏览器可禁用本机偏好存储。 */ }
    const { conversations } = await conversationApi('/api/conversations')
    if (!conversations.some(c => c.id === id)) id = conversations[0]?.id
    if (!id) {
      conversationId = null
      document.title = 'hiCanvas'
      try { localStorage.removeItem('hicanvas:last-conversation') } catch { /* 本机偏好可禁用。 */ }
      return null
    }
  }
  const { conversation } = await conversationApi('/api/conversations/open', 'POST', { conversationId: id })
  conversationId = conversation.id
  history.replaceState(null, '', conversationUrl(conversationId))
  document.title = `${conversation.title} · hiCanvas`
  try { localStorage.setItem('hicanvas:last-conversation', conversationId) } catch { /* URL 仍可恢复。 */ }
  return conversation
}
