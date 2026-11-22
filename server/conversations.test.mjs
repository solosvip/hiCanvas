import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './test-helpers.mjs'

test('我的画板恢复旧视角后写入新位置，不覆盖原始视角文件', async t => {
  const { api, root } = await fixture(t)
  const { writeFile, readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const original = { version: 1, currentPageId: null, camera: { x: 10, y: 20, z: 1 } }
  const path = join(root, 'cowart-view-state.json')
  await writeFile(path, JSON.stringify(original))
  assert.deepEqual((await api('/api/view-state?conversation=legacy')).body.viewState, original)
  const next = { ...original, camera: { x: 30, y: 40, z: 2 } }
  assert.equal((await api('/api/view-state?conversation=legacy', 'PUT', next)).status, 200)
  assert.deepEqual((await api('/api/view-state?conversation=legacy')).body.viewState, next)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), original)
})

test('路径样式的正文保持原样，资源只限定 URL 字段且拒绝归一化后的跨对话地址', async t => {
  const { api } = await fixture(t)
  const id = (await api('/api/conversations/open', 'POST', {})).body.conversation.id
  const path = `/api/canvas/operations?conversation=${id}`
  const current = (await api(`/api/canvas?conversation=${id}`)).body
  const text = '/assets/logo.png'
  const saved = await api(path, 'POST', { expectedRevision: current.revision, operations: [{ type: 'create_shape', id: 'shape:path-text', shapeType: 'text', text }] })
  assert.equal(saved.status, 200)
  assert.ok(JSON.stringify(saved.body.snapshot.store['shape:path-text'].props.richText).includes(text))
  assert.ok(!JSON.stringify(saved.body.snapshot.store['shape:path-text'].props.richText).includes(`/c/${id}`))
  const asset = { id: 'asset:test', typeName: 'asset', type: 'image', props: { name: 'test', src: `/c/${id}/assets/../../legacy/assets/other.png`, w: 1, h: 1, mimeType: 'image/png', isAnimated: false }, meta: {} }
  for (const src of [asset.props.src, `/c/${id}/assets/%2e%2e/%2e%2e/legacy/assets/other.png`, '/c/legacy/assets/other.png', '/c\\legacy\\assets\\other.png', '//127.0.0.1:43218/c/legacy/assets/other.png', 'http://localhost:43218/c/legacy/assets/other.png']) {
    asset.props.src = src
    assert.equal((await api(path, 'POST', { expectedRevision: saved.body.revision, operations: [{ type: 'put', record: asset }] })).status, 400)
  }
  asset.props.src = '/assets/local.png'
  const localized = await api(path, 'POST', { expectedRevision: saved.body.revision, operations: [{ type: 'put', record: asset }] })
  assert.equal(localized.body.snapshot.store['asset:test'].props.src, `/c/${id}/assets/local.png`)
})

test('MCP 可在没有画板时创建对话，同一个绑定键重连保持原对话', async t => {
  const { api } = await fixture(t)
  const a = await api('/api/conversations/open', 'POST', { bindingKey: 'synthetic-agent-chat', title: '海报设计' })
  assert.equal(a.status, 200)
  const again = await api('/api/conversations/open', 'POST', { bindingKey: 'synthetic-agent-chat' })
  assert.equal(again.body.conversation.id, a.body.conversation.id)
  const other = await api('/api/conversations/open', 'POST', { title: '另外一个对话' })
  assert.notEqual(other.body.conversation.id, a.body.conversation.id)
  const list = await api('/api/conversations')
  assert.ok(list.body.conversations.some(c => c.title === '海报设计'))
})

test('两个对话内容和视角隔离；相同版本的并发修改只有一个提交成功', async t => {
  const { api } = await fixture(t)
  const a = (await api('/api/conversations/open', 'POST', {})).body.conversation.id
  const b = (await api('/api/conversations/open', 'POST', {})).body.conversation.id
  const path = id => `/api/canvas?conversation=${id}`
  const current = (await api(path(a))).body
  const operations = [{ type: 'create_shape', id: 'shape:fixture', shapeType: 'geo', text: '海报 A' }]
  const results = await Promise.all([1, 2].map(() => api(`/api/canvas/operations?conversation=${a}`, 'POST', { expectedRevision: current.revision, operations })))
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
  assert.equal(results.find(r => r.status === 409).body.storage, 'revision-conflict')
  assert.equal((await api(path(a))).body.snapshot.store['shape:fixture'].type, 'geo')
  assert.equal((await api(path(b))).body.snapshot.store['shape:fixture'], undefined)
  const viewState = { version: 1, currentPageId: null, camera: { x: 20, y: 30, z: 1.5 } }
  assert.equal((await api(`/api/view-state?conversation=${a}`, 'PUT', viewState)).status, 200)
  assert.deepEqual((await api(`/api/view-state?conversation=${a}`)).body.viewState, viewState)
  assert.equal((await api(`/api/view-state?conversation=${b}`)).body.viewState, null)
  assert.equal((await api(path(a), 'PUT', { snapshot: current.snapshot })).status, 428)
})

