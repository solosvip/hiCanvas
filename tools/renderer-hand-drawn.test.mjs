import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { GeoShapeGeoStyle } from '@tldraw/tlschema'
import * as geometry from '../renderer/geometry.js'
import { createHandDrawnGallery } from './renderer-preview/hand-drawn-gallery.js'

const shape = (geo = 'rectangle', size = 'm', props = {}) => ({ id: `shape:hand-${geo}-${size}`, type: 'geo', x: 0, y: 0, rotation: 0, props: { geo, size, w: 160, h: 100, scale: 1, growY: 0, fill: 'none', dash: 'draw', ...props } })
const draw = record => geometry.getHandDrawnContour(record)

test('手绘轮廓是纯几何，同一记录复制和重开后逐值一致，不用随机或时钟', () => {
  const record = shape(), before = structuredClone(record), random = Math.random
  try {
    Math.random = () => { throw new Error('轮廓不许调用 Math.random') }
    assert.deepEqual(draw(record), draw(structuredClone(record)))
    assert.deepEqual(record, before)
  } finally { Math.random = random }
})

test('种子只随稳定身份变化，平移旋转与样式更新不重抽笔触', () => {
  const record = shape(), result = draw(record)
  assert.deepEqual(draw({ ...record, x: 100, y: -400, rotation: 0.8 }), result)
  assert.deepEqual(draw({ ...record, props: { ...record.props, color: 'red', fill: 'solid' } }), result)
  assert.notDeepEqual(draw({ ...record, id: 'shape:another-hand' }), result)
})

test('整体尺寸与 scale 同倍变化时轮廓也同倍，种子不会因缩放跳动', () => {
  const record = shape(), first = draw(record)
  const second = draw({ ...record, props: { ...record.props, w: 320, h: 200, scale: 2 } })
  assert.equal(second.outline.length, first.outline.length)
  for (let i = 0; i < first.outline.length; i++) for (const key of ['x', 'y', 'width']) assert.ok(Math.abs(second.outline[i][key] - first.outline[i][key] * 2) < 1e-8)
})

for (const geo of ['rectangle', 'ellipse', 'star', 'triangle']) for (const size of ['s', 'm', 'l', 'xl']) test(`${geo}/${size} 手绘有变宽笔触、封闭填充与有限几何`, () => {
  const result = draw(shape(geo, size)), widths = result.outline.map(point => point.width)
  assert.ok(Math.max(...widths) - Math.min(...widths) > 0.2)
  assert.ok(result.fillPath.endsWith('Z') && result.strokePath.endsWith('Z'))
  assert.ok(!/NaN|Infinity/.test(result.fillPath + result.strokePath))
  assert.ok(result.outline.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.width > 0))
})

test('全部几何类型及叉勾装饰线都有稳定手绘，极小尺寸保持有限', () => {
  for (const geo of GeoShapeGeoStyle.values) for (const length of [0.2, 1, 160, 100000]) {
    const result = draw(shape(geo, 'xl', { w: length, h: length * 0.625 }))
    assert.ok(result?.outline.length > 2)
    assert.ok(!/NaN|Infinity/.test(result.fillPath + result.strokePath + result.decorationPaths.join('')))
    assert.deepEqual(result, draw(structuredClone(shape(geo, 'xl', { w: length, h: length * 0.625 }))))
  }
  assert.equal(draw(shape('x-box')).decorationPaths.length, 2)
  assert.equal(draw(shape('check-box')).decorationPaths.length, 1)
})

test('手绘点中与几何外框仍使用原本轮廓，不把抖动或圆角当命中规则', () => {
  for (const geo of GeoShapeGeoStyle.values) {
    const record = shape(geo), solid = { ...record, props: { ...record.props, dash: 'solid' } }
    const original = structuredClone(geometry.getShapeContour(record))
    draw(record)
    assert.deepEqual(geometry.getShapeContour(record), original)
    for (const x of [-3, 0, 10, 80, 160, 163]) for (const y of [-3, 0, 10, 50, 100, 103]) assert.equal(geometry.pointInShape(record, { x, y }), geometry.pointInShape(solid, { x, y }))
  }
})

