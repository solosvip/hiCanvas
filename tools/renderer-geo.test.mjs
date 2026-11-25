import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { GeoShapeGeoStyle } from '@tldraw/tlschema'
import { getShapeContour, getShapeBounds, pointInShape, hitTestCanvas } from '../renderer/geometry.js'

const shape = (geo, props = {}, extra = {}) => ({ id: 'shape:test', typeName: 'shape', type: 'geo', parentId: 'page:one', index: 'a1', x: 0, y: 0, rotation: 0, opacity: 1, props: { geo, w: 200, h: 120, growY: 0, scale: 1, size: 'm', fill: 'solid', dash: 'solid', ...props }, ...extra })

// Independent landmarks: these catch replacing a kind with its rectangle box.
const landmarks = {
  rectangle: [[0, 60], [-10, 60]], ellipse: [[200, 60], [10, 10]],
  triangle: [[100, 0], [10, 10]], diamond: [[0, 60], [10, 10]],
  pentagon: [[100, 0], [5, 5]], hexagon: [[100, 0], [5, 5]], octagon: [[100, 0], [5, 5]],
  star: [[100, 0], [20, 15]], rhombus: [[50, 0], [10, 10]], 'rhombus-2': [[0, 0], [190, 10]],
  oval: [[100, 0], [5, 5]], trapezoid: [[40, 0], [5, 5]],
  'arrow-right': [[200, 60], [20, 10]], 'arrow-left': [[0, 60], [180, 10]],
  'arrow-up': [[100, 0], [10, 100]], 'arrow-down': [[100, 120], [10, 20]],
  'x-box': [[0, 60], [-10, 60]], 'check-box': [[0, 60], [-10, 60]],
  heart: [[100, 120], [100, 0]], cloud: [null, [5, 5]]
}

for (const geo of GeoShapeGeoStyle.values) test(`${geo}：宽高决定闭合轮廓，轮廓点命中、中心在内、远点在外`, () => {
  const record = shape(geo), contour = getShapeContour(record)
  assert.ok(contour.outline.length >= 3)
  assert.ok(contour.outline.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)))
  assert.deepEqual(getShapeBounds(record), { x: 0, y: 0, w: 200, h: 120 })
  assert.ok(Math.abs(Math.min(...contour.outline.map(p => p.x))) < 1e-9)
  assert.ok(Math.abs(Math.max(...contour.outline.map(p => p.x)) - 200) < 1e-9)
  assert.ok(Math.abs(Math.min(...contour.outline.map(p => p.y))) < 1e-9)
  assert.ok(Math.abs(Math.max(...contour.outline.map(p => p.y)) - 120) < 1e-9)
  assert.equal(pointInShape(record, contour.outline[0]), true)
  assert.equal(pointInShape(record, { x: 100, y: 60 }), true)
  assert.equal(pointInShape(record, { x: -20, y: -20 }), false)
  const [edge, outside] = landmarks[geo]
  if (edge) assert.equal(pointInShape(record, { x: edge[0], y: edge[1] }), true)
  assert.equal(pointInShape(record, { x: outside[0], y: outside[1] }), false)
})

test('凹形缺口不按外框误命中，层级查询穿透缺口找到下面的形状', () => {
  const cases = [['star', { x: 20, y: 15 }], ['arrow-right', { x: 20, y: 10 }], ['arrow-left', { x: 180, y: 10 }], ['arrow-up', { x: 10, y: 100 }], ['arrow-down', { x: 10, y: 20 }], ['heart', { x: 100, y: 0 }]]
  for (const [geo, point] of cases) {
    const record = shape(geo)
    assert.equal(pointInShape(record, point), false, geo)
    const bottom = shape('rectangle', {}, { id: 'shape:bottom', index: 'a0' })
    const snapshot = { store: { 'page:one': { id: 'page:one', typeName: 'page' }, [record.id]: record, [bottom.id]: bottom } }
    assert.equal(hitTestCanvas(snapshot, point), bottom.id, geo)
  }
})

test('六种填充保留无填充穿透规则；叉号和勾号的内部线也参与命中', () => {
  for (const fill of ['none', 'semi', 'solid', 'pattern', 'lined-fill', 'fill']) {
    assert.equal(pointInShape(shape('diamond', { fill }), { x: 100, y: 60 }), fill !== 'none')
  }
  assert.equal(pointInShape(shape('x-box', { fill: 'none' }), { x: 100, y: 60 }), true)
  assert.equal(pointInShape(shape('check-box', { fill: 'none' }), { x: 86, y: 86.4 }), true)
  assert.equal(pointInShape(shape('rectangle', { fill: 'none' }), { x: 100, y: 60 }), false)
})

test('横竖胶囊的长边为直线，圆角保留半圆；尺寸变化不复用过期轮廓', () => {
  for (const [w, h] of [[200, 60], [60, 200], [60, 60]]) {
    const record = shape('oval', { w, h })
    assert.equal(pointInShape(record, { x: w / 2, y: h / 2 }), true)
    assert.equal(pointInShape(record, { x: 0, y: 0 }), false)
    assert.equal(pointInShape(record, { x: w / 2, y: 0 }), true)
    assert.equal(pointInShape(record, { x: 0, y: h / 2 }), true)
  }
  const record = shape('triangle'), initial = getShapeContour(record)
  record.props.w = 300; record.props.growY = 50
  assert.notEqual(getShapeContour(record), initial)
  assert.deepEqual(getShapeBounds(record), { x: 0, y: 0, w: 300, h: 170 })
})

test('无填充粗描边的外缘参与查询，scale 同时影响线宽', () => {
  assert.equal(pointInShape(shape('rectangle', { fill: 'none', size: 's' }), { x: -2, y: 60 }), false)
  assert.equal(pointInShape(shape('rectangle', { fill: 'none', size: 'xl' }), { x: -2, y: 60 }), true)
  assert.equal(pointInShape(shape('rectangle', { fill: 'none', size: 'xl', scale: 2 }), { x: -5, y: 60 }), true)
})
