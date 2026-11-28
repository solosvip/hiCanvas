import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { createContentHost } from './content-host.mjs'
import { isolatedContentSandbox } from '../content-channel/index.js'

const parentOrigin = 'http://127.0.0.1:43396'
const request = (url, options = {}) => new Promise((resolve, reject) => {
  const parsed = new URL(url)
  const req = http.request({ hostname: '127.0.0.1', port: parsed.port, path: parsed.pathname, headers: { host: parsed.host }, ...options }, res => {
    const parts = []
    res.on('data', part => parts.push(part))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString() }))
  })
  req.once('error', reject); req.end()
})

test('Gist 只发布服务端固定包装，不经过素材准备或授予内容通道', async t => {
  const host = createContentHost({ prepare() { throw new Error('Gist 不应进入素材准备器') } })
  t.after(() => host.close())
  const instance = await host.registerGist({ gistId: 'ABC012', parentOrigin })
  assert.match(instance.url, /^http:\/\/[a-f0-9]{48}\.localhost:\d+\/gist.html$/)
  const page = await request(instance.url)
  assert.equal(page.status, 200)
  assert.match(page.text, /src="https:\/\/gist.github.com\/abc012.js"/)
  assert.doesNotMatch(page.text, /hicanvas-channel|edit-source|MessageChannel|postMessage/)
  assert.match(page.headers['content-security-policy'], /^sandbox allow-scripts allow-same-origin;/)
  assert.match(page.headers['content-security-policy'], /script-src 'sha256-[A-Za-z\d+/=]+' https:\/\/gist.github.com\/abc012.js;/)
  assert.match(page.headers['content-security-policy'], /frame-ancestors http:\/\/127.0.0.1:43396$/)
  for (const path of ['/.hicanvas-channel/' + instance.id + '/bootstrap.js', '/.hicanvas-channel/' + instance.id + '/edit-source.txt', '/api/canvas', '/other.html']) {
    assert.equal((await request(new URL(path, instance.url))).status, 404, path)
  }
})

test('Gist响应只授权固定bootstrap、本ID脚本、官方CSS及data图片，其他能力为空', async t => {
  const host = createContentHost(); t.after(() => host.close())
  const instance = await host.registerGist({ gistId: 'abc012', parentOrigin }), page = await request(instance.url)
  const bootstrap = page.text.match(/<script>([^]*?)<\/script>/)[1]
  const hash = createHash('sha256').update(bootstrap).digest('base64')
  assert.equal(page.headers['content-security-policy'], `sandbox allow-scripts allow-same-origin; default-src 'none'; script-src 'sha256-${hash}' https://gist.github.com/abc012.js; script-src-attr 'none'; style-src 'unsafe-inline' https://github.githubassets.com/assets/; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; font-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors http://127.0.0.1:43396`)
  assert.equal(page.headers['referrer-policy'], 'no-referrer')
  assert.equal(page.headers['x-content-type-options'], 'nosniff')
  assert.equal(page.headers['cache-control'], 'no-store')
  const options = { port: Number(new URL(instance.url).port), parentOrigin, kind: 'gist' }
  assert.equal(isolatedContentSandbox(instance.url, options), 'allow-scripts allow-same-origin')
  for (const url of [parentOrigin, 'https://example.invalid', instance.url.replace('.localhost', '.localhost.evil.invalid')]) assert.throws(() => isolatedContentSandbox(url, options))
  assert.throws(() => isolatedContentSandbox(instance.url, { ...options, kind: 'unknown' }))
  assert.equal((await request(instance.url, { method: 'HEAD' })).text, '')
  assert.equal((await request(instance.url, { method: 'POST' })).status, 405)
})

test('已发布包装在主脚本成功后仍报告迟到CSS错误和未知依赖的CSP拒绝', async t => {
  const host = createContentHost(); t.after(() => host.close())
  const page = await request((await host.registerGist({ gistId: 'abc012', parentOrigin })).url)
  const bootstrap = page.text.match(/<script>([^]*?)<\/script>/)[1]
  for (const signal of ['stylesheet', 'script', 'policy']) {
    const listeners = new Map(), nodes = new Map()
    const makeNode = () => ({ id: 'hicanvas-gist-status', textContent: 'loading', setAttribute() {}, remove() { nodes.delete(this.id) } })
    nodes.set('hicanvas-gist-status', makeNode())
    const document = { getElementById: id => nodes.get(id), createElement: makeNode, body: { prepend: node => nodes.set(node.id, node) }, addEventListener: (type, handler) => listeners.set('document-' + type, handler) }
    runInNewContext(bootstrap, { document, addEventListener: (type, handler) => listeners.set(type, handler) })
    assert.equal(typeof listeners.get('document-load'), 'function', '资源load不传播至Window，必须在Document捕获')
    listeners.get('document-load')({ target: { hasAttribute: name => name === 'data-hicanvas-gist', tagName: 'SCRIPT' } })
    assert.equal(nodes.size, 0, '主脚本加载成功应移除加载提示')
    if (signal === 'policy') listeners.get('securitypolicyviolation')?.({ effectiveDirective: 'style-src-elem', blockedURI: 'https://unknown.invalid/style.css' })
    else listeners.get('document-error')({ target: { tagName: signal === 'stylesheet' ? 'LINK' : 'SCRIPT', hasAttribute: () => false } })
    assert.equal(nodes.get('hicanvas-gist-status')?.textContent, 'Gist 内容加载失败。', signal)
  }
})

