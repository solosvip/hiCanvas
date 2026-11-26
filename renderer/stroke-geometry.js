import { decodeStrokePoints } from './stroke-points.js'
import { sampleSegments, strokeOutline, strokeOutlines } from './stroke-outline.js'
import { INK_WIDTHS, strokeRadii } from './stroke-metrics.js'

const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)

// 2026-11-25 对照运行中的旧版画面测量：虚线 2w/2w，圆点 0.1/2w，
// 均为圆头、偏移为零。沿平滑后的弧长分段，绘制与命中共用圆头轮廓。
function dashedOutlines(points, radius, dash) {
  if (points.length === 1) return [strokeOutline(points, [radius])]
  const lengths = dash === 'dotted' ? [0.1, radius * 4] : [radius * 4, radius * 4]
  const result = []
  let phase = 0, remaining = lengths[0], active = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = distance(a, b)
    let travelled = 0
    while (travelled < length - 1e-8) {
      const step = Math.min(remaining, length - travelled), end = mix(a, b, (travelled + step) / length)
      if (phase === 0) active.push(end)
      remaining -= step; travelled += step
      if (remaining < 1e-8) {
        if (phase === 0 && active.length) result.push(...strokeOutlines(active, active.map(() => radius)))
        phase = 1 - phase; remaining = lengths[phase]; active = phase === 0 ? [end] : []
      }
    }
  }
  if (phase === 0 && active.length) result.push(...strokeOutlines(active, active.map(() => radius)))
  return result
}

export function getStrokeGeometry(shape) {
  const props = shape.props, segments = []
  let travelled = 0, steps = 0
  for (const segment of props.segments || []) {
    const points = decodeStrokePoints(segment.path).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).map(p => ({ ...p, z: Number.isFinite(p.z) ? p.z : 0.5 }))
    for (let i = 1; i < points.length; i++) { travelled += distance(points[i - 1], points[i]); steps++ }
    segments.push({ type: segment.type, points })
  }
  const sampled = sampleSegments(segments)
  if (!sampled.length) return null
  const closed = shape.type === 'draw' && props.isClosed && sampled.length > 2
  if (closed && distance(sampled[0], sampled.at(-1)) > 1e-7) sampled.push({ ...sampled[0] })
  const radii = strokeRadii(shape, sampled, steps ? travelled / steps : 0)
  // 2026-11-25 isolated legacy native drags + pixel cross-sections: scaling
  // the path by 2 keeps draw/highlight thickness, pressure and stored points.
  // Transform the centerline before outlining; scaling an outline also scales
  // its radii and makes rendering and hit testing disagree with that behavior.
  const points = sampled.map(p => ({ ...p, x: p.x * (props.scaleX ?? 1), y: p.y * (props.scaleY ?? 1) }))
  const width = (INK_WIDTHS[props.size] || INK_WIDTHS.m) * Math.abs(props.scale || 1)
  const dashed = shape.type === 'draw' && ['dashed', 'dotted'].includes(props.dash)
  const outlines = dashed ? dashedOutlines(points, width / 2, props.dash) : strokeOutlines(points, radii, closed)
  const fill = closed && props.fill !== 'none' ? points.map(({ x, y }) => ({ x, y })) : []
  const outline = [...outlines.flat(), ...fill]
  const bounds = outline.reduce((b, p) => ({ x: Math.min(b.x, p.x), y: Math.min(b.y, p.y), right: Math.max(b.right, p.x), bottom: Math.max(b.bottom, p.y) }), { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity })
  return { outline, outlines, decorations: [], ellipse: null, fill, bounds: { x: bounds.x, y: bounds.y, w: bounds.right - bounds.x, h: bounds.bottom - bounds.y } }
}

function inPolygon(points, point, tolerance) {
  let winding = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i], dx = b.x - a.x, dy = b.y - a.y
    const length = dx * dx + dy * dy, t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0
    if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) <= tolerance) return true
    const cross = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y)
    if (a.y <= point.y && b.y > point.y && cross > 0) winding++
    if (a.y > point.y && b.y <= point.y && cross < 0) winding--
  }
  return winding !== 0
}

export function pointInStroke(shape, point, tolerance = 0) {
  const geometry = getStrokeGeometry(shape)
  return !!geometry && (inPolygon(geometry.fill, point, tolerance) || geometry.outlines.some(points => inPolygon(points, point, tolerance)))
}
