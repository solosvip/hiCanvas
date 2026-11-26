import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { b64Vecs } from '@tldraw/tlschema'
import { getShapeBounds, getShapeContour, pointInShape, hitTestCanvas, getShapePageBounds } from '../renderer/geometry.js'
import { createFixture } from './perf/fixture.mjs'
import { addStrokeLoad } from './renderer-preview/stroke-fixtures.js'

const segment = (points, type = 'free') => ({ type, path: b64Vecs.encodePoints(points.map(p => ({ z: 0.5, ...p }))) })
const stroke = (props = {}, type = 'draw', extra = {}) => ({ id: 'shape:ink', typeName: 'shape', type, parentId: 'page:one', index: 'a1', x: 0, y: 0, rotation: 0, opacity: 1, meta: {},
  props: { color: 'black', size: 'm', scale: 1, scaleX: 1, scaleY: 1, isPen: false, isComplete: true, segments: [segment([{ x: 0, y: 0 }, { x: 100, y: 0 }], 'straight')], ...(type === 'draw' ? { dash: 'solid', fill: 'none', isClosed: false } : {}), ...props }, ...extra })

test('画笔直线按实际轮廓命中，含负坐标的圆头进入外框，空白不拦截', () => {
  const shape = stroke()
  assert.equal(pointInShape(shape, { x: 50, y: 0 }), true)
  assert.equal(pointInShape(shape, { x: 50, y: 30 }), false)
  assert.equal(pointInShape(shape, { x: -0.25, y: 0 }), true)
  const bounds = getShapeBounds(shape)
  assert.ok(bounds.x < 0 && bounds.y < 0 && bounds.w > 100 && bounds.h > 0)
  const contour = getShapeContour(shape)
  assert.ok(contour.outline.length > 2)
  assert.deepEqual(getShapeContour(shape), getShapeContour(structuredClone(shape)))
})

test('自由笔迹沿折线平滑，弯曲外框里的空白不误命中；Shift直线段可接续', () => {
  const shape = stroke({ segments: [segment([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }])] })
  assert.equal(pointInShape(shape, { x: 0, y: 60 }), true)
  assert.equal(pointInShape(shape, { x: 50, y: 50 }), false)
  const mixed = stroke({ segments: [segment([{ x: 0, y: 0 }, { x: 0, y: 50 }]), segment([{ x: 0, y: 50 }, { x: 100, y: 50 }], 'straight')] })
  assert.equal(pointInShape(mixed, { x: 60, y: 50 }), true)
  assert.equal(pointInShape(mixed, { x: 60, y: 25 }), false)
})

test('闭合线保留空心，六种填充只在闭合笔迹内部命中', () => {
  const segments = [segment([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }], 'straight')]
  for (const fill of ['none', 'semi', 'solid', 'pattern', 'lined-fill', 'fill']) {
    assert.equal(pointInShape(stroke({ segments, isClosed: true, fill }), { x: 50, y: 50 }), fill !== 'none', fill)
    assert.equal(pointInShape(stroke({ segments, isClosed: false, fill }), { x: 50, y: 50 }), false, `open ${fill}`)
  }
})

test('虚线和圆点的空隙可穿透，端帽圆点及四档实线粗细按测量值命中', () => {
  for (const [size, width] of Object.entries({ s: 3, m: 4.5, l: 6, xl: 11 })) {
    assert.equal(pointInShape(stroke({ size }), { x: 50, y: width / 2 - 0.01 }), true)
    assert.equal(pointInShape(stroke({ size }), { x: 50, y: width / 2 + 0.01 }), false)
  }
  assert.equal(pointInShape(stroke({ dash: 'dashed' }), { x: 4, y: 0 }), true)
  assert.equal(pointInShape(stroke({ dash: 'dashed' }), { x: 13.5, y: 0 }), false)
  assert.equal(pointInShape(stroke({ dash: 'dotted' }), { x: 0, y: 0 }), true)
  assert.equal(pointInShape(stroke({ dash: 'dotted' }), { x: 4.55, y: 0 }), false)
  const dot = stroke({ segments: [segment([{ x: -20, y: -10 }])] })
  assert.equal(pointInShape(dot, { x: -20, y: -10 }), true)
  assert.equal(pointInShape(dot, { x: -16, y: -6 }), false)
})

