import { randomUUID } from 'node:crypto'

// 同一 MCP 进程的连接共享操作者；重启进程后启用新的会话身份。
const actor = `mcp:${randomUUID()}`

export function createApiClient(baseUrl) {
  const base = new URL(baseUrl)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.pathname !== '/') throw new Error('MCP 只连接本机 hiCanvas HTTP 服务。')
  return async function api(path, method = 'GET', body) {
    const response = await fetch(new URL(path, base), { method, headers: { 'x-hicanvas-client': '1', 'x-hicanvas-actor': actor, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(330000) })
    const result = await response.json()
    if (!response.ok) throw Object.assign(new Error(result.error || `本机接口返回 ${response.status}`), { status: response.status, storage: result.storage, revision: result.revision })
    return result
  }
}
