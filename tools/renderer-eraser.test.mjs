import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { checkedOverlays } from '../renderer/overlays.js'
import { EraserOverlay } from '../renderer/eraser-overlay.js'
import { createEraserPreview } from '../renderer/eraser-preview.js'
import { computed } from '@tldraw/state'
import { drawFixture } from './draw-fixture.mjs'

test('覆盖层内部校验复制擦除ID和尾迹，拒绝坏坐标/ID/宽度，支持只有淡化没有尾迹', () => {
  const input = { kind: 'eraser', ids: ['shape:a'], points: [{ x: 20, y: 30 }, { x: 40, y: 50 }], tailScale: 1 }
  const [checked] = checkedOverlays([input])
  input.ids.push('shape:b'); input.points[0].x = -100
  assert.deepEqual(checked.ids, ['shape:a']); assert.equal(checked.points[0].x, 20)
  assert.ok(Object.isFrozen(checked.points[0])); assert.ok(Object.isFrozen(checked.ids))
  assert.deepEqual(checked.bounds, { x: 20, y: 30, w: 20, h: 20 })
  assert.deepEqual(checkedOverlays([{ kind: 'eraser', ids: ['shape:a'], points: [] }])[0].points, [])
  for (const bad of [{ ids: ['bad'] }, { points: [{ x: NaN, y: 0 }] }, { points: Array(1) }, { points: Array.from({ length: 257 }, () => ({ x: 0, y: 0 })) }, { tailScale: 2 }]) {
    assert.throws(() => checkedOverlays([{ kind: 'eraser', ids: [], points: [], ...bad }]), /擦除/)
  }
})

test('尾迹宽度随视角反比换算，点击淡化不画空尾迹，收尾倍率通过同一令牌', () => {
  const [item] = checkedOverlays([{ kind: 'eraser', ids: [], points: [{ x: 20, y: 30 }], tailScale: .5 }])
  const html = renderToStaticMarkup(createElement(EraserOverlay, { item, zoom: 2 }))
  assert.match(html, /M20,30 L20,30/); assert.match(html, /stroke-linecap="round"/)
  assert.match(html, /calc\(var\(--spacing-overlay-eraser-stroke\) \* 0.5 \/ 2\)/)
  assert.equal(renderToStaticMarkup(createElement(EraserOverlay, { item: { ...item, points: [] }, zoom: 1 })), '')
})

test('淡化只通知目标的订阅，不写Store；删除再恢复ID不会继承预览', async () => {
  const f = await drawFixture(['a', 'b'].map((id, i) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'geo', x: i * 200 })))
  const preview = createEraserPreview(f.session.store, '#00000052'), counts = { a: 0, b: 0 }
  const readers = Object.fromEntries(['a', 'b'].map(id => [id, computed(id, () => { counts[id]++; return preview.read(`shape:${id}`) })]))
  try {
    assert.equal(readers.a.get(), false); assert.equal(readers.b.get(), false)
    const before = f.session.store.getStoreSnapshot()
    preview.set([{ kind: 'eraser', ids: ['shape:a'] }])
    assert.equal(readers.a.get(), true); assert.equal(readers.b.get(), false)
    assert.deepEqual(counts, { a: 2, b: 1 }); assert.deepEqual(f.session.store.getStoreSnapshot(), before)
    preview.set([{ kind: 'eraser', ids: ['shape:a'] }]); readers.a.get(); assert.equal(counts.a, 2)
    await f.session.commitCommands([{ type: 'delete', ids: ['shape:a'] }]); await f.session.undo()
    assert.equal(preview.read('shape:a'), false)
    assert.equal(readers.a.get(), false)
    preview.set([]); assert.equal(readers.b.get(), false); assert.equal(counts.b, 1)
  } finally { preview.dispose(); f.close() }
})

test('淡化解析令牌alpha并乘原opacity，清除后不残留；坏令牌明确拒绝', async () => {
  const f = await drawFixture([{ type: 'create_shape', id: 'shape:a', shapeType: 'geo' }])
  const preview = createEraserPreview(f.session.store, ' #00000052 ')
  try {
    assert.equal(preview.opacity('shape:a', .5), .5)
    preview.set([{ kind: 'eraser', ids: ['shape:a'] }])
    assert.equal(preview.opacity('shape:a', .5), .5 * 82 / 255)
    assert.equal(preview.opacity('shape:a', 0), 0)
    assert.equal(preview.opacity('shape:a'), 82 / 255)
    preview.set([]); assert.equal(preview.opacity('shape:a', .5), .5)
    for (const color of ['', '#000000', '#000000zz', 'rgba(0,0,0,.32)']) assert.throws(() => createEraserPreview(f.session.store, color), /淡化.*令牌/)
  } finally { preview.dispose(); f.close() }
})
