import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImageMiddleware } from './image-routes.mjs'
import { createConversations } from './conversations.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hicanvas-images-'))
  const workspace = createConversations(join(root, 'isolated-canvas'))
  let middleware = createImageMiddleware({ workspace, settingsDir: join(root, 'settings'), assetsDir: join(root, 'assets') })
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end() }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${server.address().port}`
  async function api(path = '/api/image-models', method = 'GET', body, extraHeaders = {}) {
    const response = await fetch(base + path, { method, headers: { 'x-hicanvas-client': '1', 'content-type': 'application/json', ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  return { root, api, base, restart: () => { middleware = createImageMiddleware({ workspace, settingsDir: join(root, 'settings'), assetsDir: join(root, 'assets') }) } }
}
const profile = { name: '自己的模型', protocol: 'openai-images', baseUrl: 'https://images.example.test/custom/v1', model: 'user-chosen-model', apiKey: 'synthetic-test-credential' }

test('测试未提供隔离资料库时，在读取或恢复任何任务前阻止启动', () => {
  assert.throws(() => createImageMiddleware(), /必须显式传入隔离 workspace/)
})

test('用户添加任意模型后可重读配置，密钥不回显，配置文件仅本人可读', async t => {
  const { api, root, restart } = await fixture(t)
  assert.deepEqual((await api()).body, { models: [], activeModelId: null })
  const added = await api('/api/image-models', 'POST', profile)
  assert.equal(added.status, 200)
  restart()
  const loaded = (await api()).body
  assert.equal(loaded.models[0].model, 'user-chosen-model')
  assert.equal(loaded.models[0].baseUrl, profile.baseUrl)
  assert.equal(loaded.models[0].hasApiKey, true)
  assert.equal(loaded.activeModelId, loaded.models[0].id)
  assert.ok(!JSON.stringify(loaded).includes(profile.apiKey))
  assert.equal((await stat(join(root, 'settings', 'image-models.json'))).mode & 0o777, 0o600)
})

test('可切换、编辑和删除模型；换地址不能沿用旧密钥；外部网页不能操作设置', async t => {
  const { api } = await fixture(t)
  const first = (await api('/api/image-models', 'POST', profile)).body.models[0]
  const second = (await api('/api/image-models', 'POST', { ...profile, name: '第二个', model: 'another-model', apiKey: '' })).body.models[1]
  assert.equal((await api('/api/image-models/active', 'PUT', { modelId: second.id })).body.activeModelId, second.id)
  assert.equal((await api(`/api/image-models/${first.id}`, 'PUT', { ...profile, name: '改名', apiKey: '' })).body.models[0].hasApiKey, true)
  assert.equal((await api(`/api/image-models/${first.id}`, 'PUT', { ...profile, baseUrl: 'https://another.example.test/v1', apiKey: '' })).status, 400)
  assert.equal((await api()).body.models[0].baseUrl, profile.baseUrl)
  assert.equal((await api('/api/image-models', 'POST', profile, { origin: 'https://other.example.test' })).status, 403)
  assert.equal((await api('/api/image-models', 'GET', undefined, { 'x-hicanvas-client': '' })).status, 403)
  const removed = await api(`/api/image-models/${second.id}`, 'DELETE')
  assert.equal(removed.body.activeModelId, first.id)
})

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
async function fakeProvider(t, handler) {
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    try { handler(req, Buffer.concat(chunks).toString(), res) }
    catch { res.writeHead(500); res.end('{}') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}`
}

test('生成请求使用用户填写的地址和模型；图片本机落盘且能从结果列表找回', async t => {
  const { api, root } = await fixture(t)
  let received
  const baseUrl = await fakeProvider(t, (req, body, res) => {
    received = { path: req.url, authorization: req.headers.authorization, body: JSON.parse(body) }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ b64_json: pngBase64 }] }))
  })
  const modelId = (await api('/api/image-models', 'POST', { ...profile, baseUrl: baseUrl + '/custom/v1' })).body.activeModelId
  const result = await api('/api/images', 'POST', { modelId, prompt: '一幅蓝色画' })
  assert.equal(result.status, 200)
  assert.deepEqual(received, { path: '/custom/v1/images/generations', authorization: 'Bearer synthetic-test-credential', body: { model: 'user-chosen-model', prompt: '一幅蓝色画', n: 1 } })
  assert.match(result.body.images[0].src, /^\/assets\/generated-.*\.png$/)
  assert.ok((await stat(join(root, 'assets', result.body.images[0].src.split('/').pop()))).size > 0)
  assert.equal((await api('/api/images/results')).body.images[0].src, result.body.images[0].src)
  assert.ok(!JSON.stringify(result.body).includes(profile.apiKey))
})

