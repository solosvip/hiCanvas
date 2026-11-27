import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, getSlidesPages, planSlidesLayout, isSlidesPage } from '../engine/index.js'
import * as engine from '../engine/index.js'
import { Store } from '@tldraw/store'
import { getIndicesAbove } from '@tldraw/utils'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

const frame = (meta = {}) => ({ type: 'create_shape', id: 'shape:d', shapeType: 'frame', rotation: .37, props: { w: 1600, h: 900 }, meta: { cowartAiSlides: true, ...meta } })
const page = (id, x, w, h, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'image', parentId: 'shape:d', x, y: 80, rotation: .2, props: { w, h }, ...extra })
const create = commands => executeCanvasCommands(createCanvasSnapshot(), commands).snapshot
const pages = snapshot => getSlidesPages(snapshot.store['shape:d'], Object.values(snapshot.store))

test('不等宽页按中心而非左边缘排，中心相同按 index 而非页号排', () => {
  const snapshot = create([frame(), page('p1', 40, 240, 140), page('p2', 400, 1300, 220), page('p3', 850, 180, 170)])
  assert.deepEqual(pages(snapshot).map(r => [r.id, r.x]), [['shape:p1', 12], ['shape:p3', 284], ['shape:p2', 496]])
  assert.deepEqual([snapshot.store['shape:d'].props.w, snapshot.store['shape:d'].props.h], [1808, 600])
  assert.equal(snapshot.store['shape:d'].rotation, .37)
  const raw = create([frame()])
  const tie = executeCanvasCommands(raw, [page('p1', 40, 360, 140, { meta: { cowartAiSlidesGeneratedPage: 1 } }), page('p2', 100, 240, 220, { meta: { cowartAiSlidesGeneratedPage: 99 } })]).snapshot
  // Restore the observed equal centers with parent index opposite to left edge.
  tie.store['shape:p1'].x = 40; tie.store['shape:p1'].index = 'a1000021'
  tie.store['shape:p2'].x = 100; tie.store['shape:p2'].index = 'a1000011'
  assert.deepEqual(pages(tie).map(r => r.id), ['shape:p2', 'shape:p1'])
  assert.deepEqual(planSlidesLayout(tie.store['shape:d'], Object.values(tie.store)).filter(r => r.x !== undefined).map(r => [r.id, r.x]), [['shape:p2', 12], ['shape:p1', 284]])
})

for (const [padding, gap, expected] of [[0, 0, [12, 284, 676]], [-10, -20, [-10, 210, 550]], [.5, 1.25, [.5, 241.75, 603]], ['10', '20', [10, 270, 650]], ['invalid', null, [12, 284, 676]]]) test(`旧参数兼容 pad=${padding} gap=${gap}，收尾后再次布局没有变化`, () => {
  const snapshot = create([frame({ cowartAiSlidesPadding: padding, cowartAiSlidesGap: gap }), page('p1', 40, 240, 140), page('p2', 400, 360, 220), page('p3', 850, 180, 170)])
  assert.deepEqual(pages(snapshot).map(r => r.x), expected)
  assert.equal(snapshot.store['shape:d'].meta.cowartAiSlidesPadding, padding)
  assert.deepEqual(planSlidesLayout(snapshot.store['shape:d'], Object.values(snapshot.store)), [])
})

test('仅直接图片和自有 HTML 算页，普通元素和组不拆；空框保留尺寸', () => {
  const snapshot = create([frame(), { type: 'create_shape', id: 'shape:g', shapeType: 'group', parentId: 'shape:d' }, page('nested', 20, 240, 140, { parentId: 'shape:g' }), { type: 'create_shape', id: 'shape:geo', shapeType: 'geo', parentId: 'shape:d', x: 100, y: 100 }])
  assert.deepEqual(pages(snapshot), [])
  assert.equal(snapshot.store['shape:d'].props.w, 1600)
  assert.equal(snapshot.store['shape:geo'].x, 100)
  for (const url of ['data:text/html,<h1>x</h1>', '/assets/p.html', '/c/synthetic/page-assets/p.htm', 'http://cowart.local/assets/p.html']) assert.equal(isSlidesPage({ type: 'embed', props: { url } }), true)
  assert.equal(isSlidesPage({ type: 'embed', props: { url: 'https://example.invalid/page.html' } }), false)
})

test('单张大页撑开外框，非有限最终几何拒绝且不污染输入', () => {
  const snapshot = create([frame(), page('big', 40, 1200, 700)])
  assert.deepEqual([snapshot.store['shape:d'].props.w, snapshot.store['shape:d'].props.h], [1224, 724])
  const before = structuredClone(snapshot)
  assert.throws(() => executeCanvasCommands(snapshot, [{ type: 'update', id: 'shape:d', changes: { meta: { cowartAiSlidesPadding: Number.MAX_VALUE } } }]), e => e.code === 'slides-layout-overflow')
  assert.deepEqual(snapshot, before)
})

