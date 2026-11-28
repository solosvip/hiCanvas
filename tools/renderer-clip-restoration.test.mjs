import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseClipZoom, measureClipRestoration } from './renderer-preview/clip-restoration.mjs'

test('visibility gate stays at zoom 1; fractional zoom is an explicit diagnostic input', () => {
  assert.equal(parseClipZoom([]), 1)
  for (const value of ['0.79', '.8', '0.75', '0.8125', '1e0']) assert.equal(parseClipZoom(['--zoom', value]), Number(value))
})

for (const args of [['--zoom'], ['--scale', '1'], ['--zoom', '0'], ['--zoom', '-1'], ['--zoom', 'NaN'], ['--zoom', 'Infinity'], ['--zoom', ''], ['--zoom', ' '], ['--zoom', '0x1'], ['--zoom', '1e309'], ['--zoom', '1e-400'], ['--zoom', '1', '--zoom', '.79']]) {
  test(`invalid camera input is rejected before a native host starts: ${JSON.stringify(args)}`, () => {
    assert.throws(() => parseClipZoom(args), /倍率|用法/)
  })
}

const bitmap = bytes => ({ width: 2, height: 2, bytes: Buffer.from(bytes) })
test('whole-image equality requires every channel of every pixel to match', () => {
  const before = bitmap(new Uint8Array(16)), after = bitmap(before.bytes)
  assert.deepEqual(measureClipRestoration(before, after), { width: 2, height: 2, changedPixels: 0, maximumChannelDelta: 0, equal: true })
  after.bytes[13] = 8
  assert.deepEqual(measureClipRestoration(before, after), { width: 2, height: 2, changedPixels: 1, maximumChannelDelta: 8, equal: false })
  after.bytes[13] = 0; after.bytes[3] = 1
  assert.equal(measureClipRestoration(before, after).equal, false, 'even a one-step alpha change cannot become equality')
})

test('dimensions and damaged byte lengths cannot masquerade as equal captures', () => {
  const before = bitmap(new Uint8Array(16))
  for (const after of [{ ...before, width: 1, height: 4 }, { ...before, bytes: Buffer.alloc(15) }, { ...before, bytes: Buffer.alloc(17) }]) assert.throws(() => measureClipRestoration(before, after))
  assert.throws(() => measureClipRestoration({ ...before, width: 0 }, before))
  assert.throws(() => measureClipRestoration({ ...before, bytes: Buffer.alloc(15) }, before))
})