test('Gist直接发布也拒绝坏ID、父来源和调用方附带的资源/策略', async t => {
  const host = createContentHost(); t.after(() => host.close())
  for (const gistId of [null, '', 'https://gist.github.com/abc', 'ab.js', '<script>', '../abc', 'a'.repeat(65), 'ab\n']) await assert.rejects(host.registerGist({ gistId, parentOrigin }), e => e.status === 400)
  for (const key of ['html', 'scriptUrl', 'csp', 'sandbox', 'sourceUrl', 'conversationId']) await assert.rejects(host.registerGist({ gistId: 'abc012', parentOrigin, [key]: 'forged' }), e => e.status === 400)
  for (const value of [null, [], 'abc012']) await assert.rejects(host.registerGist(value), e => e.status === 400)
  for (const origin of ['https://evil.invalid', 'http://attacker.localhost:1', parentOrigin + '/path', undefined]) await assert.rejects(host.registerGist({ gistId: 'abc012', parentOrigin: origin }), e => e.status === 403)
})

test('两类发布共用配额和租约，撤销/到期/关闭后Gist不可复活', async t => {
  let now = 100
  const host = createContentHost({ now: () => now, ttl: 100, maxInstances: 1 }); t.after(() => host.close())
  const gist = await host.registerGist({ gistId: 'abc012', parentOrigin })
  await assert.rejects(host.register({ html: 'blocked', parentOrigin }), e => e.status === 413)
  assert.throws(() => host.revoke(gist.id, 'wrong'), e => e.status === 403)
  now = 150; assert.equal(host.renew(gist.id, gist.revokeToken).expiresAt, 250)
  now = 201; assert.equal((await request(gist.url)).status, 200)
  now = 251; assert.equal((await request(gist.url)).status, 403)
  assert.throws(() => host.renew(gist.id, gist.revokeToken), e => e.status === 403)
  const generated = await host.register({ html: 'generated', parentOrigin })
  await assert.rejects(host.registerGist({ gistId: 'def012', parentOrigin }), e => e.status === 413)
  host.revoke(generated.id, generated.revokeToken)
  const second = await host.registerGist({ gistId: 'def012', parentOrigin })
  assert.notEqual(new URL(gist.url).hostname, new URL(second.url).hostname)
  host.revoke(second.id, second.revokeToken)
  assert.equal((await request(second.url)).status, 403)
  await host.close()
  await assert.rejects(host.registerGist({ gistId: 'abc012', parentOrigin }), e => e.status === 503)
})

test('Gist固定包装计入同一字节预算，繁忙和并发登记不能突破配额', async t => {
  const tiny = createContentHost({ maxHtmlBytes: 1 }), bytes = createContentHost({ maxTotalBytes: 1 })
  const count = createContentHost({ maxInstances: 1 })
  for (const host of [tiny, bytes, count]) t.after(() => host.close())
  for (const host of [tiny, bytes]) await assert.rejects(host.registerGist({ gistId: 'abc012', parentOrigin }), e => e.status === 413)
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => count.registerGist({ gistId: 'abc012', parentOrigin })))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 429).length, 2)
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 413).length, 3)
})

