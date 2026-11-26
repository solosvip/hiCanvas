import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { getShapeBounds, getShapePageBounds, hitTestCanvas, pointInShape } from '../renderer/geometry.js'
import { createNoteGallery } from './renderer-preview/note-fixtures.js'

const note = () => Object.values(createNoteGallery('note-colors').snapshot.store).find(r => r.type === 'note')

test('便签的默认外框与点中查询覆盖实测的200方形，外侧不命中', () => {
  const shape = note(), before = JSON.stringify(shape)
  assert.deepEqual(getShapeBounds(shape), { x: 0, y: 0, w: 200, h: 200 })
  assert.equal(pointInShape(shape, { x: 100, y: 199 }), true)
  assert.equal(pointInShape(shape, { x: 201, y: 100 }), false)
  assert.equal(JSON.stringify(shape), before)
})

test('文字从一行增长到十二行后，纯几何外框和下半部命中同时增高', () => {
  const shape = note()
  shape.props.font = 'sans'
  shape.props.richText = { type: 'doc', content: Array.from({ length: 12 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Line ${i + 1}` }] })) }
  assert.deepEqual(getShapeBounds(shape), { x: 0, y: 0, w: 200, h: 388.25 })
  assert.equal(pointInShape(shape, { x: 100, y: 370 }), true)
  assert.equal(pointInShape(shape, { x: 100, y: 389 }), false)
  shape.props.scale = 0.5
  assert.deepEqual(getShapeBounds(shape), { x: 0, y: 0, w: 100, h: 194.125 })
})

test('没有手动换行的中文按168宽排到八行，缩小字号后重新排版', () => {
  const shape = note()
  shape.props.richText = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '中'.repeat(50) }] }] }
  assert.equal(getShapeBounds(shape).h, 269.5)
  shape.props.fontSizeAdjustment = 0.5
  assert.equal(getShapeBounds(shape).h, 200)
})

test('组合音标作为一个字形排版，不按两个宽字挤出多余高度', () => {
  const shape = note()
  shape.props.richText = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'é'.repeat(50) }] }] }
  assert.equal(getShapeBounds(shape).h, 200)
})

test('连续空格保留占宽，八个含五十空格的段落会撑高便签', () => {
  const shape = note()
  shape.props.font = 'mono'
  shape.props.richText = { type: 'doc', content: Array.from({ length: 8 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: `A${' '.repeat(50)}B` }] })) }
  // 2026-11-25 runtime observation: pre-wrap hangs the spaces and wraps B.
  assert.equal(getShapeBounds(shape).h, 507)
})

test('长便签在旋转画框内缩放后，页面外框与带相机的点中查询一致', () => {
  const fixture = createNoteGallery('note-layout'), snapshot = fixture.snapshot
  const source = snapshot.store['shape:note-layout-9'], page = source.parentId
  const frame = { ...source, id: 'shape:note-frame', type: 'frame', x: 100, y: 50, rotation: Math.PI / 2, props: { w: 300, h: 300, name: '', color: 'black' } }
  const child = { ...source, parentId: frame.id, x: 10, y: 20, props: { ...source.props, scale: .5 } }
  snapshot.store = Object.fromEntries(Object.entries(snapshot.store).filter(([, record]) => record.typeName !== 'shape'))
  snapshot.store[frame.id] = { ...frame, parentId: page }; snapshot.store[child.id] = child
  const bounds = getShapePageBounds(snapshot, child.id)
  assert.ok(Math.abs(bounds.x - -114.125) < 1e-8)
  assert.ok(Math.abs(bounds.y - 60) < 1e-8)
  assert.ok(Math.abs(bounds.w - 194.125) < 1e-8)
  assert.ok(Math.abs(bounds.h - 100) < 1e-8)
  assert.equal(hitTestCanvas(snapshot, { x: 200, y: 220 }, { x: 200, y: 0, z: 2 }), child.id)
  assert.equal(hitTestCanvas(snapshot, { x: 140, y: 220 }, { x: 200, y: 0, z: 2 }), frame.id)
})


test('便签富文本按粗体的实际字距断行，外框随行数增长', () => {
  const shape = note()
  shape.props = { ...shape.props, font: 'sans', richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'W'.repeat(64), marks: [{ type: 'bold' }] }] }] } }
  const bold = getShapeBounds(shape)
  shape.props = { ...shape.props, richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'W'.repeat(64) }] }] } }
  const normal = getShapeBounds(shape)
  assert.ok(bold.h > normal.h, 'bold advances must affect wrapping and the saved note bounds')
})
