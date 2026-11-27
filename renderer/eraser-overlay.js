import { createElement as h } from 'react'

export function checkedEraser(item) {
  if (!Array.isArray(item.ids) || Array.from(item.ids).some(id => typeof id !== 'string' || !id.startsWith('shape:') || id.length <= 6)
    || !Array.isArray(item.points) || item.points.length > 256 || Array.from(item.points).some(p => !p || ![p.x, p.y].every(Number.isFinite))
    || item.tailScale !== undefined && (!Number.isFinite(item.tailScale) || item.tailScale < 0 || item.tailScale > 1)) throw new Error('擦除描述需要形状ID、最多256个有限坐标与0至1的尾迹倍率。')
  const points = Object.freeze(item.points.map(({ x, y }) => Object.freeze({ x, y })))
  const x = points.length ? Math.min(...points.map(p => p.x)) : 0, y = points.length ? Math.min(...points.map(p => p.y)) : 0
  const bounds = { x, y, w: points.length ? Math.max(...points.map(p => p.x)) - x : 0, h: points.length ? Math.max(...points.map(p => p.y)) - y : 0 }
  if (![bounds.w, bounds.h].every(Number.isFinite)) throw new Error('擦除尾迹外框需要有限尺寸。')
  return Object.freeze({ kind: 'eraser', ids: Object.freeze([...new Set(item.ids)]), points, tailScale: item.tailScale ?? 1, bounds: Object.freeze(bounds) })
}

export function EraserOverlay({ item, zoom }) {
  if (!item.points.length) return null
  const first = item.points[0], path = item.points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
  return h('svg', { 'data-overlay-kind': 'eraser', 'aria-hidden': true, width: '100%', height: '100%', style: { position: 'absolute', left: 'var(--spacing-none)', top: 'var(--spacing-none)', overflow: 'visible', pointerEvents: 'none' } },
    h('path', { d: item.points.length === 1 ? `${path} L${first.x},${first.y}` : path, fill: 'none', stroke: 'var(--color-overlay-eraser-stroke)', strokeLinecap: 'round', strokeLinejoin: 'round', style: { strokeWidth: `calc(var(--spacing-overlay-eraser-stroke) * ${item.tailScale} / ${zoom})` } }))
}
