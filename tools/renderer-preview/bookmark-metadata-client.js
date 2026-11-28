import { normalizeHttpUrl, normalizeBookmarkMetadata } from '../../model/index.js'

const messages = Object.freeze({
  invalid_request: '读取请求无效。', invalid_url: '网址无效，仅支持标准 HTTP 或 HTTPS 网址。',
  request_too_large: '网址请求超过大小限制。', unsupported_request_type: '读取请求格式不支持。',
  target_not_public: '此网址不在公开网络上，不能读取信息。', redirect_rejected: '网页跳转不符合安全规则。',
  redirect_limit: '网页跳转次数过多。', upstream_too_large: '网页响应超过大小限制。',
  unsupported_content_type: '该响应不是可读取的 HTML 网页。', unsupported_encoding: '网页使用了不支持的压缩编码。',
  invalid_html: '网页头部无法安全解析。', rate_limited: '刷新次数过多，请稍后重试。',
  metadata_busy: '正在读取其他网页，请稍后重试。', upstream_failed: '暂时无法读取网页信息。',
  metadata_timeout: '读取网页信息超时。',
})
const failure = (code = 'upstream_failed') => Object.assign(new Error(messages[code]), { code })

async function readJson(response, signal) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length')) > 65536) { await response.body?.cancel(); throw failure() }
  const reader = response.body?.getReader()
  if (!reader) throw failure()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0, text = ''
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    for (;;) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      if (done) break
      size += value.byteLength
      if (size > 65536) throw failure()
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock() }
}

// This adapter can request only the parent's fixed URL-only endpoint. Tests
// replace fetch; production address/TLS policy still belongs to the server.
export function createBookmarkMetadataClient({ fetch: fetcher = globalThis.fetch } = {}) {
  return {
    async fetchMetadata(value, { signal } = {}) {
      try {
        signal?.throwIfAborted()
        const url = normalizeHttpUrl(value)
        if (!url) throw failure('invalid_url')
        const response = await fetcher('/api/bookmark/metadata', { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
          headers: { 'content-type': 'application/json', 'x-hicanvas-client': '1' }, body: JSON.stringify({ url }), signal })
        const data = await readJson(response, signal)
        if (!response.ok) throw failure(Object.hasOwn(messages, data?.error?.code) ? data.error.code : 'upstream_failed')
        return normalizeBookmarkMetadata(data)
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw signal?.reason || error
        throw failure(Object.hasOwn(messages, error?.code) ? error.code : 'upstream_failed')
      }
    },
  }
}