test('批量修改原子提交，非法记录不会覆盖已有画板，也不允许跨对话引用图片', async t => {
  const { api } = await fixture(t)
  const id = (await api('/api/conversations/open', 'POST', {})).body.conversation.id
  const path = `/api/canvas?conversation=${id}`
  const current = (await api(path)).body
  const bad = structuredClone(current.snapshot)
  bad.store['shape:bad'] = { id: 'shape:bad', typeName: 'shape', type: 'geo', props: {} }
  assert.equal((await api(path, 'PUT', { expectedRevision: current.revision, snapshot: bad })).status, 400)
  const operations = [{ type: 'create_shape', id: 'shape:test', shapeType: 'text', text: '你好' }, { type: 'update', id: 'shape:missing', changes: { x: 1 } }]
  assert.equal((await api(`/api/canvas/operations?conversation=${id}`, 'POST', { expectedRevision: current.revision, operations })).status, 400)
  assert.deepEqual((await api(path)).body.snapshot, current.snapshot)
  assert.equal((await api('/api/canvas')).status, 400)
  assert.equal((await api(path, 'GET', undefined, { origin: 'https://untrusted.example' })).status, 403)
})

test('服务重建后仍可恢复对话，显式错误 ID 不得偷偷创建空对话', async t => {
  const { api, root } = await fixture(t)
  const first = (await api('/api/conversations/open', 'POST', { bindingKey: 'persistent-chat' })).body
  const { createConversations } = await import('./conversations.mjs')
  const restarted = createConversations(root)
  assert.equal((await restarted.open({ bindingKey: 'persistent-chat' })).id, first.conversation.id)
  await assert.rejects(restarted.open({ conversationId: '00000000-0000-0000-0000-000000000000' }), /找不到/)
  assert.equal((await restarted.list()).length, 2)
})

test('真实编辑器的 user 文档记录也能保存；错误键、循环父子关系和跨对话资源被拒绝', async t => {
  const { api } = await fixture(t)
  const id = (await api('/api/conversations/open', 'POST', {})).body.conversation.id
  const path = `/api/canvas?conversation=${id}`
  const current = (await api(path)).body
  const snapshot = structuredClone(current.snapshot)
  snapshot.store['user:fixture'] = { id: 'user:fixture', typeName: 'user', name: '', color: '#000000', imageUrl: '', meta: {} }
  assert.equal((await api(path, 'PUT', { expectedRevision: current.revision, snapshot })).status, 200)
  const next = (await api(path)).body
  const wrong = structuredClone(next.snapshot)
  wrong.store.wrong = { ...wrong.store['user:fixture'] }
  assert.equal((await api(path, 'PUT', { expectedRevision: next.revision, snapshot: wrong })).status, 400)
  const cross = [{ type: 'create_shape', shapeType: 'image', props: { url: '/c/legacy/assets/other.png' } }]
  assert.equal((await api(`/api/canvas/operations?conversation=${id}`, 'POST', { expectedRevision: next.revision, operations: cross })).status, 400)
  const cycle = [{ type: 'create_shape', id: 'shape:parent', shapeType: 'group' }, { type: 'create_shape', id: 'shape:child', shapeType: 'group', parentId: 'shape:parent' }, { type: 'update', id: 'shape:parent', changes: { parentId: 'shape:child' } }]
  assert.equal((await api(`/api/canvas/operations?conversation=${id}`, 'POST', { expectedRevision: next.revision, operations: cycle })).status, 400)
  assert.equal((await api(path)).body.revision, next.revision)
})

test('本机画板插件在 Vite 开发和生产预览中都可启动并保存对话', async t => {
  const { createServer, preview } = await import('vite')
  const { canvasStoragePlugin } = await import('./routes.mjs')
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), 'hicanvas-plugin-'))
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'dist', 'index.html'), '<p>synthetic canvas</p>')
  t.after(() => rm(root, { recursive: true, force: true }))
  const options = { configFile: false, root, logLevel: 'silent', plugins: [canvasStoragePlugin({ root: join(root, 'data') })], server: { port: 0, host: '127.0.0.1' }, preview: { port: 0, host: '127.0.0.1' } }
  const dev = await createServer(options)
  await dev.listen()
  assert.equal((await fetch(`http://127.0.0.1:${dev.httpServer.address().port}/api/health`)).status, 200)
  await dev.close()
  const production = await preview(options)
  try {
    const response = await fetch(`http://127.0.0.1:${production.httpServer.address().port}/api/conversations/open`, { method: 'POST', headers: { 'x-hicanvas-client': '1', 'content-type': 'application/json' }, body: JSON.stringify({ bindingKey: 'production' }) })
    assert.equal(response.status, 200)
    assert.ok((await response.json()).conversation.id)
  } finally { await new Promise(resolve => production.httpServer.close(resolve)) }
})
