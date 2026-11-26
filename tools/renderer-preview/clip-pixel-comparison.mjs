import assert from 'node:assert/strict'

const samePixel = (a, b, offset) => a.subarray(offset, offset + 4).equals(b.subarray(offset, offset + 4))

export const pixelResponds = (states, offset) => states.some(([black, white, black2, white2]) => !samePixel(black, white, offset) && samePixel(black, black2, offset) && samePixel(white, white2, offset))

// Uncertain opaque coverage cannot grant translucent permission. Even an
// unstable repeat excludes the pixel, rather than pretending it has no ink.
export const opaquePixelMayPaint = (states, offset) => states.some(([first, ...rest]) => rest.some(image => !samePixel(first, image, offset)))

export function compareClipPixels(before, clipped, repeated, translucentInk) {
  const { width, height } = before
  assert.ok(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0, '需要非空像素截图')
  for (const image of [before, clipped, repeated]) {
    assert.equal(image.width, width)
    assert.equal(image.height, height)
    assert.equal(image.bytes.length, width * height * 4)
  }
  assert.equal(translucentInk.length, width * height)
  const empty = () => ({ changedPixels: 0, maximumChannelDelta: 0 })
  const result = { clipped: { opaque: empty(), translucent: empty(), edge: empty(), opaqueEdge: empty() }, repeated: { opaque: empty(), translucent: empty(), edge: empty(), opaqueEdge: empty() } }
  for (let pixel = 0; pixel < width * height; pixel++) {
    const region = ['opaque', 'translucent', 'edge', 'opaqueEdge'][translucentInk[pixel]]
    assert.ok(region, '未知裁剪像素区域')
    for (const [name, image] of [['clipped', clipped], ['repeated', repeated]]) {
      let delta = 0
      for (let channel = 0; channel < 4; channel++) delta = Math.max(delta, Math.abs(before.bytes[pixel * 4 + channel] - image.bytes[pixel * 4 + channel]))
      result[name][region].changedPixels += Number(delta > 0)
      result[name][region].maximumChannelDelta = Math.max(result[name][region].maximumChannelDelta, delta)
    }
  }
  return result
}

export function assertClipPixels(result) {
  // Main's 2335 02:2x ruling, .scratch/renderer-perf/v67-clip-current:
  // opaque/background changes stay zero. Proven translucent ink allows 2;
  // individually owned AA neighbors allow 1. A/A noise grants no permission.
  assert.equal(result.outsideUnion.length, 0, '裁剪变化落在半透明几何外框外扩3CSS像素的并集以外')
  assert.equal(result.clipped.opaque.changedPixels, 0, '不透明区域或未证明的背景发生裁剪变化')
  assert.ok(result.clipped.translucent.maximumChannelDelta <= 2, '半透明墨迹的裁剪差异超过2色阶')
  assert.ok(result.clipped.edge.maximumChannelDelta <= 1, '半透明抗锯齿外缘的裁剪差异超过1色阶')
  assert.ok(result.clipped.opaqueEdge.changedPixels <= 32, '不透明抗锯齿边缘变化超过32点')
  assert.ok(result.clipped.opaqueEdge.maximumChannelDelta <= 1, '不透明抗锯齿边缘的裁剪差异超过1色阶')
}
