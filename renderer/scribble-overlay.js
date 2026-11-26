import { createElement as h } from 'react'

export function checkedScribble(item) {
  // Engine tails retain at most 128 points. Allow up to 256 at this public
  // renderer boundary, bounding validation and SVG work even for hostile input.
  if (!Array.isArray(item?.points) || !item.points.length || item.points.length > 256 || Array.from(item.points).some(p => !p || ![p.x, p.y].every(Number.isFinite))) throw new Error('涂抹覆盖层需要 1 至 256 个有限坐标点。')
  const points = Object.freeze(item.points.map(({ x, y }) => Object.freeze({ x, y })))
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
  const bounds = { x, y, w: Math.max(...points.map(p => p.x)) - x, h: Math.max(...points.map(p => p.y)) - y }
  if (![bounds.w, bounds.h].every(Number.isFinite)) throw new Error('涂抹覆盖层外框需要有限尺寸。')
  return Object.freeze({ kind: 'scribble', points, bounds: Object.freeze(bounds) })
}

export function ScribbleOverlay({ item, zoom }) {
  const points = item.points, first = points[0], path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
  return h('svg', { 'data-overlay-kind': 'scribble', 'aria-hidden': true, width: '100%', height: '100%', style: { position: 'absolute', left: 'var(--spacing-none)', top: 'var(--spacing-none)', overflow: 'visible', pointerEvents: 'none' } },
    h('path', { d: points.length === 1 ? `${path} L${first.x},${first.y}` : path, fill: 'none', stroke: 'var(--color-overlay-scribble-stroke)', strokeLinecap: 'round', strokeLinejoin: 'round', style: { strokeWidth: `calc(var(--spacing-overlay-scribble-stroke) / ${zoom})` } }))
}
