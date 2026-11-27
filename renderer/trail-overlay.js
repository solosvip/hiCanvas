import { createElement as h } from 'react'

// Both tools cross the same renderer seam: copy finite world points and derive
// bounds here instead of trusting caller-provided geometry or mutable arrays.
export function checkedTrailPoints(value, maxPoints, label) {
  if (!Array.isArray(value) || value.length > maxPoints || Array.from(value).some(p => !p || ![p.x, p.y].every(Number.isFinite))) throw new Error(`${label}需要最多${maxPoints}个有限坐标。`)
  const points = Object.freeze(value.map(({ x, y }) => Object.freeze({ x, y })))
  const xs = points.map(p => p.x), ys = points.map(p => p.y)
  const x = points.length ? Math.min(...xs) : 0, y = points.length ? Math.min(...ys) : 0
  const bounds = { x, y, w: points.length ? Math.max(...xs) - x : 0, h: points.length ? Math.max(...ys) - y : 0 }
  if (![bounds.w, bounds.h].every(Number.isFinite)) throw new Error(`${label}外框需要有限尺寸。`)
  return { points, bounds: Object.freeze(bounds) }
}

export function TrailOverlay({ item, zoom, checkPaint }) {
  if (!item.points.length) return null
  const first = item.points[0], path = item.points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
  return h('svg', { ref: checkPaint, 'data-overlay-kind': item.kind, 'data-overlay-id': item.id, 'aria-hidden': true, width: '100%', height: '100%', style: { position: 'absolute', left: 'var(--spacing-none)', top: 'var(--spacing-none)', overflow: 'visible', pointerEvents: 'none' } },
    h('path', { d: item.points.length === 1 ? `${path} L${first.x},${first.y}` : path, fill: 'none', stroke: `var(--color-overlay-${item.kind}-stroke)`, strokeLinecap: 'round', strokeLinejoin: 'round', style: { strokeWidth: `calc(var(--spacing-overlay-${item.kind}-stroke) * ${item.tailScale ?? 1} / ${zoom})` } }))
}
