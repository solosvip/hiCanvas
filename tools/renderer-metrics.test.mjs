import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Geometry } from '../renderer/geo.js'

const record = props => ({ type: 'geo', props: { geo: 'rectangle', w: 100, h: 40, size: 'm', scale: 1, fill: 'none', color: 'black', dash: 'solid', ...props } })
const render = props => renderToStaticMarkup(createElement(Geometry, { shape: record(props) }))
const attributes = markup => Object.fromEntries([...markup.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]))
const strokes = markup => [...markup.matchAll(/<path data-geo-stroke=""[^>]*>/g)].map(([path]) => attributes(path))
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} ≠ ${expected}`)

// Observed screenshot periods, not values imported from the implementation.
// 2026-11-25: 402% / DPR 2 for 100×40; 134% / DPR 2 for 240×50.
const measured = [
  { w: 40, h: 100, dashed: [4, 2, 1, 1], dotted: [9, 4, 3, 1] },
  { w: 100, h: 40, dashed: [12, 6, 4, 2], dotted: [24, 13, 9, 4] },
  { w: 240, h: 50, dashed: [29, 16, 11, 5], dotted: [59, 33, 23, 11] }
]

test('四档虚线与点线在三种边长分别对齐拐角，填充轮廓保持闭合', () => {
  for (const fixture of measured) for (const [i, size] of ['s', 'm', 'l', 'xl'].entries()) {
    for (const dash of ['dashed', 'dotted']) {
      const markup = render({ w: fixture.w, h: fixture.h, size, dash, fill: 'solid' })
      assert.match(markup, /data-geo-outline=""[^>]*d="[^"]* Z"[^>]*fill="#e8e8e8"[^>]*stroke="none"/)
      const paths = strokes(markup)
      assert.equal(paths.length, 4)
      const array = paths[0]['stroke-dasharray'].split(' ').map(Number)
      const period = fixture.w / fixture[dash][i]
      near(array[0] + array[1], period, `${size} ${dash} ${fixture.w} 周期`)
      near(Number(paths[0]['stroke-dashoffset']), array[0] / 2, '端点半划对齐')
      if (dash === 'dotted') assert.equal(array[0], 0)
      else if (fixture.w === 100) {
        const visible = Number(paths[0]['stroke-width']) + array[0]
        assert.ok(Math.abs(visible - [5.90, 11.06, 15.99, 29.95][i]) <= 0.5, `${size} 可见短划长度 ${visible}`)
      }
    }
  }
})

test('椭圆整圈铺设偶数个短划或点，接缝不重启为大量短边', () => {
  const expected = { dashed: [28, 16, 10, 4], dotted: [58, 32, 22, 10] }
  for (const [i, size] of ['s', 'm', 'l', 'xl'].entries()) for (const dash of ['dashed', 'dotted']) {
    const paths = strokes(render({ geo: 'ellipse', w: 100, h: 50, size, dash }))
    assert.equal(paths.length, 1)
    assert.match(paths[0].d, / Z$/)
    const points = [...paths[0].d.matchAll(/[ML]([\d.e+-]+),([\d.e+-]+)/g)].map(([, x, y]) => ({ x: Number(x), y: Number(y) }))
    const length = points.reduce((n, p, j) => { const q = points[(j + 1) % points.length]; return n + Math.hypot(p.x - q.x, p.y - q.y) }, 0)
    const array = paths[0]['stroke-dasharray'].split(' ').map(Number)
    near(length / (array[0] + array[1]), expected[dash][i], `${size} ${dash} 整圈数量`)
  }
})

test('短边只容纳一个周期时，端点短划仍保持截图量得的可见长度', () => {
  // Visible extents include both round caps; raster measurements ±0.5 units.
  for (const [size, length] of [['s', 4.35], ['m', 7.71], ['l', 16.65], ['xl', 21.75]]) {
    const path = strokes(render({ size, dash: 'dashed' }))[1]
    const dash = Number(path['stroke-dasharray'].split(' ')[0])
    assert.equal(path['stroke-linecap'], 'round')
    const visible = Number(path['stroke-width']) + dash / 2
    assert.ok(Math.abs(visible - length) <= 0.5, `${size} 40 单位短边可见端划 ${visible}，量测 ${length}`)
  }
  const path = strokes(render({ w: 240, h: 50, size: 'xl', dash: 'dashed' }))[1]
  const visible = Number(path['stroke-width']) + Number(path['stroke-dasharray'].split(' ')[0]) / 2
  assert.ok(Math.abs(visible - 24.51) <= 0.5, '50 单位短边也须保持量得长度')
})

test('斜纹每格三个独立圆头短划，线宽和间距随文档 scale 同比变化', () => {
  for (const scale of [1, 2]) {
    const markup = render({ fill: 'pattern', scale })
    assert.match(markup, new RegExp(`patternUnits="userSpaceOnUse" width="${8 * scale}" height="${8 * scale}"`))
    const patternPath = attributes(markup.match(/<path d="[^"]*" stroke="#484848"[^>]*>/)[0])
    assert.equal(Number(patternPath['stroke-width']), 1.25 * scale)
    assert.equal(patternPath['stroke-linecap'], 'round')
    const marks = [...patternPath.d.matchAll(/M([\d.e+-]+),([\d.e+-]+) L([\d.e+-]+),([\d.e+-]+)/g)]
    assert.equal(marks.length, 3)
    for (const [, x1, y1, x2, y2] of marks) near(Math.hypot(x2 - x1, y2 - y1), 2 * scale, '图案短划中心线长度')
  }
})

test('黑色与蓝色 lined-fill 均为实色面，不叠加旧实现的横线', () => {
  for (const [color, fill] of [['black', '#363636'], ['blue', '#6580ec']]) {
    const markup = render({ fill: 'lined-fill', color })
    assert.doesNotMatch(markup, /<pattern/)
    assert.match(markup, new RegExp(`data-geo-outline=""[^>]*fill="${fill}"`))
  }
})
