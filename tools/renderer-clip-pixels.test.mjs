import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { compareClipPixels, assertClipPixels, pixelResponds, opaquePixelMayPaint } from './renderer-preview/clip-pixel-comparison.mjs'

const image = values => ({ width: values.length, height: 1, bytes: Buffer.from(values.flatMap(value => [value, value, value, 255])) })
const compare = (clipped, repeated = [80, 80, 80]) => ({ ...compareClipPixels(image([80, 80, 80]), image(clipped), image(repeated), Uint8Array.from([0, 1, 0])), outsideUnion: [] })

test('two levels are allowed only on proven translucent ink', () => {
  const report = compare([80, 82, 80])
  assert.deepEqual(report.clipped.translucent, { changedPixels: 1, maximumChannelDelta: 2 })
  assertClipPixels(report)
  assert.throws(() => assertClipPixels(compare([81, 80, 80])), /不透明区域/)
  assert.throws(() => assertClipPixels(compare([80, 80, 81])), /不透明区域/)
  assert.throws(() => assertClipPixels(compare([80, 83, 80])), /超过2色阶/)
})

test('opaque ink and background require zero change even with a noisy repeat', () => {
  assertClipPixels(compare([80, 80, 80], [84, 80, 80]))
  assert.throws(() => assertClipPixels(compare([81, 80, 80], [81, 80, 80])), /不透明区域/)
  assert.throws(() => assertClipPixels(compare([81, 80, 81], [81, 80, 80])), /不透明区域/)
  assert.throws(() => assertClipPixels(compare([82, 80, 80], [81, 80, 80])), /不透明区域/)
  assert.throws(() => assertClipPixels(compare([81, 80, 80], [84, 80, 80])), /不透明区域/)
})

test('a missing mask or mismatched capture cannot grant a tolerance', () => {
  assert.throws(() => compareClipPixels(image([]), image([]), image([]), new Uint8Array()), /非空/)
  assert.throws(() => compareClipPixels(image([80]), image([80]), image([80]), new Uint8Array()), /0 !== 1/)
  assert.throws(() => compareClipPixels(image([80]), image([80, 80]), image([80]), Uint8Array.from([1])))
})

test('unstable opaque color probes cannot become translucent permission', () => {
  const frames = values => [values.map(value => image([value]).bytes)]
  assert.equal(pixelResponds(frames([10, 20, 10, 20]), 0), true)
  assert.equal(pixelResponds(frames([10, 20, 11, 20]), 0), false)
  assert.equal(opaquePixelMayPaint(frames([10, 20, 11, 20]), 0), true)
  assert.equal(opaquePixelMayPaint(frames([10, 10, 10, 10]), 0), false)
})
