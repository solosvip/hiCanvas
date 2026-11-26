import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyClipRegions } from './renderer-preview/clip-pixel-regions.mjs'
import { compareClipPixels, assertClipPixels } from './renderer-preview/clip-pixel-comparison.mjs'

function sample({ x = 8, y = 4, delta = 1, opaque = false, bounds = { x: 1, y: 1, width: 8, height: 2 } } = {}) {
  const width = 24, height = 12, length = width * height
  const image = () => ({ width, height, bytes: Buffer.alloc(length * 4, 80) })
  const before = image(), clipped = image(), repeated = image()
  const mask = new Uint8Array(length), protectedInk = new Uint8Array(length)
  mask[4 * width + 4] = 1
  clipped.bytes[(y * width + x) * 4] += delta
  if (opaque) protectedInk[y * width + x] = 1
  const shapeInk = [{ id: 'semi', opacity: .4, bounds, mask }]
  const regions = classifyClipRegions({ before, clipped, shapeInk, protectedInk, scale: 2 })
  return { ...compareClipPixels(before, clipped, repeated, regions.mask), ...regions }
}

test('unassigned AA gets one level only with a measured owner, distance and geometry', () => {
  const report = sample()
  assertClipPixels(report)
  assert.equal(report.edgeDetails.length, 1)
  assert.equal(report.edgeDetails[0].owner, 'semi')
  assert.equal(report.edgeDetails[0].distanceCss, 2)
  assert.deepEqual(report.edgeDetails[0].nearestAssigned, { x: 4, y: 4 })
  assertClipPixels(sample({ x: 10 })) // Exactly 3 CSS pixels, at DPR 2.
  assert.throws(() => assertClipPixels(sample({ delta: 2 })), /外缘.*超过1/)
})

test('opaque ink changing one level fails even next to translucent ink', () => {
  assert.throws(() => assertClipPixels(sample({ opaque: true })), /不透明区域/)
  assert.equal(sample({ opaque: true }).edgeDetails[0].allowed, false)
})

test('a one-level change beyond four CSS pixels fails inside the expanded box', () => {
  const report = sample({ x: 13 }) // 4.5 CSS pixels from actual owned ink.
  assert.equal(report.outsideUnion.length, 0)
  assert.equal(report.edgeDetails[0].allowed, false)
  assert.throws(() => assertClipPixels(report), /不透明区域/)
  assert.throws(() => assertClipPixels(sample({ x: 11 })), /不透明区域/) // 3.5.
})

test('distance uses the Euclidean radius rather than a square neighborhood', () => {
  const report = sample({ x: 10, y: 10 })
  assert.equal(report.outsideUnion.length, 0)
  assert.throws(() => assertClipPixels(report), /不透明区域/)
})

test('both actual owned ink and AA neighbors must stay in the expanded shape union', () => {
  const bounds = { x: 16, y: 1, width: 1, height: 1 }
  assert.throws(() => assertClipPixels(sample({ x: 4, delta: 2, bounds })), /并集以外/)
  assert.throws(() => assertClipPixels(sample({ bounds })), /并集以外/)
})

test('missing geometry cannot grant an AA allowance', () => {
  assert.throws(() => sample({ bounds: { x: 0, y: 0, width: 0, height: 1 } }))
  assert.throws(() => sample({ bounds: { x: NaN, y: 0, width: 1, height: 1 } }))
})
