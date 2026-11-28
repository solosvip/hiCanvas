import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createBookmarkMetadataClient } from './renderer-preview/bookmark-metadata-client.js'

const url = 'https://site.example.invalid/article#user-fragment'
const dto = { title: '合成标题', description: '合成描述', url: 'https://site.example.invalid/article' }
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

test('固定同源路由及唯一URL正文，不附带画板、actor、Cookie或额外身份', async () => {
  const calls = [], controller = new AbortController()
  const client = createBookmarkMetadataClient({ fetch: async (path, options) => { calls.push({ path, options }); return response(dto) } })
  assert.deepEqual(await client.fetchMetadata(url, { signal: controller.signal }), dto)
  assert.equal(calls.length, 1)
  const { path, options } = calls[0], headers = new Headers(options.headers)
  assert.equal(path, '/api/bookmark/metadata')
  assert.equal(options.method, 'POST')
  assert.equal(options.signal, controller.signal)
  assert.equal(options.credentials, 'omit')
  assert.equal(options.redirect, 'error')
  assert.equal(options.cache, 'no-store')
  assert.deepEqual(JSON.parse(options.body), { url })
  assert.equal(headers.get('x-hicanvas-client'), '1')
  assert.equal(headers.get('content-type'), 'application/json')
  assert.equal(headers.get('authorization'), null)
  assert.equal(headers.get('cookie'), null)
  assert.equal(headers.get('x-hicanvas-actor'), null)
})

test('已取消任务不开始请求，进行中的Abort传到唯一fetch且不自动重试', async () => {
  const controller = new AbortController(), calls = []
  const client = createBookmarkMetadataClient({ fetch: (path, options) => new Promise((resolve, reject) => {
    calls.push({ path, options })
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }) })
  const pending = client.fetchMetadata(url, { signal: controller.signal })
  assert.equal(calls.length, 1)
  controller.abort()
  await assert.rejects(pending, error => error.name === 'AbortError')
  await assert.rejects(client.fetchMetadata(url, { signal: controller.signal }))
  assert.equal(calls.length, 1)
})

for (const [status, code] of [[422, 'target_not_public'], [422, 'redirect_rejected'], [429, 'rate_limited'], [503, 'metadata_busy'], [504, 'metadata_timeout']]) {
  test(`已知机器码${code}映射本地提示，不回显响应原文`, async () => {
    let calls = 0
    const client = createBookmarkMetadataClient({ fetch: async () => { calls++; return response({ error: { code, message: 'SECRET response body' } }, status) } })
    await assert.rejects(client.fetchMetadata(url), error => error.code === code && !String(error.message).includes('SECRET'))
    assert.equal(calls, 1)
  })
}

test('未知错误、非JSON、错误DTO和超大响应都拒绝，不将原文作为用户提示', async () => {
  for (const makeResponse of [
    () => response({ error: { code: 'SECRET-code', message: 'SECRET body' } }, 502),
    () => new Response('<html>SECRET body</html>', { status: 500, headers: { 'content-type': 'text/html' } }),
    () => response({ ...dto, html: 'SECRET body' }),
    () => response({ ...dto, url: 'javascript:SECRET' }),
    () => response({ ...dto, title: { unexpected: 'SECRET body' } }),
    () => new Response(' '.repeat(128 * 1024), { headers: { 'content-type': 'application/json' } }),
  ]) {
    const client = createBookmarkMetadataClient({ fetch: async () => makeResponse() })
    await assert.rejects(client.fetchMetadata(url), error => !String(error.message).includes('SECRET'))
  }
})

test('本机网址作为数据送到原服务裁决，拒绝原因可识别，不在客户端增加公网例外', async () => {
  const calls = [], local = 'http://127.0.0.1/local'
  const client = createBookmarkMetadataClient({ fetch: async (path, options) => {
    calls.push({ path, body: JSON.parse(options.body) })
    return response({ error: { code: 'target_not_public', message: 'SECRET' } }, 422)
  } })
  await assert.rejects(client.fetchMetadata(local), error => error.code === 'target_not_public' && !String(error.message).includes('SECRET'))
  assert.deepEqual(calls, [{ path: '/api/bookmark/metadata', body: { url: local } }])
})
