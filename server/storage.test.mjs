import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvasStore } from './canvas-snapshot.mjs'
import { createCanvasStorage } from './storage.mjs'

const project = await mkdtemp(join(tmpdir(), 'hicanvas-storage-'))
process.env.HICANVAS_PROJECT_DIR = project
const { canvasDir, loadCanvasSnapshot, saveCanvasSnapshot, serveCanvasAsset } = await import('./storage.mjs')
beforeEach(() => rm(canvasDir, { recursive: true, force: true }))
after(() => rm(project, { recursive: true, force: true }))
const { fixture } = await import('./test-helpers.mjs')

function snapshot() {
  const store = createCanvasStore()
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

test('HTTP 保存与重开使用同一份画板，非法输入不会覆盖已有文件', async t => {
  const { api } = await fixture(t)
  const path = '/api/canvas?conversation=legacy'
  const original = (await api(path)).body
  assert.equal((await api(path, 'PUT', { snapshot: original.snapshot, expectedRevision: original.revision })).status, 200)
  const current = (await api(path)).body
  assert.deepEqual(current.snapshot, original.snapshot)
  assert.equal((await api(path, 'PUT', { snapshot: { invalid: true }, expectedRevision: current.revision })).status, 400)
  assert.deepEqual((await api(path)).body.snapshot, original.snapshot)
  assert.equal((await api(path, 'POST', {})).status, 405)
})

test('非法视口不会覆盖有效状态；选择项可以恢复', async t => {
  const { api } = await fixture(t)
  const viewState = { version: 1, currentPageId: 'page:fixture', camera: { x: 20, y: -10, z: 1.5 } }
  const view = '/api/view-state?conversation=legacy'
  assert.equal((await api(view, 'PUT', viewState)).status, 200)
  assert.equal((await api(view, 'PUT', { ...viewState, camera: { x: 1, y: 0, z: null } })).status, 400)
  assert.deepEqual((await api(view)).body.viewState, viewState)
  const selection = { selectedShapes: [{ id: 'shape:fixture', type: 'geo' }] }
  assert.equal((await api('/api/selection?conversation=legacy', 'PUT', selection)).status, 200)
  assert.deepEqual((await api('/api/selection?conversation=legacy')).body.selection, selection)
})

test('已有旧文件含损坏记录时停止导入，原始文件保持不变', async t => {
  const { api, root } = await fixture(t)
  const storage = createCanvasStorage(root)
  const original = snapshot()
  await storage.saveCanvasSnapshot(original)
  const page = Object.values(original.store).find(r => r.typeName === 'page')
  const file = join(root, 'pages', encodeURIComponent(page.id.slice(5)), 'cowart-canvas.json')
  const damaged = structuredClone(original)
  damaged.store['shape:damaged'] = { id: 'shape:damaged', typeName: 'shape', type: 'geo', parentId: page.id, props: {} }
  const contents = JSON.stringify(damaged)
  await writeFile(file, contents)
  assert.equal((await api('/api/canvas?conversation=legacy')).status, 400)
  assert.equal(await readFile(file, 'utf8'), contents)
})
