import { pointInFrame } from './selection-frame.js'
import { resizeHandles } from './selection-transform.js'

// 2026-11-25, isolated tldraw 5.1.1, native pointer + overlay-canvas pixels:
// corners paint a 10px square including a 2px border; resize hits ±6px,
// edge hits ±4px. Invisible rotation regions are 6px-radius circles centered
// 7px outside each corner in both axes (cursor grid and actual drag checked).
// These are screen CSS pixels, independent of document zoom; DESIGN owns paint.
export const selectionHandleMetrics = Object.freeze({ cornerHit: 6, edgeHit: 4, rotationOffset: 7, rotationRadius: 6 })

export function describeSelection(selection, ids, rotation) {
  const frame = selection.get(ids, rotation)
  if (!frame) return null
  const transformable = frame.w > 0 && frame.h > 0
  const handles = []
  const capability = selection.capability(ids)
  if (transformable && capability.canScale && !capability.hideResizeHandles) for (const [id, [x, y]] of Object.entries(resizeHandles)) handles.push({ id, kind: 'resize', x: x * frame.w, y: y * frame.h, corner: x !== .5 && y !== .5 })
  for (const [id, [x, y]] of Object.entries(resizeHandles)) if (selection.canRotate(ids) && x !== .5 && y !== .5) handles.push({ id, kind: 'rotate', x: x * frame.w, y: y * frame.h, directionX: x === 0 ? -1 : 1, directionY: y === 0 ? -1 : 1 })
  return { kind: 'selection', id: ids.join(','), bounds: { x: frame.x, y: frame.y, w: frame.w, h: frame.h }, rotation: frame.rotation, handles }
}

export function checkedHandleMetrics(value) {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('手柄命中尺寸需要数值配置。')
  const result = { ...selectionHandleMetrics, ...value }
  if (Object.keys(result).some(key => !Object.hasOwn(selectionHandleMetrics, key) || !Number.isFinite(result[key]) || result[key] <= 0)) throw new Error('手柄命中尺寸需要有限正数。')
  return Object.freeze(result)
}

export function hitSelectionHandle(overlay, point, zoom, metrics = selectionHandleMetrics) {
  if (!overlay) return null
  const frame = { ...overlay.bounds, rotation: overlay.rotation }, local = pointInFrame(frame, point)
  const { cornerHit, edgeHit, rotationOffset, rotationRadius } = metrics
  for (const h of overlay.handles.filter(h => h.kind === 'resize' && h.corner)) if (Math.abs(local.x - h.x) * zoom <= cornerHit && Math.abs(local.y - h.y) * zoom <= cornerHit) return h
  for (const h of overlay.handles.filter(h => h.kind === 'resize' && !h.corner)) {
    const horizontal = h.id === 'top' || h.id === 'bottom'
    if (horizontal && local.x >= 0 && local.x <= frame.w && Math.abs(local.y - h.y) * zoom <= edgeHit || !horizontal && local.y >= 0 && local.y <= frame.h && Math.abs(local.x - h.x) * zoom <= edgeHit) return h
  }
  for (const h of overlay.handles.filter(h => h.kind === 'rotate')) if (Math.hypot((local.x - h.x) * zoom - h.directionX * rotationOffset, (local.y - h.y) * zoom - h.directionY * rotationOffset) <= rotationRadius) return h
  return null
}

export function selectionHandleCursor(handle, rotation) {
  if (!handle) return null
  if (handle.kind === 'rotate') return 'crosshair'
  const [x, y] = resizeHandles[handle.id]
  const angle = Math.atan2(y - .5, x - .5) + rotation
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][(Math.round(angle / (Math.PI / 4)) % 4 + 4) % 4]
}
