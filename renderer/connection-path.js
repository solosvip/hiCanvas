export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
export const mul = (p, n) => ({ x: p.x * n, y: p.y * n })
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
export const lerp = (a, b, t) => add(a, mul(sub(b, a), t))
export const unit = p => mul(p, 1 / (Math.hypot(p.x, p.y) || 1))
export const pathOf = (points, close = false) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + (close ? ' Z' : '')
export function pointBounds(points) {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 }
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
  return { x, y, w: Math.max(...points.map(p => p.x)) - x, h: Math.max(...points.map(p => p.y)) - y }
}
export function segmentDistance(p, a, b) {
  const d = sub(b, a), length = d.x * d.x + d.y * d.y
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / length)) : 0
  return distance(p, lerp(a, b, t))
}

export function polyline(points, d = pathOf(points)) {
  if (!points.length) points = [{ x: 0, y: 0 }]
  const lengths = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + distance(points[i - 1], points[i]))
  const length = lengths.at(-1)
  function atDistance(value) {
    const s = Math.max(0, Math.min(length, value))
    const i = Math.max(1, lengths.findIndex(n => n >= s && n > 0))
    if (i >= points.length || !length) return { ...points[0] }
    return lerp(points[i - 1], points[i], (s - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1))
  }
  return { d, points, lengths, length, bounds: pointBounds(points), at: t => atDistance(t * length), atDistance,
    tangent(t) { const s = t * length, e = Math.max(.01, length * .0001); return unit(sub(atDistance(s + e), atDistance(s - e))) },
    slice(start, end) {
      start = Math.max(0, Math.min(length, start)); end = Math.max(start, Math.min(length, end))
      return polyline([atDistance(start), ...points.filter((_, i) => lengths[i] > start && lengths[i] < end), atDistance(end)])
    },
  }
}

// Adaptive subdivision bounds the curve/chord deviation to .025 canvas units.
function flattenCubic(a, b, c, d, output, depth = 0) {
  if (depth >= 16 || Math.max(segmentDistance(b, a, d), segmentDistance(c, a, d)) <= .025) { output.push(d); return }
  const ab = lerp(a, b, .5), bc = lerp(b, c, .5), cd = lerp(c, d, .5), abc = lerp(ab, bc, .5), bcd = lerp(bc, cd, .5), center = lerp(abc, bcd, .5)
  flattenCubic(a, ab, abc, center, output, depth + 1); flattenCubic(center, bcd, cd, d, output, depth + 1)
}

export function linePath(props) {
  const points = Object.values(props.points || {}).sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : 0).map(({ x, y }) => ({ x, y }))
  if (props.spline !== 'cubic' || points.length < 2) return polyline(points)
  // 2026-11-25, running legacy synthetic 2/3/4-point lines: end controls
  // coincide with vertices; interior controls advance 5/24 of the neighbour span.
  const controls = points.map((p, i) => i && i < points.length - 1 ? mul(sub(points[i + 1], points[i - 1]), 5 / 24) : { x: 0, y: 0 })
  const flattened = [points[0]]
  let d = pathOf([points[0]])
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = add(a, controls[i - 1]), end = points[i], c = sub(end, controls[i])
    d += ` C${b.x},${b.y} ${c.x},${c.y} ${end.x},${end.y}`
    flattenCubic(a, b, c, end, flattened)
  }
  return polyline(flattened, d)
}

export function arcPath(start, end, bend) {
  const chord = sub(end, start), length = distance(start, end)
  if (Math.abs(bend) < .01 || length < .01) return polyline([start, end])
  const normal = { x: -chord.y / length, y: chord.x / length }, mid = lerp(start, end, .5)
  const center = add(mid, mul(normal, bend / 2 - length * length / (8 * bend))), radius = distance(center, start)
  const angle = Math.atan2(start.y - center.y, start.x - center.x)
  let sweep = Math.atan2(end.y - center.y, end.x - center.x) - angle
  if (bend > 0) { while (sweep >= 0) sweep -= Math.PI * 2 } else { while (sweep <= 0) sweep += Math.PI * 2 }
  const step = Math.max(.0001, 2 * Math.acos(Math.max(-1, 1 - .025 / radius)))
  const count = Math.min(16384, Math.max(2, Math.ceil(Math.abs(sweep) / step)))
  const points = Array.from({ length: count + 1 }, (_, i) => i === 0 ? start : i === count ? end : add(center, { x: Math.cos(angle + sweep * i / count) * radius, y: Math.sin(angle + sweep * i / count) * radius }))
  return polyline(points, `M${start.x},${start.y} A${radius},${radius} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${end.x},${end.y}`)
}

export function elbowPath(start, end, midPoint = .5, clearance = 0) {
  // Unbound terminals use the dominant chord direction. Bound routing lives in
  // connection-elbow, where the target contours and exit directions are known.
  const dx = end.x - start.x, dy = end.y - start.y
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  if (horizontal) {
    const sign = Math.sign(dx) || 1, a = start.x + sign * clearance, b = end.x - sign * clearance, x = a + (b - a) * midPoint
    return polyline([start, { x, y: start.y }, { x, y: end.y }, end])
  }
  const sign = Math.sign(dy) || 1, a = start.y + sign * clearance, b = end.y - sign * clearance, y = a + (b - a) * midPoint
  return polyline([start, { x: start.x, y }, { x: end.x, y }, end])
}
