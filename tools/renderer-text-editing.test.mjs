import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands } from '../engine/index.js'
import { getShapeTextLayout } from '../renderer/geometry.js'

// Independent native legacy DOM readings, 2026-11-26: 250x250 sans geo,
// Alpha Beta, m22, nine alignment pairs. Chromium quantizes to 1/64px.
test('几何标签的字号、边距和九种对齐吻合独立旧版读数', () => {
  const shape = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', id: 'shape:geo', shapeType: 'geo', text: 'Alpha Beta', props: { w: 250, h: 250 } }]).snapshot.store['shape:geo']
  for (const [align, x] of [['start', 16.125], ['middle', 69.75], ['end', 123.390625]]) for (const [verticalAlign, y] of [['start', 16.125], ['middle', 110.28125], ['end', 204.4375]]) {
    const layout = getShapeTextLayout({ ...shape, props: { ...shape.props, align, verticalAlign } })
    assert.equal(layout.size, 22)
    assert.ok(Math.abs(layout.x - x) < .2)
    assert.ok(Math.abs(layout.y - y) < .2)
    assert.ok(Math.abs(layout.w - 110.734375) < .2)
    assert.equal(layout.h, 29.6875)
  }
  for (const [size, pixels] of [['s', 18], ['m', 22], ['l', 26], ['xl', 32]]) assert.equal(getShapeTextLayout({ ...shape, props: { ...shape.props, size } }).size, pixels)
})

test('空或纯空白箭头标签可定位光标，不改写记录', () => {
  for (const text of ['', ' \n\t']) for (const labelPosition of [0, .5]) {
    const shape = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', text, props: { end: { x: 300, y: 0 }, labelPosition } }]).snapshot.store['shape:arrow']
    const before = structuredClone(shape), layout = getShapeTextLayout(shape)
    assert.deepEqual(layout.center, { x: 300 * labelPosition, y: 0 })
    assert.equal(layout.w, 0)
    assert.equal(layout.h, 27)
    assert.equal(layout.size, 20)
    assert.deepEqual(shape, before)
  }
})

test('非空弧线标签保持修正前的实际布局和原记录', () => {
  const shape = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', text: 'Alpha Beta', props: { kind: 'arc', end: { x: 300, y: 0 }, bend: 36, font: 'sans', size: 'm', labelPosition: .5 } }]).snapshot.store['shape:arrow']
  const before = structuredClone(shape), layout = getShapeTextLayout(shape)
  // Read from the unchanged renderer before replacing its empty-label fallback.
  for (const [key, expected] of Object.entries({ x: 99.67, y: 22.475889030523888, w: 100.66, h: 27, size: 20, lineHeight: 27, scale: 1 })) assert.ok(Math.abs(layout[key] - expected) < 1e-9, key)
  assert.equal(layout.text, 'Alpha Beta')
  assert.deepEqual(layout.lines, ['Alpha Beta'])
  assert.equal(layout.align, 'middle')
  assert.equal(layout.autoSize, true)
  assert.deepEqual(shape, before)
})