test('压感笔迹随压力变粗；荧光笔保持测得宽度，重复计算不改记录', () => {
  const pressure = z => [segment([{ x: 0, y: 0, z }, { x: 100, y: 0, z }], 'straight')]
  const thin = stroke({ dash: 'draw', isPen: true, segments: pressure(0.1) })
  const thick = stroke({ dash: 'draw', isPen: true, segments: pressure(1) })
  assert.equal(pointInShape(thin, { x: 50, y: 4 }), false)
  assert.equal(pointInShape(thick, { x: 50, y: 4 }), true)
  for (const [size, width] of Object.entries({ s: 20.16, m: 26.88, l: 40.32, xl: 49.28 })) {
    const shape = stroke({ size, isPen: true, segments: pressure(0.1) }, 'highlight'), copy = structuredClone(shape)
    assert.equal(pointInShape(shape, { x: 50, y: width / 2 - 0.01 }), true)
    assert.equal(pointInShape(shape, { x: 50, y: width / 2 + 0.01 }), false)
    assert.deepEqual(getShapeContour(shape), getShapeContour(structuredClone(shape)))
    assert.deepEqual(shape, copy)
  }
})

test('非等比镜像、父子旋转、画框裁切和相机换算仍按笔迹轮廓查询', () => {
  const mirrored = stroke({ scaleX: -2, scaleY: 0.5 })
  assert.equal(pointInShape(mirrored, { x: -100, y: 1 }), true)
  assert.equal(pointInShape(mirrored, { x: 100, y: 0 }), false)
  const shape = stroke({}, 'draw', { parentId: 'shape:frame', x: 20, y: 10, rotation: Math.PI / 2 })
  const frame = { ...stroke(), id: 'shape:frame', type: 'frame', x: 100, y: 50, rotation: 0, props: { w: 80, h: 80 } }
  const snapshot = { store: { [frame.id]: frame, [shape.id]: shape } }, camera = { x: -10, y: 20, z: 2 }
  assert.equal(hitTestCanvas(snapshot, { x: 220, y: 220 }, camera, 'page:one'), shape.id)
  assert.equal(hitTestCanvas(snapshot, { x: 220, y: 320 }, camera, 'page:one'), null)
  const bounds = getShapePageBounds(snapshot, shape.id)
  assert.ok(Math.abs(bounds.x - 117.75) < 0.01 && Math.abs(bounds.h - 104.5) < 0.01)
})

test('原路折返和退化闭合保留圆形笔触，不在折返点收为零宽', () => {
  const segments = [segment([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }], 'straight')]
  for (const isClosed of [false, true]) {
    const shape = stroke({ segments, isClosed })
    assert.equal(pointInShape(shape, { x: 99, y: 1 }), true)
    assert.equal(pointInShape(shape, { x: 101, y: 1 }), true)
    assert.equal(pointInShape(shape, { x: 100, y: 3 }), false)
  }
  const dashed = stroke({ dash: 'dashed', segments: [segment([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 0, y: 0 }], 'straight')] })
  assert.equal(pointInShape(dashed, { x: 80, y: 1 }), true)
  const seam = stroke({ isClosed: true, segments: [segment([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 4, y: 0 }], 'straight')] })
  assert.equal(pointInShape(seam, { x: 0, y: 1 }), true)
})

test('500条笔迹负载保留原500元素和相机，新增250画笔250荧光笔共64500点', () => {
  const fixture = createFixture(500), before = structuredClone(fixture), loaded = addStrokeLoad(fixture)
  assert.deepEqual(fixture, before)
  assert.deepEqual(loaded.viewState, fixture.viewState)
  for (const [id, record] of Object.entries(fixture.snapshot.store)) assert.deepEqual(loaded.snapshot.store[id], record)
  const added = Object.values(loaded.snapshot.store).filter(r => !fixture.snapshot.store[r.id])
  assert.equal(loaded.count, 1000)
  assert.equal(added.filter(r => r.type === 'draw').length, 250)
  assert.equal(added.filter(r => r.type === 'highlight').length, 250)
  assert.equal(added.reduce((sum, r) => sum + r.props.segments.reduce((n, s) => n + b64Vecs.decodePoints(s.path).length, 0), 0), 64500)
})
