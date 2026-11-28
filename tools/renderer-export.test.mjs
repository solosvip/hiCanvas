import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, createEditorSession } from '../engine/index.js'
import { createExportFixture, createExternalExportFixture } from './renderer-preview/export-fixture.js'
import { preflightCanvasExport, renderCanvasExport } from '../renderer/index.js'
import { readFile } from 'node:fs/promises'

function fixture(commands) { return executeCanvasCommands(createCanvasSnapshot(), commands).snapshot }
const rect = (id, x, y, props = {}, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'geo', x, y, props: { w: 200, h: 100, dash: 'solid', size: 'm', ...props }, ...extra })

test('固定快照导出选择或整页，向外取整且不受相机、锁和透明度影响', async () => {
  const snapshot = fixture([rect('a', 200, 240), rect('b', 620, 410, {}, { isLocked: true, opacity: 0 })])
  snapshot.store['shape:b'] = { ...snapshot.store['shape:b'], opacity: 0, isLocked: true }
  const before = structuredClone(snapshot)
  const single = preflightCanvasExport(snapshot, { ids: ['shape:a'] })
  assert.deepEqual(single.bounds, { x: 198, y: 238, w: 204, h: 104 })
  assert.equal(single.width, 408); assert.equal(single.height, 208)
  const all = await renderCanvasExport(snapshot, { format: 'svg' })
  assert.deepEqual(all.bounds, { x: 198, y: 238, w: 624, h: 274 })
  assert.equal(all.width, 624); assert.equal(all.height, 274); assert.equal(all.scale, 1)
  const xml = new TextDecoder().decode(all.bytes)
  assert.match(xml, /viewBox="198 238 624 274"/)
  assert.match(xml, /opacity="0"/)
  assert.doesNotMatch(xml, /foreignObject|iframe|script/)
  assert.deepEqual(snapshot, before)
  assert.equal((await renderCanvasExport(createCanvasSnapshot(), { format: 'svg' })).status, 'empty')
})

test('SVG共享文字布局，保留中英粗斜体与便签署名并内联所用字体', async () => {
  const snapshot = fixture([{ type: 'create_shape', id: 'shape:t', shapeType: 'text', text: '中文\nHello' }, { type: 'create_shape', id: 'shape:n', shapeType: 'note', x: 500, text: '便签' }])
  snapshot.store['shape:n'].props.textFirstEditedBy = 'synthetic'
  snapshot.store['user:synthetic'] = { id: 'user:synthetic', typeName: 'user', name: 'Synthetic Longname' }
  snapshot.store['shape:t'].props.richText.content[1].content[0].marks = [{ type: 'bold' }, { type: 'italic' }]
  const result = await renderCanvasExport(snapshot, { format: 'svg', readAsset: async url => ({ bytes: new Uint8Array(await readFile(url)), type: 'font/woff2' }) })
  const xml = new TextDecoder().decode(result.bytes)
  assert.match(xml, /中文/); assert.match(xml, /Hello/); assert.match(xml, /Synthetic/)
  assert.doesNotMatch(xml, /Longname|foreignObject/)
  assert.match(xml, /font-weight:700/); assert.match(xml, /font-style:italic/)
  assert.match(xml, /data:font\/woff2;base64,/)
})

test('只选父框内子项保留旋转祖先和裁剪，不把框背景和兄弟带入输出', async () => {
  const snapshot = fixture([{ type: 'create_shape', id: 'shape:f', shapeType: 'frame', x: -10, y: 20, props: { w: 100, h: 80 } }, rect('a', 70, 10, { w: 80, h: 40 }), rect('b', 300, 0)])
  snapshot.store['shape:a'].parentId = 'shape:f'
  snapshot.store['shape:f'].rotation = Math.PI / 2
  const result = await renderCanvasExport(snapshot, { ids: ['shape:a'], format: 'svg' })
  assert.deepEqual(result.bounds, { x: -62, y: 88, w: 44, h: 32 })
  const xml = new TextDecoder().decode(result.bytes)
  assert.match(xml, /clipPath/); assert.match(xml, /rotate\(90\)/)
  assert.doesNotMatch(xml, /shape:b|Frame|stroke-width="2"/)
})

test('显式范围供标注调用，分配前拒绝巨图、无效倍率和注入背景', async () => {
  const snapshot = fixture([rect('a', -.1, -.1)])
  assert.deepEqual(preflightCanvasExport(snapshot, { bounds: { x: -2.2, y: 3.1, w: 10.3, h: 20.4 }, scale: 1 }).bounds, { x: -3, y: 3, w: 12, h: 21 })
  let allocations = 0
  await assert.rejects(renderCanvasExport(snapshot, { bounds: { x: 0, y: 0, w: 10000, h: 10000 }, document: { createElement() { allocations++ } } }), /上限/)
  assert.equal(allocations, 0)
  assert.throws(() => preflightCanvasExport(snapshot, { scale: NaN }), /倍率/)
  await assert.rejects(renderCanvasExport(snapshot, { format: 'svg', background: 'url(https://example.invalid/pixel)' }), /背景/)
})

test('水平线保留圆头描边的真实厚度，不因几何高度为零而空白或截边', async () => {
  const snapshot = fixture([{ type: 'create_shape', id: 'shape:line', shapeType: 'line', x: -10, y: 30, props: { size: 'm', points: { a1: { id: 'a1', index: 'a1', x: 0, y: 0 }, a2: { id: 'a2', index: 'a2', x: 100, y: 0 } } } }])
  assert.deepEqual(preflightCanvasExport(snapshot).bounds, { x: -12, y: 28, w: 104, h: 4 })
})

test('全部原生导出夹具均通过真实编辑会话的数据校验，包括书签、动画和网络', async () => {
  for (const kind of ['static', 'text', 'media', 'empty', 'animation', 'decorations', 'external', 'detached-external', 'network']) {
    const fixture = kind === 'detached-external' ? { snapshot: createExternalExportFixture(), count: 2 } : createExportFixture(undefined, kind)
    const session = await createEditorSession({ actor: 'synthetic', transport: {
      read: async () => ({ snapshot: fixture.snapshot, revision: '0' }), subscribe: () => () => {},
      commit: async () => { throw new Error('观察不应提交') },
    } })
    try { assert.equal(session.store.allRecords().filter(record => record.typeName === 'shape').length, fixture.documentCount ?? fixture.count) }
    finally { session.dispose() }
  }
})

test('尺寸超限附结构化实际宽高和原上限，原消息/向外取整完全保留', () => {
  const snapshot = fixture([rect('a', 0, 0)])
  assert.throws(() => preflightCanvasExport(snapshot, { bounds: { x: .25, y: .5, w: 8192, h: 100 }, scale: 1 }), error => {
    assert.equal(error.message, '输出超过8192边长或1600万像素上限。')
    assert.equal(error.code, 'export-size-limit')
    assert.deepEqual([error.width, error.height], [8193, 101])
    assert.deepEqual(error.limits, { edge: 8192, pixels: 16_000_000, bytes: 64_000_000, timeout: 30_000 })
    return true
  })
})
