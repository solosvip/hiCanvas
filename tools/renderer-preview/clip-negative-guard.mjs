import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkClipPixels } from './clip-pixel-guard.mjs'

// The rectangle's stroke ends exactly at the SVG bottom. A positive 1px
// bottom inset removes exactly one CSS pixel of opaque ink, not AA rounding.
export async function checkOpaqueBorderCut(contents, evidence, decodeImage) {
  const id = 'shape:clip-one-pixel-cut'
  const bounds = await contents.executeJavaScript(`(() => {
    if (document.querySelector('[data-shape-id="${id}"]')) throw new Error('裁断反例已占用');
    const node = document.createElement('div');
    node.dataset.shapeId = '${id}'; node.dataset.shapeType = 'geo';
    node.style.cssText = 'position:fixed;left:32px;top:32px;z-index:2147483647';
    node.innerHTML = '<svg width="100" height="80" style="overflow:visible;clip-path:inset(0px 0px 1px 0px)"><rect x="2" y="2" width="96" height="76" fill="white" stroke="black" stroke-width="4"/></svg>';
    document.body.append(node);
    const b = node.firstElementChild.getBoundingClientRect();
    return { x:b.x, y:b.y, width:b.width, height:b.height };
  })()`)
  try {
    let failure
    try { await checkClipPixels(contents, evidence) } catch (error) { failure = error }
    if (failure?.evidenceError) throw failure
    assert.ok(failure?.clipPixels, '真实裁断1CSS像素必须由像素门槛报红，不能因其他异常充作通过')
    const result = failure.clipPixels
    assert.ok(result.clipped.opaque.changedPixels > 0 && result.clipped.opaque.maximumChannelDelta > 1, '裁断反例没有拒绝不透明墨迹丢失')
    const before = decodeImage(await readFile(join(evidence.directory, `${evidence.label}-before.png`))).toBitmap()
    const clipped = decodeImage(await readFile(join(evidence.directory, `${evidence.label}-clipped.png`))).toBitmap()
    const x = Math.floor((bounds.x + bounds.width / 2) * result.scale)
    const y = Math.floor((bounds.y + bounds.height - .5) * result.scale)
    const offset = (y * result.width + x) * 4
    const delta = Math.max(...[0, 1, 2].map(channel => Math.abs(before[offset + channel] - clipped[offset + channel])))
    assert.ok(delta > 32, '1CSS裁断区的真实像素没有明显改变，不能作为反例')
    return { rejected: true, cutCss: 1, bounds, x, y, delta, clipped: result.clipped }
  } finally {
    assert.equal(await contents.executeJavaScript(`(() => { const node=document.querySelector('[data-shape-id="${id}"]'); node?.remove(); return !document.querySelector('[data-shape-id="${id}"]') })()`), true)
  }
}
