import { imageCrop, imageSourceSize } from '../commands/crop-image.js'
import { resizeHandles } from './selection-transform.js'

const clamp = (n, a, b) => Math.max(a, Math.min(b, n))

export function resizedImageCrop(shape, handle, delta, ratio = null) {
  const size = imageSourceSize(shape), before = imageCrop(shape), [hx, hy] = resizeHandles[handle]
  const p = shape.props, minX = -before.topLeft.x * size.w, minY = -before.topLeft.y * size.h
  const maxX = (1 - before.topLeft.x) * size.w, maxY = (1 - before.topLeft.y) * size.h
  let left = 0, top = 0, right = p.w, bottom = p.h
  if (!ratio) {
    if (hx === 0) left = clamp(delta.x, minX, p.w - Math.min(1, p.w))
    if (hx === 1) right = clamp(p.w + delta.x, Math.min(1, p.w), maxX)
    if (hy === 0) top = clamp(delta.y, minY, p.h - Math.min(1, p.h))
    if (hy === 1) bottom = clamp(p.h + delta.y, Math.min(1, p.h), maxY)
  } else {
    const anchorX = hx === .5 ? p.w / 2 : hx === 0 ? p.w : 0
    const anchorY = hy === .5 ? p.h / 2 : hy === 0 ? p.h : 0
    const limitW = hx === .5 ? 2 * Math.min(anchorX - minX, maxX - anchorX) : hx === 0 ? anchorX - minX : maxX - anchorX
    const limitH = hy === .5 ? 2 * Math.min(anchorY - minY, maxY - anchorY) : hy === 0 ? anchorY - minY : maxY - anchorY
    const sx = hx === .5 ? 1 : 1 + delta.x / p.w * (hx === 0 ? -1 : 1)
    const sy = hy === .5 ? 1 : 1 + delta.y / p.h * (hy === 0 ? -1 : 1)
    const scale = hx === .5 ? sy : hy === .5 ? sx : Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy
    const w = clamp(p.w * scale, Math.min(1, p.w, p.h * ratio), Math.min(limitW, limitH * ratio)), height = w / ratio
    left = hx === .5 ? anchorX - w / 2 : hx === 0 ? anchorX - w : anchorX
    top = hy === .5 ? anchorY - height / 2 : hy === 0 ? anchorY - height : anchorY
    right = left + w; bottom = top + height
  }
  return { ...before, topLeft: { x: clamp(before.topLeft.x + left / size.w, 0, 1), y: clamp(before.topLeft.y + top / size.h, 0, 1) },
    bottomRight: { x: clamp(before.topLeft.x + right / size.w, 0, 1), y: clamp(before.topLeft.y + bottom / size.h, 0, 1) } }
}
