import { httpError } from './file-lock.mjs'
import { readRequestBody } from './protocol.mjs'

export function requireLocalRequest(req) {
  const host = req.headers.host || ''
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) || req.headers['x-hicanvas-client'] !== '1' || (req.headers.origin && req.headers.origin !== `http://${host}`)) throw httpError('只接受 hiCanvas 本机客户端的请求。', 403)
}
export function requireLocalRead(req) {
  const host = req.headers.host || ''
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') throw httpError('只接受本机同源请求。', 403)
}
export async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw httpError('需要 JSON 请求。', 415)
  let body
  try { body = JSON.parse(await readRequestBody(req)) } catch { throw httpError('请求内容不是有效 JSON。') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError('请求内容必须是对象。')
  return body
}
