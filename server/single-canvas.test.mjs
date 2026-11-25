import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './test-helpers.mjs'
import { applyCanvasOperations } from './canvas-operations.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createHiCanvasMcp } from '../mcp/server.mjs'
import { createServer } from 'node:http'
import { ensureService } from '../mcp/startup.mjs'
import { workspaceIdentity } from './workspace-identity.mjs'
import { validateCanvasLink } from '../desktop/navigation.mjs'
import { b64Vecs } from '@tldraw/tlschema'
import { mergeLegacyPages } from './single-canvas.mjs'

test('旧多页合成一个画布，保留嵌套、旋转、图层和原始快照，重复读取不重复移动', async t => {
  const { workspace, root } = await fixture(t)
  const { id } = await workspace.open()
  const original = await workspace.read(id)
  const snapshot = structuredClone(original.snapshot)
  const page = Object.values(snapshot.store).find(r => r.typeName === 'page')
  snapshot.store['page:second'] = { ...page, id: 'page:second', name: '第二个旧页面', index: 'a2' }
  applyCanvasOperations(snapshot, [
    { type: 'create_shape', id: 'shape:first', shapeType: 'geo', x: 20, y: 30, props: { w: 600, h: 400 } },
    { type: 'create_shape', id: 'shape:slides', shapeType: 'frame', parentId: 'page:second', x: -100, y: 200, rotation: 0.3, meta: { cowartAiSlides: true } },
    { type: 'create_shape', id: 'shape:slide', shapeType: 'embed', parentId: 'shape:slides', x: 12, y: 12, props: { url: 'https://example.com/slide' } },
    { type: 'create_shape', id: 'shape:overlay', shapeType: 'geo', parentId: 'page:second', x: 100, y: 300 }
  ])
  const oldState = { revision: original.revision, snapshot }
  const path = join(root, 'conversations', id, 'state.json')
  await writeFile(path, JSON.stringify(oldState))
  await workspace.sidecar(id, 'view', { version: 1, currentPageId: 'page:second', camera: { x: 5, y: 10, z: 1 } })
  const migrated = await workspace.read(id)
  assert.equal(Object.values(migrated.snapshot.store).filter(r => r.typeName === 'page').length, 1)
  assert.notEqual(migrated.revision, original.revision)
  const store = migrated.snapshot.store
  assert.deepEqual(store['shape:first'], snapshot.store['shape:first'])
  assert.deepEqual(store['shape:slide'], snapshot.store['shape:slide'])
  assert.equal(store['shape:slides'].rotation, 0.3)
  assert.equal(store['shape:slides'].parentId, page.id)
  assert.ok(store['shape:slides'].x > 620)
  assert.equal(store['shape:overlay'].x - store['shape:slides'].x, 200)
  assert.equal(store['shape:overlay'].y - store['shape:slides'].y, 100)
  assert.ok(store['shape:slides'].index < store['shape:overlay'].index)
  const archived = JSON.parse(await readFile(join(root, 'conversations', id, 'before-single-canvas.json'), 'utf8'))
  assert.deepEqual(archived, oldState)
  assert.deepEqual((await workspace.read(id)).snapshot, migrated.snapshot)
  const view = await workspace.sidecar(id, 'view')
  assert.equal(view.currentPageId, page.id)
  assert.equal(view.camera.x + store['shape:slides'].x, 5 + snapshot.store['shape:slides'].x)
  await workspace.mutate(id, migrated.revision, s => s)
  assert.deepEqual(await workspace.sidecar(id, 'view'), view, '后续保存后仍可恢复原视角')
})

test('单画布约束由服务端守住，不能经批量操作或整份快照另建、替换、删除内部画布', async t => {
  const { workspace, api } = await fixture(t)
  const { id } = await workspace.open()
  const current = await workspace.read(id)
  const page = Object.values(current.snapshot.store).find(r => r.typeName === 'page')
  for (const operations of [
    [{ type: 'put', record: { ...page, id: 'page:hidden', index: 'a2' } }],
    [{ type: 'delete', ids: [page.id] }],
    [{ type: 'put', record: { ...page, id: 'page:replacement' } }, { type: 'delete', ids: [page.id] }]
  ]) {
    const result = await api(`/api/canvas/operations?conversation=${id}`, 'POST', { expectedRevision: current.revision, operations })
    assert.equal(result.status, 400)
    assert.equal((await workspace.read(id)).revision, current.revision)
  }
  const snapshot = structuredClone(current.snapshot)
  snapshot.store['page:hidden'] = { ...page, id: 'page:hidden', index: 'a2' }
  assert.equal((await api(`/api/canvas?conversation=${id}`, 'PUT', { expectedRevision: current.revision, snapshot })).status, 400)
})

