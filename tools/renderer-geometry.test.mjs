import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { canvasToScreen, screenToCanvas, hitTestCanvas, getShapeBounds, getShapePageBounds, shapeToPagePoint, pageToShapePoint, pointInShape } from '../renderer/geometry.js'

test('相机平移缩放下屏幕坐标与画布坐标可往返，拒绝无效缩放', () => {
  const camera = { x: 10, y: -20, z: 2 }
  assert.deepEqual(canvasToScreen({ x: 15, y: 25 }, camera), { x: 50, y: 10 })
  assert.deepEqual(screenToCanvas({ x: 50, y: 10 }, camera), { x: 15, y: 25 })
  for (const z of [0, -1, NaN, Infinity]) assert.throws(() => screenToCanvas({ x: 0, y: 0 }, { ...camera, z }), /相机/)
})

const shape = (id, props = {}, extra = {}) => ({ id, typeName: 'shape', type: 'geo', parentId: 'page:one', index: 'a1', x: 0, y: 0, rotation: 0, opacity: 1, props: { w: 100, h: 80, geo: 'rectangle', fill: 'solid', ...props }, ...extra })
const snapshot = (...shapes) => ({ store: Object.fromEntries([{ id: 'page:one', typeName: 'page' }, ...shapes].map(r => [r.id, r])) })
const pick = (data, x, y, camera) => hitTestCanvas(data, { x, y }, camera)

test('几何查询按父子层级和二进制 index 顺序找顶层；无填充矩形内部可穿透', () => {
  const bottom = shape('shape:bottom', {}, { index: 'aA' })
  const top = shape('shape:top', { fill: 'none' }, { index: 'aa' })
  assert.equal(pick(snapshot(bottom, top), 50, 40), bottom.id)
  assert.equal(pick(snapshot(bottom, top), 94, 40), bottom.id)
  assert.equal(pick(snapshot(bottom, top), 1, 40), top.id)
  assert.equal(pick(snapshot(bottom, shape('shape:ellipse', { geo: 'ellipse' }, { index: 'aa' })), 1, 1), bottom.id)
  assert.equal(pick(snapshot(bottom, shape('shape:ellipse', { geo: 'ellipse' }, { index: 'aa' })), 50, 40), 'shape:ellipse')
  for (const geo of ['rectangle', 'ellipse']) {
    const outline = shape('shape:outline', { geo, fill: 'none' })
    assert.equal(pointInShape(outline, { x: 0, y: 40 }), true)
    assert.equal(pointInShape(outline, { x: 50, y: 40 }), false)
  }
})

test('嵌套旋转框裁剪子形状；相机变换后命中同一记录', () => {
  const frame = shape('shape:frame', { w: 100, h: 100 }, { type: 'frame', x: 200, y: 100, rotation: Math.PI / 2 })
  const child = shape('shape:child', { w: 60, h: 60 }, { parentId: frame.id, x: 70, y: 20, rotation: Math.PI / 2 })
  const data = snapshot(frame, child)
  assert.equal(pick(data, 170, 150), child.id)
  assert.equal(pick(data, 170, 210), null)
  const camera = { x: -50, y: 30, z: 2 }
  assert.equal(pick(data, 240, 360, camera), child.id)
  const cover = shape('shape:cover', {}, { x: 100, y: 100, index: 'a2' })
  assert.equal(pick(snapshot(frame, child, cover), 170, 150), cover.id)
})

test('隐藏、其他页面及不支持的形状不拦截；坏父子环不会卡死', () => {
  const bottom = shape('shape:bottom')
  assert.equal(pick(snapshot(bottom, shape('shape:hidden', {}, { index: 'a2', opacity: 0 })), 50, 40), bottom.id)
  assert.equal(pick(snapshot(bottom, shape('shape:other', {}, { parentId: 'page:other', index: 'a2' })), 50, 40), bottom.id)
  assert.equal(pick(snapshot(bottom, shape('shape:unsupported', { geo: 'triangle' }, { index: 'a2' })), 50, 40), bottom.id)
  assert.equal(pick(snapshot(shape('shape:cycle', {}, { parentId: 'shape:cycle' })), 50, 40), null)
})

test('各类型独立计算外框，嵌套旋转的世界外框和局部坐标可供无界面的编辑命令复用', () => {
  const frame = shape('shape:frame', {}, { type: 'frame', x: 200, y: 100, rotation: Math.PI / 2 })
  const child = shape('shape:child', { w: 40, h: 20 }, { parentId: frame.id, x: 10, y: 20 })
  const data = snapshot(frame, child)
  const point = shapeToPagePoint(data, child.id, { x: 30, y: 10 })
  assert.deepEqual(point, { x: 170, y: 140 })
  const local = pageToShapePoint(data, child.id, point)
  assert.ok(Math.abs(local.x - 30) < 1e-10 && Math.abs(local.y - 10) < 1e-10)
  assert.deepEqual(getShapePageBounds(data, child.id), { x: 160, y: 110, w: 20, h: 40 })
  for (const type of ['geo', 'image', 'frame']) assert.deepEqual(getShapeBounds(shape('shape:bounds', {}, { type })), { x: 0, y: 0, w: 100, h: 80 })
  const text = shape('shape:text', { w: 100, size: 'm', scale: 2, richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] } }, { type: 'text' })
  assert.deepEqual(getShapeBounds(text), { x: 0, y: 0, w: 200, h: 100 })
  assert.equal(getShapeBounds(shape('shape:unknown', { geo: 'triangle' })), null)
  const ellipse = shape('shape:ellipse', { w: 100, h: 20, geo: 'ellipse' }, { rotation: Math.PI / 4 })
  const ellipseBounds = getShapePageBounds(snapshot(ellipse), ellipse.id)
  assert.ok(Math.abs(ellipseBounds.w - Math.sqrt(5200)) < 1e-10)
  assert.ok(Math.abs(ellipseBounds.h - Math.sqrt(5200)) < 1e-10)
})