test('负间距不能反转页中心：夹到相邻中心差1，meta不变，再排零改动', () => {
  const snapshot = create([frame({ cowartAiSlidesGap: -1000 }), page('p1', 40, 240, 140), page('p2', 400, 360, 220)])
  assert.deepEqual(pages(snapshot).map(r => [r.id, r.x]), [['shape:p1', 12], ['shape:p2', -47]])
  assert.equal(snapshot.store['shape:d'].meta.cowartAiSlidesGap, -1000)
  assert.deepEqual(planSlidesLayout(snapshot.store['shape:d'], Object.values(snapshot.store)), [])
})

test('旧界面公开适配对编辑层最终结果再排时零写入，锁页不部分排版', async () => {
  const bundled = await build({ stdin: { contents: "export {layoutAiSlides,getAiSlidesItems,adoptGeneratedAiSlidesItems} from './src/editor/slidesLayout.jsx'", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, format: 'cjs', platform: 'node', plugins: [{ name: 'public-boundary', setup(builder) {
    builder.onResolve({ filter: /./ }, args => args.path === '../../engine/index.js' || /\/(?:assets|configuration)\.jsx$/.test(args.path) ? { path: args.path, external: true, sideEffects: false } : undefined)
  } }] })
  const adapter = runInNewContext(bundled.outputFiles[0].text + ';module.exports', { module: { exports: {} }, exports: {}, require: path => { assert.equal(path, '../../engine/index.js'); return engine } })
  const snapshot = create([frame(), page('p1', 40, 240, 140), page('p2', 400, 360, 220)])
  let writes = 0
  const editor = { getShape: id => snapshot.store[id], getSortedChildIdsForParent: id => Object.values(snapshot.store).filter(r => r.parentId === id).map(r => r.id), updateShapes: () => { writes++ } }
  assert.equal(adapter.layoutAiSlides(editor, 'shape:d'), false)
  assert.equal(writes, 0)
  snapshot.store['shape:p2'].isLocked = true
  snapshot.store['shape:p1'].x = 999
  assert.equal(adapter.layoutAiSlides(editor, 'shape:d'), false)
  assert.equal(writes, 0, '旧计时器不能绕过新锁门禁只移动其他页')
  assert.equal(adapter.adoptGeneratedAiSlidesItems({ getCurrentPageShapes() { assert.fail('旧计时器不应扫描历史页') }, reparentShapes() { assert.fail('旧计时器不应把历史页拉回') } }), false)
})

test('5000 个无关元素的事务不会查询 Slides 子页', () => {
  const snapshot = create([frame(), page('p1', 40, 240, 140), { type: 'create_shape', id: 'shape:ordinary', shapeType: 'geo' }])
  const indices = getIndicesAbove(snapshot.store['shape:ordinary'].index, 5000)
  for (let i = 0; i < 5000; i++) snapshot.store[`shape:unrelated${i}`] = { ...snapshot.store['shape:ordinary'], id: `shape:unrelated${i}`, index: indices[i], x: 5000 + i * 20 }
  let queries = 0
  // Performance instrumentation at the real MIT Store boundary, with its
  // implementation still running. No editing module is replaced by a mock.
  const atomic = Store.prototype.atomic, wrapped = new WeakSet()
  Store.prototype.atomic = function (...args) {
    if (!wrapped.has(this)) {
      wrapped.add(this)
      const records = this.query.records.bind(this.query)
      this.query.records = (...query) => { if (query[1]?.().parentId?.eq === 'shape:d') queries++; return records(...query) }
    }
    return atomic.apply(this, args)
  }
  try {
    const result = executeCanvasCommands(snapshot, [{ type: 'update', id: 'shape:unrelated4999', changes: { x: 123456 } }])
    assert.equal(queries, 0)
    assert.deepEqual(Object.keys(result.changes.updated), ['shape:unrelated4999'])
  } finally { Store.prototype.atomic = atomic }
})


test('页宽的非数值与数字串在间距夹值、页序和槽位中采用同一归一值', () => {
  const container = { id: 'shape:d', type: 'frame', props: { w: 1048, h: 600 }, meta: { cowartAiSlides: true, cowartAiSlidesGap: -1000 } }
  const children = ['invalid', undefined, '2'].map((w, i) => ({ id: `shape:${i}`, type: 'image', parentId: container.id, x: 100 + i * 100, y: 80, rotation: 0, index: `a${i + 1}`, props: { w, h: 100 } }))
  const updates = planSlidesLayout(container, children)
  assert.deepEqual(updates.filter(r => r.x !== undefined).map(r => [r.id, r.x]), [['shape:0', 12], ['shape:1', 13], ['shape:2', 14]])
  const laid = children.map(r => ({ ...r, ...updates.find(update => update.id === r.id) }))
  assert.deepEqual(planSlidesLayout(container, laid), [])
  assert.deepEqual(children.map(r => r.props.w), ['invalid', undefined, '2'])
})
