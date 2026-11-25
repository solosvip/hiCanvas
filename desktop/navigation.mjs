import { localBaseUrl } from '../mcp/connection.mjs'

export function allowedNavigation(value, origin) {
  try {
    const url = new URL(value)
    return url.origin === localBaseUrl(origin) && url.pathname === '/' && !url.username && !url.password
  } catch { return false }
}
export function externalLink(value) {
  try { return ['https:', 'http:'].includes(new URL(value).protocol) } catch { return false }
}
export async function validateCanvasLink({ url, baseUrl, workspace }) {
  if (!allowedNavigation(url, baseUrl)) throw new Error('画板地址不受支持。')
  const response = await fetch(new URL('/api/health', baseUrl), { signal: AbortSignal.timeout(3000), redirect: 'error' })
  const health = await response.json()
  if (!response.ok || health.name !== 'hiCanvas' || health.protocol !== 2 || health.workspace !== workspace) throw new Error('画板链接与本机资料目录不匹配。')
  return url
}