test('手绘缓存按影响几何的字段失效，growY 和 ID 不会读到旧值', () => {
  const record = shape(), before = draw(record)
  record.props.growY = 80
  const grown = draw(record)
  assert.notDeepEqual(before, grown)
  assert.ok(Math.max(...grown.outline.map(p => p.y)) > 170)
  record.id = 'shape:different'
  assert.notDeepEqual(draw(record), grown)
})

test('未知类型及无面积形状不生成笔触；实线与虚线不会接入手绘', () => {
  assert.equal(draw({ ...shape(), type: 'image' }), null)
  assert.equal(draw(shape('unknown')), null)
  assert.equal(draw(shape('rectangle', 's', { w: 0 })), null)
  assert.equal(draw(shape('rectangle', 's', { dash: 'solid' })), null)
})

test('5000 手绘和实线压力图只在线型字段上不同，保持同 ID、坐标、相机与尺寸', () => {
  const hand = createHandDrawnGallery('draw-stress'), solid = createHandDrawnGallery('draw-stress-solid')
  assert.equal(hand.count, 5000)
  assert.deepEqual(hand.counts, { geo: 5000, image: 0, text: 0 })
  assert.deepEqual(hand.viewState.camera, solid.viewState.camera)
  const handShapes = Object.values(hand.snapshot.store).filter(r => r.typeName === 'shape'), solidShapes = Object.values(solid.snapshot.store).filter(r => r.typeName === 'shape')
  assert.equal(handShapes.length, 5000)
  for (let i = 0; i < 5000; i++) assert.deepEqual({ ...handShapes[i], props: { ...handShapes[i].props, dash: 'solid' } }, solidShapes[i])
})

test('16组实测平均笔宽保留在0.5画布单位以内，防手绘退回普通实线', () => {
  const observed = { rectangle: [2.340, 3.874, 5.815, 11.983], ellipse: [2.238, 4.214, 6.173, 11.029], star: [2.299, 4.066, 5.666, 10.996], triangle: [2.289, 4.214, 5.917, 11.634] }
  for (const [geo, means] of Object.entries(observed)) for (const [i, size] of ['s', 'm', 'l', 'xl'].entries()) {
    const points = draw(shape(geo, size)).outline
    let length = 0, ink = 0
    for (let j = 0; j < points.length; j++) {
      const p = points[j], next = points[(j + 1) % points.length], segment = Math.hypot(next.x - p.x, next.y - p.y)
      ink += segment * next.width; length += segment
    }
    assert.ok(Math.abs(ink / length - means[i]) <= 0.5, `${geo}/${size} 平均笔宽 ${ink / length} 偏离截图量测 ${means[i]}`)
  }
})

function pathWinding(path, point) {
  let winding = 0
  for (const subpath of path.split(' Z').filter(Boolean)) {
    // Each circular cap is two SVG semicircles; check its interior directly.
    const circle = subpath.match(/M(-?[\d.]+),(-?[\d.]+) A([\d.]+),[\d.]+ 0 1 1 (-?[\d.]+),(-?[\d.]+)/)
    if (circle) {
      const center = { x: (Number(circle[1]) + Number(circle[4])) / 2, y: (Number(circle[2]) + Number(circle[5])) / 2 }
      if (Math.hypot(point.x - center.x, point.y - center.y) < Number(circle[3])) winding++
      continue
    }
    const points = [...subpath.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }))
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length]
      const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y)
      if (a.y <= point.y && b.y > point.y && side > 0) winding++
      if (a.y > point.y && b.y <= point.y && side < 0) winding--
    }
  }
  return winding
}

test('尺寸小于笔宽或狭长时笔触中心线仍着墨，内环不能翻转成透明孔洞', () => {
  for (const geo of ['rectangle', 'ellipse', 'star', 'triangle', 'heart', 'oval']) for (const [w, h] of [[0.2, 0.125], [1, 0.625], [5, 3.125], [160, 0.2], [0.2, 160]]) {
    const result = draw(shape(geo, 'xl', { w, h }))
    for (const point of result.outline) assert.notEqual(pathWinding(result.strokePath, point), 0, `${geo} ${w}×${h} 中心线不着墨`)
  }
})