test('旧页含向左延伸的折线和嵌套旋转，迁移后与前页内容留出间隔', async t => {
  const { workspace, root } = await fixture(t)
  const { id } = await workspace.open()
  const original = await workspace.read(id)
  const snapshot = structuredClone(original.snapshot), store = snapshot.store
  const page = Object.values(store).find(r => r.typeName === 'page')
  store['page:line'] = { ...page, id: 'page:line', name: '旧线条', index: 'a2' }
  applyCanvasOperations(snapshot, [
    { type: 'create_shape', id: 'shape:block', shapeType: 'geo', props: { w: 600, h: 400 } },
    { type: 'create_shape', id: 'shape:group', shapeType: 'group', parentId: 'page:line', rotation: 0.2 },
    { type: 'create_shape', id: 'shape:line', shapeType: 'geo', parentId: 'shape:group', rotation: 0.3 }
  ])
  store['shape:line'].type = 'line'
  store['shape:line'].props = { color: 'black', dash: 'solid', size: 'm', spline: 'line', scale: 1, points: { a1: { id: 'a1', index: 'a1', x: -2000, y: 0 }, a2: { id: 'a2', index: 'a2', x: 0, y: 100 } } }
  await writeFile(join(root, 'conversations', id, 'state.json'), JSON.stringify({ revision: original.revision, snapshot }))
  const moved = (await workspace.read(id)).snapshot.store
  const minX = moved['shape:group'].x - 2000 * Math.cos(0.5)
  assert.ok(minX > 600, `折线左端 ${minX} 不应盖住前页矩形`)
  assert.deepEqual(moved['shape:line'], store['shape:line'])
})

test('新版 MCP 与桌面深链拒绝复用旧多页服务，不在其上隐藏页面', async t => {
  const { root } = await fixture(t)
  const workspace = workspaceIdentity(root)
  const legacy = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ name: 'hiCanvas', protocol: 2, workspace })) })
  await new Promise(resolve => legacy.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => legacy.close(resolve)))
  const baseUrl = `http://127.0.0.1:${legacy.address().port}`
  await assert.rejects(ensureService(baseUrl, { canvasDir: root }), /旧版画板/)
  await assert.rejects(validateCanvasLink({ url: baseUrl + '/', baseUrl, workspace }), /旧版画板/)
  assert.equal((await fetch(baseUrl)).status, 200, '不能擅自停止旧服务')
})

test('编码笔迹的镜像缩放与大便签也纳入迁移范围，不把后页盖在旧作品上', async t => {
  const { workspace, root } = await fixture(t)
  const { id } = await workspace.open()
  const original = await workspace.read(id)
  const snapshot = structuredClone(original.snapshot), store = snapshot.store
  const page = Object.values(store).find(r => r.typeName === 'page')
  store['page:next'] = { ...page, id: 'page:next', name: '其他作品', index: 'a2' }
  applyCanvasOperations(snapshot, [
    { type: 'create_shape', id: 'shape:draw', shapeType: 'geo' },
    { type: 'create_shape', id: 'shape:note', shapeType: 'geo', x: 6500 },
    { type: 'create_shape', id: 'shape:next', shapeType: 'geo', parentId: 'page:next', props: { w: 512, h: 512 } }
  ])
  store['shape:draw'].type = 'draw'
  store['shape:draw'].props = { color: 'black', fill: 'none', dash: 'draw', size: 'm', isComplete: true, isClosed: false, isPen: false, scale: 1, scaleX: -2, scaleY: 3, segments: [{ type: 'free', path: b64Vecs.encodePoints([{ x: 0, y: 0, z: 0.5 }, { x: -3000, y: 100, z: 0.5 }]) }] }
  const { richText, color, size, font, scale, labelColor, align, verticalAlign } = store['shape:note'].props
  store['shape:note'].type = 'note'
  store['shape:note'].props = { richText, color, size, font, scale: 4 * scale, labelColor, align, verticalAlign, growY: 0, url: '', fontSizeAdjustment: 1, textFirstEditedBy: null }
  const onlyStroke = structuredClone(snapshot)
  delete onlyStroke.store['shape:note']
  mergeLegacyPages(onlyStroke)
  assert.ok(onlyStroke.store['shape:next'].x > 6000, '笔迹的编码路径和镜像缩放必须计入范围')
  await writeFile(join(root, 'conversations', id, 'state.json'), JSON.stringify({ revision: original.revision, snapshot }))
  const moved = (await workspace.read(id)).snapshot.store
  assert.ok(moved['shape:next'].x > 7300, '后页必须避开 6000 像素笔迹和右侧宽800的便签')
  assert.deepEqual(moved['shape:draw'], store['shape:draw'])
  assert.deepEqual(moved['shape:note'], store['shape:note'])
})

test('MCP 无需页面参数即可创建普通形状与 HTML，生图接口也不暴露页面选择', async t => {
  const { base } = await fixture(t)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const server = createHiCanvasMcp({ baseUrl: base, open: async () => {}, receiver: null })
  const client = new Client({ name: 'single-canvas-agent', version: '1' })
  await server.connect(b); await client.connect(a)
  t.after(async () => { await client.close(); await server.close() })
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args })
    assert.ok(!result.isError, JSON.stringify(result))
    return result.structuredContent
  }
  for (const tool of (await client.listTools()).tools.filter(t => ['submit_image_batch', 'generate_image', 'insert_cowart_html_draft', 'insert_cowart_image'].includes(t.name))) {
    assert.equal(tool.inputSchema.properties.pageId, undefined)
  }
  const opened = await call('open_conversation')
  const id = opened.conversationId
  const saved = await call('apply_canvas_operations', { conversationId: id, expectedRevision: opened.revision, operations: [{ type: 'create_shape', shapeType: 'text', text: '画板中的文字' }] })
  const html = await call('insert_cowart_html_draft', { conversationId: id, expectedRevision: saved.revision, htmlContent: '<html><body>同一画板</body></html>' })
  const state = await call('get_canvas', { conversationId: id })
  const pages = Object.values(state.snapshot.store).filter(r => r.typeName === 'page')
  assert.equal(pages.length, 1)
  assert.equal(state.snapshot.store[html.shapeId].parentId, pages[0].id)
})
