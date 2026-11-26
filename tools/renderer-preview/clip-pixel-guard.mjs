import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { compareClipPixels, assertClipPixels, pixelResponds, opaquePixelMayPaint } from './clip-pixel-comparison.mjs'
import { classifyClipRegions } from './clip-pixel-regions.mjs'
import { collectOpaqueEdgeProofs } from './opaque-edge-probe.mjs'
import { classifyOpaqueEdges } from './opaque-edge-rules.mjs'

const modulePath = '/tools/renderer-preview/clip-pixel-mask.js'
const intersects = (box, x, y, scale) => box.width > 0 && box.height > 0 && (x + 1) / scale > box.x && x / scale < box.x + box.width && (y + 1) / scale > box.y && y / scale < box.y + box.height

export async function checkClipPixels(contents, evidence) {
  const call = (name, argument) => contents.executeJavaScript(`import(${JSON.stringify(modulePath)}).then(module => module.${name}(${argument === undefined ? '' : JSON.stringify(argument)}))`)
  const settle = async (quietMs = 100) => {
    await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await delay(quietMs)
  }
  const captureStill = async name => {
    // Small-scale image tiles can finish rasterizing after the camera settles.
    // Require two identical captures; an unsettled image cannot become an A/A
    // allowance for changed opaque content.
    await settle(300)
    let previous = await contents.capturePage()
    for (let attempt = 0; attempt < 6; attempt++) {
      await settle()
      const current = await contents.capturePage()
      const a = previous.getSize(), b = current.getSize()
      if (a.width === b.width && a.height === b.height && previous.toBitmap().equals(current.toBitmap())) return current
      if (attempt === 5) {
        images[`${name}-unstable-previous`] = previous
        images[`${name}-unstable-current`] = current
        throw new Error(`裁剪像素截图未停稳，不能用作画面门槛：${name}，6次复拍`)
      }
      previous = current
    }
  }
  const images = {}
  let metadata, result, mask, regions
  const saveEvidence = async error => {
    const failures = []
    const save = async (suffix, data) => {
      try { await writeFile(join(evidence.directory, `${evidence.label}-${suffix}`), data()) }
      catch (error) { failures.push(error) }
    }
    for (const [name, image] of Object.entries(images)) await save(`${name}.png`, () => image.toPNG())
    if (mask) await save('ink.mask', () => mask)
    if (regions) await save('regions.mask', () => regions.mask)
    if (result) await save('pixels.json', () => JSON.stringify(result, null, 2))
    if (error) await save('failure.json', () => JSON.stringify({ error: error.stack, images: Object.fromEntries(Object.entries(images).map(([name, image]) => [name, image.getSize()])), metadata }, null, 2))
    if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('; '))
  }
  try {
    metadata = await call('beginClipPixelProbe')
    try {
      const masks = metadata.semiShapes.length ? [...metadata.semiShapes.map(shape => shape.id), 'opaque'] : []
      const modes = [['before', false], ['clipped', true], ['repeated', false], ...masks.flatMap((id, i) => [false, true].flatMap(clipped => ['black', 'white', 'black', 'white'].map((color, repeat) => [`mask-${i}-${Number(clipped)}-${repeat}`, clipped, id, color])))]
      for (const [name, clipped, maskId, color] of modes) {
        await call('setClipPixelMode', { clipped, maskId, color })
        images[name] = await captureStill(name)
      }
    } finally {
      assert.equal(await call('endClipPixelProbe'), true, '裁剪像素检查未恢复实际相机、SVG或掩码')
      await settle()
    }
    const { width, height } = images.before.getSize(), scale = width / metadata.viewport.width
    assert.ok(width > 0 && height > 0 && Number.isFinite(scale) && scale > 0, '裁剪像素检查没有非空截图')
    assert.equal(height / metadata.viewport.height, scale, '裁剪像素检查的截图比例不一致')
    const bitmaps = Object.fromEntries(Object.entries(images).map(([name, image]) => [name, { ...image.getSize(), bytes: image.toBitmap() }]))
    for (const bitmap of Object.values(bitmaps)) {
      assert.equal(bitmap.width, width); assert.equal(bitmap.height, height)
      assert.equal(bitmap.bytes.length, width * height * 4)
    }
    mask = new Uint8Array(width * height)
    const protectedInk = new Uint8Array(width * height), owners = {}, rejectedOverlaps = []
    const paint = i => [0, 1].map(clipped => [0, 1, 2, 3].map(repeat => bitmaps[`mask-${i}-${clipped}-${repeat}`].bytes))
    const masks = metadata.semiShapes.map((shape, i) => ({ id: shape.id, states: paint(i) }))
    const shapeInk = metadata.semiShapes.map(shape => ({ ...shape, mask: new Uint8Array(width * height) }))
    const opaqueMasks = metadata.semiShapes.length ? paint(masks.length) : []
    const probePixel = metadata.probe ? Math.floor(metadata.probe.y * scale) * width + Math.floor(metadata.probe.x * scale) : -1
    const htmlProbePixel = metadata.probe ? Math.floor(metadata.probe.htmlY * scale) * width + Math.floor(metadata.probe.x * scale) : -1
    for (let pixel = 0; masks.length && pixel < width * height; pixel++) {
      const offset = pixel * 4
      const ids = masks.filter(mask => pixelResponds(mask.states, offset)).map(mask => mask.id)
      // Unchanged owned pixels still matter: a faint AA neighbor must measure
      // its distance to real ink, not just to the changed subset of that ink.
      if (!ids.length && pixel !== probePixel && pixel !== htmlProbePixel && bitmaps.before.bytes.subarray(offset, offset + 4).equals(bitmaps.clipped.bytes.subarray(offset, offset + 4)) && bitmaps.before.bytes.subarray(offset, offset + 4).equals(bitmaps.repeated.bytes.subarray(offset, offset + 4))) continue
      const x = pixel % width, y = Math.floor(pixel / width)
      if (opaquePixelMayPaint(opaqueMasks, offset) || metadata.opaqueBoxes.some(box => intersects(box, x, y, scale))) { protectedInk[pixel] = 1; if (ids.length) rejectedOverlaps.push({ x, y }); continue }
      if (!ids.length) continue
      mask[pixel] = 1
      for (const shape of shapeInk) if (ids.includes(shape.id)) shape.mask[pixel] = 1
      if (!bitmaps.before.bytes.subarray(offset, offset + 4).equals(bitmaps.clipped.bytes.subarray(offset, offset + 4))) {
        const owner = ids.join(', ')
        owners[owner] = (owners[owner] || 0) + 1
      }
    }
    if (metadata.probe) {
      const x = Math.floor(metadata.probe.x * scale), y = Math.floor(metadata.probe.y * scale), pixel = y * width + x, offset = pixel * 4
      assert.ok(!metadata.opaqueBoxes.some(box => intersects(box, x, y, scale)), '溢出守卫的采样点意外落在视口框内')
      assert.ok(pixelResponds(masks.find(mask => mask.id === metadata.probe.id).states, offset), '溢出守卫没有实际半透明墨迹')
      assert.ok(pixelResponds(opaqueMasks, offset), '不透明掩码漏掉了SVG视口外的真实笔画')
      assert.equal(mask[pixel], 0, '不透明溢出笔画错误获得半透明许可')
      const htmlY = Math.floor(metadata.probe.htmlY * scale), htmlOffset = htmlProbePixel * 4
      assert.ok(pixelResponds(masks.find(mask => mask.id === metadata.probe.id).states, htmlOffset), 'HTML溢出守卫没有实际半透明墨迹')
      assert.ok(metadata.opaqueBoxes.some(box => intersects(box, x, htmlY, scale)), '不透明HTML外框漏出了SVG视口')
      assert.equal(mask[htmlProbePixel], 0, '不透明HTML溢出错误获得半透明许可')
    }
    regions = classifyClipRegions({ before: bitmaps.before, clipped: bitmaps.clipped, shapeInk, protectedInk, scale })
    if (metadata.probe) {
      assert.equal(regions.mask[probePixel], 0, '不透明溢出笔画错误获得半透明外缘许可')
      assert.equal(regions.mask[htmlProbePixel], 0, '不透明HTML错误获得半透明外缘许可')
    }
    const unknown = []
    for (let pixel = 0; pixel < width * height; pixel++) {
      const offset = pixel * 4
      if (!regions.mask[pixel] && !bitmaps.before.bytes.subarray(offset, offset + 4).equals(bitmaps.clipped.bytes.subarray(offset, offset + 4))) unknown.push({ x: pixel % width, y: Math.floor(pixel / width), cssX: (pixel % width) / scale, cssY: Math.floor(pixel / width) / scale, cssSize: 1 / scale })
    }
    // A fixture can permit at most 32 individually proved opaque AA points.
    // Larger unexplained changes fail without attempting to recolor the scene.
    const opaqueProof = unknown.length && unknown.length <= 32 ? await collectOpaqueEdgeProofs(contents, unknown, captureStill, images, { width, height }) : { proofs: [], search: { candidates: [], rejected: unknown.slice(0, 33) }, sampling: [] }
    const opaqueEdges = classifyOpaqueEdges({ before: bitmaps.before, clipped: bitmaps.clipped, regions, proofs: opaqueProof.proofs, scale })
    regions.mask = opaqueEdges.mask
    if (metadata.probe) {
      assert.equal(regions.mask[probePixel], 0, '不透明溢出笔画错误获得不透明AA许可')
      assert.equal(regions.mask[htmlProbePixel], 0, '不透明HTML错误获得不透明AA许可')
    }
    const outsideUnionBeforeOpaqueAA = regions.outsideUnion
    const outsideUnion = regions.outsideUnion.filter(({ x, y }) => regions.mask[y * width + x] !== 3)
    result = { ...compareClipPixels(bitmaps.before, bitmaps.clipped, bitmaps.repeated, regions.mask), outsideUnion, outsideUnionBeforeOpaqueAA, edgeDetails: regions.edgeDetails, opaqueEdgeDetails: opaqueEdges.details, opaqueProof, translucentShapes: metadata.semiShapes, owners, rejectedOverlaps, overflowProbe: Boolean(metadata.probe), width, height, scale }
    if (evidence && !evidence.failureOnly) await saveEvidence()
    assertClipPixels(result)
    return result
  } catch (error) {
    let evidenceError
    if (evidence) {
      try { await saveEvidence(error) } catch (failure) { evidenceError = failure }
    }
    const details = result ? '：' + JSON.stringify({ clipped: result.clipped, repeated: result.repeated, owners: result.owners, outsideUnion: result.outsideUnion.slice(0, 20) }) : ''
    // Keep the original gate failure even if writing its evidence also fails.
    const failure = new Error(error.message + details + (evidenceError ? '；失败证据写入失败：' + evidenceError.message : ''), { cause: evidenceError ? new AggregateError([error, evidenceError], '裁剪检查与取证均失败') : error })
    if (result) failure.clipPixels = result
    if (evidenceError) failure.evidenceError = evidenceError
    throw failure
  }
}