test('Gemini 格式按用户所选模型发送文字及参考图，读取真正的图片结果', async t => {
  const { api } = await fixture(t)
  let received
  const baseUrl = await fakeProvider(t, (req, body, res) => {
    received = { path: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(body) }
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '说明' }, { inlineData: { mimeType: 'image/png', data: pngBase64 } }] } }] }))
  })
  const modelId = (await api('/api/image-models', 'POST', { ...profile, protocol: 'gemini', model: 'my-image-model', baseUrl: baseUrl + '/v1beta' })).body.activeModelId
  const result = await api('/api/images', 'POST', { modelId, prompt: '换成蓝色', aspectRatio: '1024:576', references: [`data:image/png;base64,${pngBase64}`] })
  assert.equal(result.status, 200)
  assert.equal(received.path, '/v1beta/models/my-image-model:generateContent')
  assert.equal(received.key, profile.apiKey)
  assert.equal(received.body.generationConfig.imageConfig.aspectRatio, '16:9')
  assert.deepEqual(received.body.contents[0].parts, [{ text: '换成蓝色' }, { inlineData: { mimeType: 'image/png', data: pngBase64 } }])
  assert.equal(result.body.images.length, 1)
})

test('带参考图的 OpenAI 兼容请求使用 multipart；服务出错不回显密钥、不自动重试', async t => {
  const { api } = await fixture(t)
  let calls = 0
  const baseUrl = await fakeProvider(t, (req, body, res) => {
    calls++
    assert.equal(req.url, '/images/edits')
    assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/)
    assert.match(body, /name="model"\r\n\r\nuser-chosen-model/)
    assert.match(body, /name="image\[\]"; filename="reference-1.png"/)
    res.writeHead(401); res.end(JSON.stringify({ error: { message: profile.apiKey } }))
  })
  const modelId = (await api('/api/image-models', 'POST', { ...profile, baseUrl })).body.activeModelId
  const result = await api('/api/images', 'POST', { modelId, prompt: '改图', references: [`data:image/png;base64,${pngBase64}`] })
  assert.equal(result.status, 502)
  assert.match(result.body.error, /401/)
  assert.ok(!JSON.stringify(result.body).includes(profile.apiKey))
  assert.equal(calls, 1)
  assert.equal((await api('/api/images/results')).body.images.length, 0)
})

test('图片接口可随 Vite 开发服务和生产预览正常启动', async t => {
  const { createServer: createViteServer, preview } = await import('vite')
  const { imageToolsPlugin } = await import('./image-routes.mjs')
  const { mkdir, writeFile } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'hicanvas-vite-images-'))
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'dist', 'index.html'), '<p>synthetic canvas</p>')
  t.after(() => rm(root, { recursive: true, force: true }))
  const options = { configFile: false, root, logLevel: 'silent', plugins: [imageToolsPlugin({ workspace: createConversations(join(root, 'isolated-canvas')), settingsDir: join(root, 'settings') })], server: { port: 0, host: '127.0.0.1' }, preview: { port: 0, host: '127.0.0.1' } }
  const development = await createViteServer(options)
  try { await development.listen() } finally { await development.close() }
  const production = await preview(options)
  await new Promise(resolve => production.httpServer.close(resolve))
})

test('URL 图片会下载到本机，下载不附带密钥；重定向不会泄漏鉴权', async t => {
  const { api } = await fixture(t)
  let downloaded = false
  let redirectFollowed = false
  const baseUrl = await fakeProvider(t, (req, _body, res) => {
    if (req.url === '/must-not-follow') { redirectFollowed = true; res.end('{}'); return }
    res.writeHead(302, { location: '/must-not-follow' }); res.end()
  })
  const downloadBase = await fakeProvider(t, (req, _body, res) => {
    assert.equal(req.headers.authorization, undefined)
    downloaded = true; res.end(Buffer.from(pngBase64, 'base64'))
  })
  const providerBase = await fakeProvider(t, (_req, _body, res) => res.end(JSON.stringify({ data: [{ url: downloadBase + '/image.png?signature=synthetic' }] })))
  let modelId = (await api('/api/image-models', 'POST', { ...profile, baseUrl: providerBase })).body.models.at(-1).id
  assert.equal((await api('/api/images', 'POST', { modelId, prompt: 'URL 返回图片' })).status, 200)
  assert.equal(downloaded, true)
  modelId = (await api('/api/image-models', 'POST', { ...profile, baseUrl: baseUrl + '/redirect' })).body.models.at(-1).id
  assert.equal((await api('/api/images', 'POST', { modelId, prompt: '不跟随重定向' })).status, 502)
  assert.equal(redirectFollowed, false)
})
