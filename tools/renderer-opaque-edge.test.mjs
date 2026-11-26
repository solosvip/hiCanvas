import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyOpaqueEdges } from './renderer-preview/opaque-edge-rules.mjs'
import { compareClipPixels, assertClipPixels } from './renderer-preview/clip-pixel-comparison.mjs'
import { opaquePaintIntersectsPixel } from './renderer-preview/opaque-edge-candidates.js'

const colors = (coverage = 128) => {
  const black = [80, 80, 80, 255], white = [80 + coverage, 80 + coverage, 80 + coverage, 255]
  if (coverage === 255) return [[0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 255]]
  return [black, white, [...black], [...white]]
}

function sample({ x = 21, delta = 1, coverage = 128, unstable = false, count = 1 } = {}) {
  const width = 80, height = 32, scale = 2
  const image = () => ({ width, height, bytes: Buffer.from(Array.from({ length: width * height }, () => [128, 128, 128, 255]).flat()) })
  const before = image(), clipped = image(), repeated = image(), mask = new Uint8Array(width * height)
  const proofs = [], outsideUnion = []
  for (let i = 0; i < count; i++) {
    const px = count === 1 ? x : i + 1, y = count === 1 ? 10 : 2
    clipped.bytes[(y * width + px) * 4] += delta
    const states = [false, true].map(clipped => ({ clipped, colors: colors(coverage) }))
    if (unstable) states[0].colors[2][0]++
    proofs.push({ x: px, y, shape: { id: 'opaque', opacity: 1, bounds: count === 1 ? { x: 2, y: 2, width: 8, height: 6 } : { x: 0, y: 0, width: 40, height: 1 } }, states })
    outsideUnion.push({ x: px, y })
  }
  const result = classifyOpaqueEdges({ before, clipped, regions: { mask, outsideUnion }, proofs, scale })
  const unresolved = outsideUnion.filter(({ x, y }) => result.mask[y * width + x] !== 3)
  return { ...compareClipPixels(before, clipped, repeated, result.mask), outsideUnion: unresolved, opaqueEdgeDetails: result.details }
}

test('a measured partial opaque edge gets exactly one level with owner, coverage and distance', () => {
  const report = sample()
  assertClipPixels(report)
  assert.equal(report.clipped.opaqueEdge.changedPixels, 1)
  assert.equal(report.opaqueEdgeDetails[0].owner, 'opaque')
  assert.equal(report.opaqueEdgeDetails[0].distanceCss, .5)
  assert.equal(report.opaqueEdgeDetails[0].coverage[0].coverageEstimate, 128 / 255)
  assertClipPixels(sample({ x: 22 })) // Exactly 1 CSS pixel outside the SVG.
})

test('a fully covered opaque pixel changing one level still fails', () => {
  assert.throws(() => assertClipPixels(sample({ x: 18, coverage: 255 })))
})

test('a partial edge changing two levels still fails', () => {
  assert.throws(() => assertClipPixels(sample({ delta: 2 })))
})

test('partial coverage beyond one CSS pixel from the SVG edge still fails', () => {
  assert.throws(() => assertClipPixels(sample({ x: 23 })))
  assert.throws(() => assertClipPixels(sample({ x: 12 }))) // Deep inside the SVG.
})

test('unowned or unstable colors cannot grant an opaque edge exception', () => {
  assert.throws(() => assertClipPixels(sample({ coverage: 0 })))
  assert.throws(() => assertClipPixels(sample({ unstable: true })))
})

test('32 independently measured edge points pass and 33 fail', () => {
  assertClipPixels(sample({ count: 32 }))
  assert.throws(() => assertClipPixels(sample({ count: 33 })))
})

test('an opaque obstruction covering only the right half of a DPR2 pixel still blocks permission', () => {
  const point = { cssX: 10, cssY: 5, cssSize: .5 }
  assert.equal(opaquePaintIntersectsPixel({ x: 10.25, y: 5, width: 2, height: 2 }, point), true)
  assert.equal(opaquePaintIntersectsPixel({ x: 10.5, y: 5, width: 2, height: 2 }, point), false)
})

test('source-color validation reads Electron BGRA bytes against RGBA response evidence', () => {
  const before = { width: 1, height: 1, bytes: Buffer.from([220, 120, 20, 255]) }
  const clipped = { ...before, bytes: Buffer.from([220, 120, 21, 255]) }
  const black = [10, 100, 200, 255], white = [40, 130, 230, 255]
  const proof = { x: 0, y: 0, shape: { id: 'blue-edge', opacity: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } }, states: [false, true].map(clipped => ({ clipped, colors: [black, white, black, white] })) }
  const report = classifyOpaqueEdges({ before, clipped, regions: { mask: new Uint8Array(1) }, proofs: [proof], scale: 2 })
  assert.equal(report.mask[0], 3)
  assert.equal(report.details[0].sourceFits, true)
})
