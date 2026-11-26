const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })

// Quadratic midpoint smoothing is an independent geometric construction.
// Straight (Shift) segments keep their endpoints and never bend at a corner.
export function sampleSegments(segments) {
  const result = []
  const append = p => { const before = result.at(-1); if (!before || distance(before, p) > 1e-7) result.push(p); else before.z = p.z }
  for (const { type, points } of segments) {
    if (!points.length) continue
    append({ ...points[0] })
    if (type === 'straight' || points.length < 3) {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], steps = Math.max(1, Math.ceil(distance(a, b) / 4))
        for (let step = 1; step <= steps; step++) append(mix(a, b, step / steps))
      }
    } else {
      let start = points[0]
      for (let i = 1; i < points.length; i++) {
        const control = points[i - 1], end = i === points.length - 1 ? points[i] : mix(control, points[i], 0.5)
        const steps = Math.max(1, Math.ceil((distance(start, control) + distance(control, end)) / 4))
        for (let step = 1; step <= steps; step++) {
          const t = step / steps
          append(mix(mix(start, control, t), mix(control, end, t), t))
        }
        start = end
      }
    }
  }
  return result
}

const arc = (p, radius, angle, sweep) => Array.from({ length: 33 }, (_, i) => ({ x: p.x + Math.cos(angle + sweep * i / 32) * radius, y: p.y + Math.sin(angle + sweep * i / 32) * radius }))

export function strokeOutline(points, radii, closed = false) {
  if (points.length === 1) return [...arc(points[0], radii[0], 0, Math.PI), ...arc(points[0], radii[0], Math.PI, Math.PI)]
  const sameEnd = distance(points[0], points.at(-1)) < 1e-7
  const path = closed && sameEnd ? points.slice(0, -1) : points
  const left = [], right = []
  for (let i = 0; i < path.length; i++) {
    const before = path[closed ? (i + path.length - 1) % path.length : Math.max(0, i - 1)]
    const after = path[closed ? (i + 1) % path.length : Math.min(path.length - 1, i + 1)]
    const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy) || 1, radius = radii[i]
    const nx = -dy / length * radius, ny = dx / length * radius
    left.push({ x: path[i].x + nx, y: path[i].y + ny }); right.push({ x: path[i].x - nx, y: path[i].y - ny })
  }
  if (closed) return [...left, left[0], right[0], ...right.slice(1).reverse(), right[0]]
  const start = Math.atan2(path[1].y-path[0].y, path[1].x-path[0].x)
  const end = Math.atan2(path.at(-1).y-path.at(-2).y, path.at(-1).x-path.at(-2).x)
  return [...left, ...arc(path.at(-1), radii.at(-1), end + Math.PI / 2, -Math.PI), ...right.reverse(), ...arc(path[0], radii[0], start - Math.PI / 2, -Math.PI)]
}

export function strokeOutlines(points, radii, closed = false) {
  // A reversal has two round caps at the same location. An averaged normal
  // would cancel to zero and incorrectly pinch the returning ink to a point.
  const reversal = (a, b, c) => {
    const before = distance(a, b), after = distance(b, c)
    return before && after && ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (before * after) < -0.95
  }
  if (closed && points.length > 2) {
    const ring = distance(points[0], points.at(-1)) < 1e-7 ? points.slice(0, -1) : points
    const seam = ring.findIndex((p, i) => reversal(ring[(i + ring.length - 1) % ring.length], p, ring[(i + 1) % ring.length]))
    if (seam >= 0) {
      const order = Array.from({ length: ring.length + 1 }, (_, i) => (seam + i) % ring.length)
      return strokeOutlines(order.map(i => ring[i]), order.map(i => radii[i]))
    }
  }
  const turns = []
  for (let i = 1; i < points.length - 1; i++) if (reversal(points[i - 1], points[i], points[i + 1])) turns.push(i)
  if (!turns.length) return [strokeOutline(points, radii, closed)]
  let start = 0
  const result = []
  for (const end of [...turns, points.length - 1]) {
    result.push(strokeOutline(points.slice(start, end + 1), radii.slice(start, end + 1)))
    start = end
  }
  return result
}
