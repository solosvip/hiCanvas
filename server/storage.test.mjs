import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTLStore } from 'tldraw'
import { Readable } from 'node:stream'

const project = await mkdtemp(join(tmpdir(), 'hicanvas-storage-'))
process.env.HICANVAS_PROJECT_DIR = project
const { canvasDir, loadCanvasSnapshot, saveCanvasSnapshot, serveCanvasAsset } = await import('./storage.mjs')
beforeEach(() => rm(canvasDir, { recursive: true, force: true }))
after(() => rm(project, { recursive: true, force: true }))
const { canvasStoragePlugin } = await import('./routes.mjs')
const handlers = new Map()
canvasStoragePlugin().configureServer({ middlewares: { use(path, handler) { if (handler) handlers.set(path, handler) } } })

async function request(path, method, body) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)])
  req.method = method
  const res = { statusCode: 0, setHeader() {}, end(value) { this.body = value ? JSON.parse(value) : undefined } }
  await handlers.get(path)(req, res)
  return res
}

function snapshot() {
  const store = createTLStore()
  store.ensureStoreIsUsable()
  return store.getStoreSnapshot()
}

test('新资料库返回空画板；保存后可恢复页面', async () => {
  assert.equal((await loadCanvasSnapshot()).snapshot, null)
  const original = snapshot()
  await saveCanvasSnapshot(original)
  assert.deepEqual((await loadCanvasSnapshot()).snapshot, original)
})

test('删除的页面重开后不会复活', async () => {
  const original = snapshot()
  const first = Object.values(original.store).find(r => r.typeName === 'page')
  original.store['page:second'] = { ...first, id: 'page:second', name: 'Second', index: 'a2' }
  await saveCanvasSnapshot(original)
  delete original.store['page:second']
  await saveCanvasSnapshot(original)
  assert.equal((await loadCanvasSnapshot()).snapshot.store['page:second'], undefined)
})

test('图片内容保存到页面资源目录，重开仍引用同一份资源', async () => {
  const original = snapshot()
  const page = Object.values(original.store).find(r => r.typeName === 'page')
  const asset = { id: 'asset:fixture', typeName: 'asset', type: 'image', props: { src: 'data:image/png;base64,aGVsbG8=', name: 'fixture.png', mimeType: 'image/png' }, meta: {} }
  original.store[asset.id] = asset
  original.store['shape:fixture'] = { id: 'shape:fixture', typeName: 'shape', type: 'image', parentId: page.id, props: { assetId: asset.id } }
  await saveCanvasSnapshot(original)
  const loaded = (await loadCanvasSnapshot()).snapshot
  const url = loaded.store[asset.id].props.src
  assert.match(url, /^\/page-assets\//)
  assert.equal((await readFile(join(canvasDir, 'pages', url.split('/')[2], 'assets', url.split('/')[3]))).toString(), 'hello')
  await saveCanvasSnapshot(loaded)
  assert.equal((await loadCanvasSnapshot()).snapshot.store[asset.id].props.src, url)
})

test('应用构建资源交给静态服务器，不当作用户图片读取', async () => {
  let passed = false
  await serveCanvasAsset({ url: '/app-assets/index.js' }, {}, () => { passed = true })
  assert.equal(passed, true)
})

test('禁止页面资源路径越过资料库', async () => {
  const response = { statusCode: 0, end() {}, setHeader() {} }
  await serveCanvasAsset({ url: '/page-assets/..%2Foutside/fixture.png' }, response, () => {})
  assert.equal(response.statusCode, 403)
})

test('HTTP 保存与重开使用同一份画板，非法输入不会覆盖已有文件', async () => {
  const original = snapshot()
  assert.equal((await request('/api/canvas', 'PUT', original)).statusCode, 200)
  assert.deepEqual((await request('/api/canvas', 'GET')).body.snapshot, original)
  assert.equal((await request('/api/canvas', 'PUT', { invalid: true })).statusCode, 400)
  assert.deepEqual((await request('/api/canvas', 'GET')).body.snapshot, original)
  assert.equal((await request('/api/canvas', 'POST')).statusCode, 405)
})

test('视口与选中项持久化，非法视口不会覆盖有效状态', async () => {
  const viewState = { version: 1, currentPageId: 'page:fixture', camera: { x: 20, y: -10, z: 1.5 } }
  assert.equal((await request('/api/view-state', 'PUT', viewState)).statusCode, 200)
  assert.equal((await request('/api/view-state', 'PUT', { ...viewState, camera: { x: 1, y: 0, z: null } })).statusCode, 400)
  assert.deepEqual((await request('/api/view-state', 'GET')).body.viewState, viewState)
  const selection = { selectedShapes: [{ id: 'shape:fixture', type: 'geo' }] }
  assert.equal((await request('/api/selection', 'PUT', selection)).statusCode, 200)
  assert.deepEqual((await request('/api/selection', 'GET')).body.selection, selection)
})

test('部分损坏的快照必须拒绝保存，不得删减后覆盖原画板', async () => {
  const original = snapshot()
  await request('/api/canvas', 'PUT', original)
  const damaged = structuredClone(original)
  const page = Object.values(original.store).find(r => r.typeName === 'page')
  damaged.store['shape:damaged'] = { id: 'shape:damaged', typeName: 'shape', type: 'geo', parentId: page.id, props: {} }
  assert.equal((await request('/api/canvas', 'PUT', damaged)).statusCode, 400)
  assert.deepEqual((await loadCanvasSnapshot()).snapshot, original)
})

test('已有文件含损坏记录时停止加载，原始文件保持不变', async () => {
  const original = snapshot()
  await saveCanvasSnapshot(original)
  const page = Object.values(original.store).find(r => r.typeName === 'page')
  const file = join(canvasDir, 'pages', encodeURIComponent(page.id.slice(5)), 'cowart-canvas.json')
  const damaged = structuredClone(original)
  damaged.store['shape:damaged'] = { id: 'shape:damaged', typeName: 'shape', type: 'geo', parentId: page.id, props: {} }
  const contents = JSON.stringify(damaged)
  await writeFile(file, contents)
  assert.equal((await request('/api/canvas', 'GET')).statusCode, 500)
  assert.equal(await readFile(file, 'utf8'), contents)
})
