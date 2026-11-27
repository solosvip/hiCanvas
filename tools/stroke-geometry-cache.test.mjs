import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { b64Vecs } from '@tldraw/tlschema'
import { getStrokeGeometry, pointInStroke } from '../renderer/stroke-geometry.js'
import { strokePath } from '../renderer/stroke.js'

const segment = (points, type = 'free') => ({ type, path: b64Vecs.encodePoints(points.map(p => ({ z: .5, ...p }))) })
const shape = () => ({ type: 'draw', x: 0, y: 0, props: { size: 'm', dash: 'draw', fill: 'none', isPen: false,
  isClosed: false, scale: 1, scaleX: 1, scaleY: 1, segments: [segment([{ x: 0, y: 0 }, { x: 40, y: 30 }, { x: 90, y: 0 }])] } })

test('同一笔迹的外框、绘制和点中复用同一轮廓，位置颜色不触发重算', () => {
  const record = shape(), before = structuredClone(record), geometry = getStrokeGeometry(record)
  assert.equal(pointInStroke(record, { x: 0, y: 0 }), true)
  assert.ok(getStrokeGeometry(record) === geometry, '重复查询不应重新生成轮廓')
  assert.ok(getStrokeGeometry({ ...record, x: 200, y: -30, rotation: 1 }) === geometry, '平移旋转不改变局部轮廓')
  record.props.color = 'red'; record.props.isComplete = true
  assert.ok(getStrokeGeometry(record) === geometry, '颜色和完成状态不改变轮廓')
  delete record.props.color; delete record.props.isComplete
  assert.deepEqual(record, before)
})

test('原地修改几何相关属性、段列表、段类型和编码点后不返回陈旧轮廓', () => {
  const record = shape()
  const edits = [
    p => { p.size = 'xl' }, p => { p.scale = 2 }, p => { p.scaleX = -.5 }, p => { p.scaleY = 2 },
    p => { p.isPen = true }, p => { p.dash = 'solid' }, p => { p.dash = 'dashed' }, p => { p.dash = 'dotted' },
    p => { p.dash = 'draw' }, p => { p.isClosed = true }, p => { p.fill = 'solid' },
    p => { p.segments.push(segment([{ x: 90, y: 0 }, { x: 10, y: 5 }], 'straight')) },
    p => { p.segments[0].type = 'straight' }, p => { p.segments[0].path = segment([{ x: -60, y: 0 }, { x: 10, y: 40 }]).path },
    p => { p.segments.pop() }, p => { p.segments = [] }, p => { p.segments = [segment([{ x: 3, y: 4 }])] },
  ]
  for (const edit of edits) {
    const previous = getStrokeGeometry(record)
    edit(record.props)
    // Every edit above physically changes this curve. A clone would consult the
    // same shared cache and could hide an omitted dependency in both results.
    assert.notDeepEqual(getStrokeGeometry(record), previous, `修改未改变实际轮廓：${edit}`)
  }
})

test('共享props的画笔和荧光笔按各自宽度生成，不能混用类型缓存', () => {
  const record = shape(), highlight = { ...record, type: 'highlight' }
  const ink = getStrokeGeometry(record), high = getStrokeGeometry(highlight)
  assert.notDeepEqual(ink, high)
  assert.deepEqual(getStrokeGeometry(record), ink)
  assert.deepEqual(getStrokeGeometry(highlight), high)
})

test('不同记录的相同笔迹参数共用轮廓，修改其中一条不影响另一条', () => {
  const left = shape(), right = structuredClone(left), initial = getStrokeGeometry(left)
  assert.ok(getStrokeGeometry(right) === initial, '复制的笔迹不应重复生成同样轮廓')
  right.props.segments[0].path = segment([{ x: 0, y: 0 }, { x: 200, y: 0 }]).path
  assert.notDeepEqual(getStrokeGeometry(right), initial)
  assert.ok(getStrokeGeometry(left) === initial)
  left.props.isClosed = true; left.props.fill = 'solid'
  const filled = getStrokeGeometry(left)
  assert.throws(() => { filled.fill[0].x = 1000 }, TypeError)
  assert.throws(() => { filled.fill.push({ x: 1000, y: 1000 }) }, TypeError)
})

test('共享轮廓禁止调用方改坏点、外框或填充，后续点中不受污染', () => {
  const record = shape(), geometry = getStrokeGeometry(record)
  assert.throws(() => { geometry.outlines[0][0].x = 999 }, TypeError)
  assert.throws(() => { geometry.bounds.w = 0 }, TypeError)
  assert.throws(() => { geometry.outlines.pop() }, TypeError)
  assert.throws(() => { geometry.outline.reverse() }, TypeError)
  assert.equal(pointInStroke(record, { x: 0, y: 0 }), true)
})

test('路径仅去掉命令前可省的空白，负数和科学计数的坐标值逐字不变', () => {
  const points = [{ x: -1e-7, y: 1e21 }, { x: -0, y: -2.25 }, { x: 3.125, y: -4.5 }]
  const before = points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + ' Z'
  assert.equal(strokePath(points), before.replaceAll(' ', ''))
  const previous = strokePath(points); points[0].x = -8
  assert.notEqual(strokePath(points), previous, '外部可变点数组不能缓存为陈旧路径')
})
