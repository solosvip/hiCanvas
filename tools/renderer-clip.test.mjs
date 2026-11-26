import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GeoShapeGeoStyle } from '@tldraw/tlschema'
import { Geometry } from '../renderer/geo.js'
import { FrameState } from '../renderer/frame-state.js'
import { getShapeContour, getHandDrawnContour } from '../renderer/geometry.js'
import { strokeWidth } from '../renderer/geo-metrics.js'
import { createFixture } from './perf/fixture.mjs'
import { createGallery } from './renderer-preview/gallery.js'

const render = shape => renderToStaticMarkup(createElement(Geometry, { shape }))

function assertClipEnclosesInk(shape) {
  const markup = render(shape), svg = markup.match(/^<svg\b[^>]*>/)?.[0]
  const width = Number(svg?.match(/\bwidth="([^"]+)"/)?.[1]), height = Number(svg?.match(/\bheight="([^"]+)"/)?.[1])
  const inset = Number(svg?.match(/clip-path:inset\((-[\d.e+-]+)px\)/)?.[1])
  assert.ok(Number.isFinite(inset) && inset < 0, `${shape.id} 缺少有限裁剪范围`)
  const pen = strokeWidth(shape.props), hand = getHandDrawnContour(shape), contour = getShapeContour(shape)
  // One full nominal pen width remains outside the complete ink envelope.
  // This is independent of the padding formula used by the SVG component.
  const enclosed = (x, y, radius = 0) => {
    assert.ok(x - radius >= inset + pen && y - radius >= inset + pen && x + radius <= width - inset - pen && y + radius <= height - inset - pen,
      `${shape.id} 裁剪会切笔触或吃掉余量：${JSON.stringify({ x, y, radius, width, height, inset, pen })}`)
  }
  if (hand) {
    for (const point of hand.outline) enclosed(point.x, point.y, point.width / 2)
    for (const path of hand.decorationPaths) {
      // Own brush output consists of filled polygons and circular caps. Polygon
      // bounds follow their vertices; two semicircles form each complete cap.
      for (const [, x, y] of path.matchAll(/[ML]([\d.e+-]+),([\d.e+-]+)/g)) enclosed(Number(x), Number(y))
      for (const [, right, y, radius, left] of path.matchAll(/M([\d.e+-]+),([\d.e+-]+) A([\d.e+-]+),[\d.e+-]+ 0 1 1 ([\d.e+-]+),[\d.e+-]+/g)) enclosed((Number(right) + Number(left)) / 2, Number(y), Number(radius))
    }
  } else {
    for (const point of [...contour.outline, ...contour.decorations.flat()]) enclosed(point.x, point.y, pen / 2)
  }
}

test('三档实线和手绘合成画板的每个几何形状都保留完整笔触及余量', () => {
  let checked = 0
  for (const count of [500, 2000, 5000]) for (const dash of ['solid', 'draw']) {
    const fixture = createFixture(count, undefined, undefined, { dash })
    for (const shape of Object.values(fixture.snapshot.store)) if (shape.type === 'geo') { assertClipEnclosesInk(shape); checked++ }
  }
  assert.equal(checked, 9000)
})

test('全部几何类型、图鉴、细小和狭长笔触及文档缩放不被有限裁剪截断', () => {
  for (const mode of ['shapes', 'styles', 'metrics', 'metrics-long', 'metrics-curves', 'draw', 'draw-filled']) {
    for (const shape of Object.values(createGallery(mode).snapshot.store)) if (shape.type === 'geo') assertClipEnclosesInk(shape)
  }
  const sample = Object.values(createGallery('draw').snapshot.store).find(shape => shape.type === 'geo')
  for (const geo of GeoShapeGeoStyle.values) for (const [w, h, growY] of [[.2, .125, 0], [160, .2, 0], [.2, 160, 0], [160, 100, 30]]) for (const scale of [.01, .5, 2]) {
    assertClipEnclosesInk({ ...sample, id: `shape:clip-${geo}-${w}-${h}-${scale}`, props: { ...sample.props, geo, w, h, size: 'xl', scale, growY } })
  }
})

test('八种生成状态保留画框提示，框内全部手绘子形状的裁剪不切笔触', () => {
  const fixture = createGallery('embeds'), children = Object.values(createGallery('draw').snapshot.store).filter(shape => shape.type === 'geo')
  const states = Object.values(fixture.snapshot.store).filter(shape => shape.meta?.hicanvasGeneration)
  assert.equal(states.length, 8)
  for (const frame of states) {
    const markup = renderToStaticMarkup(createElement(FrameState, { shape: frame }))
    assert.match(markup, new RegExp(`data-generation-status="${frame.meta.hicanvasGeneration.status}"`))
    assert.doesNotMatch(markup, /clip-path:/)
    for (const child of children) assertClipEnclosesInk({ ...child, parentId: frame.id, x: 40, y: 20 })
  }
})
