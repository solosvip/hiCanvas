import assert from 'node:assert/strict'

const edgeRadius = 3
const changed = (a, b, pixel) => !a.subarray(pixel * 4, pixel * 4 + 4).equals(b.subarray(pixel * 4, pixel * 4 + 4))
const expanded = bounds => ({ x: bounds.x - edgeRadius, y: bounds.y - edgeRadius, width: bounds.width + edgeRadius * 2, height: bounds.height + edgeRadius * 2 })
const contains = (bounds, x, y) => x >= bounds.x && y >= bounds.y && x <= bounds.x + bounds.width && y <= bounds.y + bounds.height

// 2335, main's 02:2x ruling; evidence: .scratch/renderer-perf/v67-clip-current.
// Quantization can hide very faint translucent AA from the color response.
// Permission follows actual owned ink and its own geometry, never a full-image
// tolerance. Independently detected opaque ink remains protected at overlaps.
export function classifyClipRegions({ before, clipped, shapeInk, protectedInk, scale }) {
  const { width, height } = before, length = width * height
  assert.ok(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)
  assert.equal(clipped.width, width); assert.equal(clipped.height, height)
  assert.equal(before.bytes.length, length * 4); assert.equal(clipped.bytes.length, length * 4)
  assert.equal(protectedInk.length, length)
  assert.ok(Number.isFinite(scale) && scale > 0)
  const shapes = shapeInk.map(shape => {
    assert.ok(shape.id && shape.opacity > 0 && shape.opacity < 1)
    assert.equal(shape.mask.length, length)
    assert.ok(['x', 'y', 'width', 'height'].every(key => Number.isFinite(shape.bounds[key])))
    assert.ok(shape.bounds.width > 0 && shape.bounds.height > 0)
    return { ...shape, expandedBounds: expanded(shape.bounds) }
  })
  const offsets = [], radius = Math.ceil(edgeRadius * scale)
  for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
    const distance = Math.hypot(x, y) / scale
    if (distance <= edgeRadius) offsets.push({ x, y, distance })
  }
  offsets.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x)
  const mask = new Uint8Array(length), edgeDetails = [], outsideUnion = []
  for (let pixel = 0; pixel < length; pixel++) {
    if (!protectedInk[pixel] && shapes.some(shape => shape.mask[pixel])) mask[pixel] = 1
    if (!changed(before.bytes, clipped.bytes, pixel)) continue
    // Match the evidence's integer screenshot coordinates divided by DPR.
    const x = pixel % width, y = Math.floor(pixel / width), cssX = x / scale, cssY = y / scale
    const candidates = shapes.filter(shape => contains(shape.expandedBounds, cssX, cssY))
    if (!candidates.length) outsideUnion.push({ x, y, cssX, cssY })
    if (mask[pixel]) continue
    const point = { x, y, cssX, cssY }
    if (protectedInk[pixel]) { edgeDetails.push({ ...point, allowed: false, reason: 'opaque ink or HTML coverage' }); continue }
    let nearest
    for (const offset of offsets) {
      const nx = x + offset.x, ny = y + offset.y
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const index = ny * width + nx
      const shape = candidates.find(shape => shape.mask[index] && !protectedInk[index])
      if (shape) { nearest = { shape, x: nx, y: ny, distanceCss: offset.distance }; break }
    }
    if (nearest) {
      mask[pixel] = 2
      edgeDetails.push({ ...point, allowed: true, owner: nearest.shape.id, opacity: nearest.shape.opacity, distanceCss: nearest.distanceCss, nearestAssigned: { x: nearest.x, y: nearest.y }, bounds: nearest.shape.bounds, expandedBounds: nearest.shape.expandedBounds })
    } else edgeDetails.push({ ...point, allowed: false, reason: 'no owned translucent ink within 3 CSS pixels and the same expanded shape bounds' })
  }
  return { mask, edgeDetails, outsideUnion }
}
