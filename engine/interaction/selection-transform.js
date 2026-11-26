import { framePoint, pointInFrame } from './selection-frame.js'

export const resizeHandles = Object.freeze({ top_left: [0, 0], top: [.5, 0], top_right: [1, 0], right: [1, .5], bottom_right: [1, 1], bottom: [.5, 1], bottom_left: [0, 1], left: [0, .5] })

// The pointer may land anywhere inside a handle's hit area. Apply its movement
// to the original corner instead of jumping that corner onto the first point.
export function resizeTransform(frame, handle, start, point, { center = false, uniform = false } = {}) {
  const [hx, hy] = resizeHandles[handle], from = pointInFrame(frame, start), to = pointInFrame(frame, point)
  const anchor = { x: frame.w * (center ? .5 : 1 - hx), y: frame.h * (center ? .5 : 1 - hy) }
  const width = frame.w * (center ? .5 : 1), height = frame.h * (center ? .5 : 1)
  let x = hx === .5 ? 1 : 1 + (to.x - from.x) / Math.max(width, 1e-9) * (hx === 0 ? -1 : 1)
  let y = hy === .5 ? 1 : 1 + (to.y - from.y) / Math.max(height, 1e-9) * (hy === 0 ? -1 : 1)
  // Old-editor native drags, 2026-11-25: 200×100 + (100,30) gives
  // 300×150 with Shift; shrinking by (-100,-20) gives 160×80.
  // The largest absolute factor governs both growth and shrinkage.
  if (uniform) {
    const factor = hx === .5 ? Math.abs(y) : hy === .5 ? Math.abs(x) : Math.max(Math.abs(x), Math.abs(y))
    x = Math.sign(x || 1) * factor; y = Math.sign(y || 1) * factor
  }
  // Commands reject zero factors. A crossing frame uses a tiny signed scale;
  // the existing command retains ownership of minimum size and reflection.
  const nonzero = value => Math.abs(value) < 1e-9 ? (value < 0 ? -1 : 1) * 1e-9 : value
  return { origin: framePoint(frame, anchor), scale: { x: nonzero(x), y: nonzero(y) } }
}

export function rotationTransform(frame, start, point, snap) {
  const origin = framePoint(frame, { x: frame.w / 2, y: frame.h / 2 })
  let angle = Math.atan2(point.y - origin.y, point.x - origin.x) - Math.atan2(start.y - origin.y, start.x - origin.x)
  // 2026-11-25 native old-editor drags: 6° and 24° without Shift,
  // 30° with Shift; normal rotation rounds to 1°, Shift to 15°.
  const step = snap ? Math.PI / 12 : Math.PI / 180
  angle = Math.round((frame.rotation + angle) / step) * step - frame.rotation
  return { origin, angle }
}
