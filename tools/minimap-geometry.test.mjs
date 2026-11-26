import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { getMinimapLayout, pageToMinimapPoint, minimapToPagePoint, hitMinimapViewport } from '../renderer/geometry.js'

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`)
const create = (extra = {}) => getMinimapLayout({ camera: { x: 100, y: 50, z: 1 }, viewport: { w: 1280, h: 900 }, size: { w: 152, h: 88 }, contentBounds: { x: 0, y: 0, w: 1000, h: 500 }, ...extra })

test('H11：旧版测得的并集取景、居中留白及视口范围，不裁掉离屏内容', () => {
  const layout = create()
  assert.deepEqual(layout.pageBounds, { x: -100, y: -50, w: 1280, h: 900 })
  near(layout.scale, 88 / 900); near(layout.viewportBounds.x, (152 - 1280 * 88 / 900) / 2)
  near(layout.viewportBounds.y, 0); near(layout.viewportBounds.h, 88)
  const zoom = create({ camera: { x: 0, y: 0, z: 2 } })
  assert.deepEqual(zoom.pageBounds, { x: 0, y: 0, w: 1000, h: 500 })
  near(zoom.scale, .152); near(zoom.viewportBounds.y, 6); near(zoom.viewportBounds.w, 97.28)
  const distant = create({ camera: { x: -1500, y: -1200, z: 1 } })
  assert.deepEqual(distant.pageBounds, { x: 0, y: 0, w: 2780, h: 2100 })
  assert.ok(distant.viewportBounds.x > 0)
})

test('H11：负坐标、不同缩放/宽高下换算可逆，视口边界命中，空画板仍可导航', () => {
  for (const z of [.05, .5, 1, 8]) for (const size of [{ w: 152, h: 88 }, { w: 88, h: 152 }]) {
    const layout = create({ camera: { x: -200, y: 300, z }, size, contentBounds: null })
    for (const point of [{ x: -1200, y: 430 }, { x: 200, y: -300 }]) {
      const back = minimapToPagePoint(layout, pageToMinimapPoint(layout, point))
      near(back.x, point.x); near(back.y, point.y)
    }
    const box = layout.viewportBounds
    assert.equal(hitMinimapViewport(layout, { x: box.x, y: box.y }), true)
    assert.equal(hitMinimapViewport(layout, { x: box.x - 1, y: box.y }), false)
    assert.deepEqual(layout.pageBounds, layout.viewBounds)
  }
})

test('H11：拒绝非法相机、尺寸、内容范围和输入点，返回值不可被宿主改坏', () => {
  for (const extra of [{ camera: { x: 0, y: 0, z: 0 } }, { size: { w: 0, h: 88 } }, { viewport: { w: NaN, h: 1 } }, { contentBounds: { x: 0, y: 0, w: -1, h: 2 } }]) assert.throws(() => create(extra))
  const layout = create(); assert.throws(() => minimapToPagePoint(layout, { x: NaN, y: 1 }))
  assert.throws(() => { layout.viewportBounds.x = 900 })
})
