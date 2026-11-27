import { unionBounds } from './object-snapping.js'

// Isolated legacy runtime, native input and public shape readbacks, 2026-11-26:
// base spacing10 canvas units at zoom .5/1/2; off-grid arrow offsets persist.
const spacing = 10
export const gridDescription = Object.freeze({ kind: 'grid', bounds: Object.freeze({ x: 0, y: 0, w: 0, h: 0 }), spacing })
function gridTarget(value) {
  const next = Math.round(value / spacing) * spacing
  return { value: next, delta: next - value }
}
// Native old-runtime readbacks: resize rounds the pointer before transform
// constraints and before the object policy measures its CSS-pixel radius.
export const gridPoint = point => ({ x: gridTarget(point.x).value, y: gridTarget(point.y).value })
export function gridMove(starts, delta, input) {
  const box = unionBounds(starts.map(start => start.bounds))
  if (!box) return delta
  const locked = input.shiftKey ? Math.abs(delta.x) > Math.abs(delta.y) ? 'y' : 'x' : null
  return Object.fromEntries(['x', 'y'].map(axis => [axis, locked === axis ? delta[axis] : delta[axis] + gridTarget(box[axis] + delta[axis]).delta]))
}