test('假官方响应只在Gist专项安装，精确URL与资源类型匹配，钩子错误必须拒绝', async () => {
  const { createGistFixtureAdapter, allowGistFixtureRequest } = await import('../tools/renderer-preview/gist-fixtures.mjs')
  const handlers = new Map(), session = { protocol: { handle: (name, handler) => handlers.set(name, handler), unhandle: name => handlers.delete(name) } }
  for (const key of ['500', 'external', 'videos', 'content-security']) assert.equal(createGistFixtureAdapter({ key, manifest: { embedsOnly: true }, session }), null)
  assert.equal(createGistFixtureAdapter({ key: 'embed-editing', manifest: {}, session }), null)
  assert.equal(handlers.size, 0)
  const adapter = createGistFixtureAdapter({ key: 'embed-editing', manifest: { embedsOnly: true }, session })
  const known = { url: 'https://gist.github.com/0123456789abcdef0123456789abcdef.js', resourceType: 'script', method: 'GET' }
  assert.equal(allowGistFixtureRequest(adapter, known), true)
  for (const extra of [
    { url: 'https://unlisted.invalid/a.js' }, { url: 'https://gist.github.com/other.js' },
    { url: known.url + '?file=a' }, { url: known.url + '/other' }, { url: known.url + '#hash' },
    { resourceType: 'subFrame' }, { resourceType: 'xhr' }, { resourceType: 'image' }, { method: 'POST' },
  ]) assert.equal(allowGistFixtureRequest(adapter, { ...known, ...extra }), false, JSON.stringify(extra))
  for (const value of [true, false, undefined, null, 1, 'allow', {}, Promise.resolve('local')]) assert.equal(allowGistFixtureRequest({ match: () => value }, known), false)
  assert.equal(allowGistFixtureRequest({ match() { throw new Error('broken adapter') } }, known), false)
  assert.equal(allowGistFixtureRequest(null, known), false)
  const response = await handlers.get('https')(new Request(known.url))
  assert.equal(response.status, 200); assert.match(await response.text(), /HICANVAS_GIST_FIXTURE/)
  const denied = await handlers.get('https')(new Request('https://gist.github.com/other.js'))
  assert.equal(denied.status, 403)
  adapter.dispose()
  assert.equal(allowGistFixtureRequest(adapter, known), false)
  assert.equal((await handlers.get('https')(new Request(known.url))).status, 403)
  assert.equal(createGistFixtureAdapter({ key: 'embed-editing', manifest: { embedsOnly: true }, session }), null)
})

test('适配器意外返回拒绝Promise也按拒绝处理，不产生未处理错误', async () => {
  const { allowGistFixtureRequest } = await import('../tools/renderer-preview/gist-fixtures.mjs')
  assert.equal(allowGistFixtureRequest({ match: () => Promise.reject(new Error('async hook failure')) }, { url: 'https://unlisted.invalid/x', method: 'GET', resourceType: 'script' }), false)
  await new Promise(resolve => setImmediate(resolve))
})

test('Gist专项Node出站桩只让自有回环请求通过，连接前拒绝其他地址/端口/路径，结束后恢复', async () => {
  const { installGistNodeBoundary } = await import('../tools/renderer-preview/gist-fixtures.mjs')
  const original = net.Socket.prototype.connect
  const server = http.createServer((_request, response) => response.end('owned-loopback'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const boundary = installGistNodeBoundary([base])
  try {
    assert.equal(await (await fetch(base)).text(), 'owned-loopback')
    for (const options of [{ host: 'gist-tests.invalid', port: 443 }, { host: '127.0.0.1', port: 1 }, { path: '/must-not-open' }]) assert.throws(() => new net.Socket().connect(options), /Node outbound denied/)
    assert.equal(boundary.denied.length, 3)
  } finally { boundary.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  assert.equal(net.Socket.prototype.connect, original)
  assert.throws(() => installGistNodeBoundary(['https://gist-tests.invalid']), /owned loopback/)
  assert.equal(net.Socket.prototype.connect, original)
})

test('Gist预期拒绝不掩盖含frame、CSP或ERR字样的真实浏览器异常', async () => {
  const { isExpectedGistConsoleError } = await import('../tools/renderer-preview/gist-fixtures.mjs')
  for (const message of ['Uncaught ReferenceError: frame is not defined', 'Uncaught TypeError: Content Security Policy probe failed', 'Uncaught Error: ERR_FAILED', 'frame disappeared', 'unexpected failure']) assert.equal(isExpectedGistConsoleError(message), false, message)
  for (const message of ['Failed to load resource: net::ERR_BLOCKED_BY_CLIENT', "Refused to load the script 'https://gist-tests.invalid/a' because it violates Content Security Policy.", 'Loading the script violates the following Content Security Policy directive: script-src', "Blocked opening 'x' in a new window because the request was made in a sandboxed frame."]) assert.equal(isExpectedGistConsoleError(message), true, message)
  const fetchRefusal = "Fetch API cannot load http://127.0.0.1:43396/api/health?__gist_probe=csp-fetch. Refused to connect because it violates the document's Content Security Policy."
  assert.equal(isExpectedGistConsoleError(fetchRefusal), true)
  assert.equal(isExpectedGistConsoleError('Uncaught Error: ' + fetchRefusal), false)
  assert.equal(isExpectedGistConsoleError(fetchRefusal.replace('csp-fetch', 'unexpected')), false)
})
