import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { atom } from '@tldraw/state'
import { checkedOverlays, CanvasOverlays } from '../renderer/overlays.js'

test('激光描述复制冻结世界点列和外框，独立于调用方的后续修改', () => {
  const input = { kind: 'laser', id: 'laser:1', points: [{ x: -20, y: 30 }, { x: 40, y: 50 }] }
  const [item] = checkedOverlays([input])
  input.points[0].x = 900; input.points.push({ x: 0, y: 0 })
  assert.equal(item.id, 'laser:1')
  assert.deepEqual(item.points, [{ x: -20, y: 30 }, { x: 40, y: 50 }])
  assert.deepEqual(item.bounds, { x: -20, y: 30, w: 60, h: 20 })
  assert.ok(Object.isFrozen(item)); assert.ok(Object.isFrozen(item.points)); assert.ok(Object.isFrozen(item.points[0]))
})

test('激光最多32个不同ID，每段1024个有限点；坏值不越过覆盖层入口', () => {
  const stroke = { kind: 'laser', id: 'laser:1', points: [{ x: 0, y: 0 }] }
  assert.equal(checkedOverlays([{ ...stroke, points: Array.from({ length: 1024 }, (_, x) => ({ x, y: 0 })) }])[0].points.length, 1024)
  for (const bad of [{ id: '' }, { id: 1 }, { points: Array(1) }, { points: [{ x: NaN, y: 0 }] }, { points: [{ x: Infinity, y: 0 }] },
    { points: [{ x: -Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 0 }] },
    { points: Array.from({ length: 1025 }, () => ({ x: 0, y: 0 })) }]) {
    assert.throws(() => checkedOverlays([{ ...stroke, ...bad }]), /激光/)
  }
  assert.throws(() => checkedOverlays([stroke, stroke]), /激光.*ID/)
  const many = Array.from({ length: 33 }, (_, i) => ({ ...stroke, id: `laser:${i}` }))
  assert.equal(checkedOverlays(many.slice(0, 32)).length, 32)
  assert.throws(() => checkedOverlays(many), /激光.*32/)
})

test('激光圆头路径使用设计令牌反缩放线宽，单击留点，空尾迹不绘制', async () => {
  const { LaserOverlay } = await import('../renderer/laser-overlay.js')
  const [item] = checkedOverlays([{ kind: 'laser', id: 'laser:1', points: [{ x: 20, y: 30 }] }])
  for (const zoom of [.5, 1, 2]) {
    const html = renderToStaticMarkup(createElement(LaserOverlay, { item, zoom }))
    assert.match(html, /data-overlay-kind="laser"/)
    assert.match(html, /M20,30 L20,30/)
    assert.match(html, /stroke-linecap="round"/)
    assert.match(html, /var\(--color-overlay-laser-stroke\)/)
    assert.ok(html.includes(`calc(var(--spacing-overlay-laser-stroke) * 1 / ${zoom})`))
    assert.doesNotMatch(html, /opacity=|mask=|data-shape-id/)
  }
  assert.equal(renderToStaticMarkup(createElement(LaserOverlay, { item: { ...item, points: [] }, zoom: 1 })), '')
})

test('多个激光覆盖层随共同世界视角投影，保持各自稳定ID与原坐标', () => {
  const items = checkedOverlays([
    { kind: 'laser', id: 'laser:1', points: [{ x: 200, y: 440 }, { x: 360, y: 440 }] },
    { kind: 'laser', id: 'laser:2', points: [{ x: 200, y: 560 }, { x: 360, y: 560 }] },
  ])
  const html = renderToStaticMarkup(createElement(CanvasOverlays, { camera: atom('laser camera', { x: 100, y: -40, z: 2 }), overlays: atom('laser overlays', items) }))
  assert.equal((html.match(/data-overlay-kind="laser"/g) || []).length, 2)
  assert.ok(html.includes('scale(2) translate3d(100px,-40px,0)'))
  assert.ok(html.includes('M200,440 L360,440')); assert.ok(html.includes('M200,560 L360,560'))
  assert.match(html, /data-overlay-id="laser:1"/); assert.match(html, /data-overlay-id="laser:2"/)
})
