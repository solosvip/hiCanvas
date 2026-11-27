import { getConnectionGeometry, getShapeContour, pointInShape } from '../../renderer/geometry.js'

const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const on = (p, a, b) => p.x >= Math.min(a.x, b.x) - 1e-8 && p.x <= Math.max(a.x, b.x) + 1e-8 && p.y >= Math.min(a.y, b.y) - 1e-8 && p.y <= Math.max(a.y, b.y) + 1e-8
function intersects(a, b, c, d) {
  const x = cross(a, b, c), y = cross(a, b, d), z = cross(c, d, a), w = cross(c, d, b)
  return x * y < 0 && z * w < 0 || Math.abs(x) < 1e-8 && on(c, a, b) || Math.abs(y) < 1e-8 && on(d, a, b) || Math.abs(z) < 1e-8 && on(a, c, d) || Math.abs(w) < 1e-8 && on(b, c, d)
}
function localPoint(point, chain) {
  return [...chain].reverse().reduce((p, r) => {
    const x = p.x - r.x, y = p.y - r.y, c = Math.cos(r.rotation || 0), s = Math.sin(r.rotation || 0)
    return { x: x * c + y * s, y: -x * s + y * c }
  }, point)
}
function clip(a, b, w, h) {
  let low = 0, high = 1
  for (const [start, delta, end] of [[a.x, b.x - a.x, w], [a.y, b.y - a.y, h]]) {
    if (Math.abs(delta) < 1e-12) { if (start < 0 || start > end) return null; continue }
    const t1 = -start / delta, t2 = (end - start) / delta
    low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2))
    if (low > high) return null
  }
  return [low, high]
}
function project(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
  return at(a, b, length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0)
}
const at = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
function inside(point, points) {
  let hit = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

// Test the entire input segment, never just sampled pointer endpoints. A fast
// cross-board move must hit a small object without work proportional to distance.
export function segmentHitsShape(id, from, to, targets, tolerance = 0) {
  const chain = targets.lineage(id), record = chain[0]
  if (!record) return false
  let a = from, b = to
  for (let i = 1; i < chain.length; i++) if (chain[i].type === 'frame') {
    const localA = localPoint(a, chain.slice(i)), localB = localPoint(b, chain.slice(i)), props = chain[i].props
    const range = clip(localA, localB, props.w, props.h)
    if (!range) return false
    const start = a; a = at(start, b, range[0]); b = at(start, b, range[1])
  }
  a = localPoint(a, chain); b = localPoint(b, chain)
  const context = targets.records
  if (record.type !== 'frame' && (pointInShape(record, a, tolerance, context) || pointInShape(record, b, tolerance, context))) return true
  const contour = getShapeContour(record, context)
  if (!contour) return false
  let paths
  if (record.type === 'arrow' || record.type === 'line') {
    // The public connection contour is a bounding contour. Keep independent
    // paths separate, so a head/label never creates a fictitious closing edge.
    const geometry = getConnectionGeometry(record, context)
    if (tolerance > 0 && record.props.fill !== 'none' && geometry.heads.some(head => head.closed && (inside(a, head.points) || inside(b, head.points)))) return true
    paths = [{ points: geometry.path.points, closed: false }, ...geometry.heads.map(head => ({ points: head.points, closed: head.closed }))]
    if (geometry.label) {
      const r = geometry.label.bounds
      paths.push({ points: [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }], closed: true })
    }
  } else paths = [...(contour.outlines || [contour.outline]).map(points => ({ points, closed: true })), ...contour.decorations.map(points => ({ points, closed: false }))]
  return paths.some(({ points, closed }) => {
    let nearest = null, distance = Infinity
    for (let i = 0; i < points.length; i++) {
      if (!i && !closed) continue
      const p = points[i], previous = points[(i + points.length - 1) % points.length]
      if (intersects(a, b, previous, p)) return true
      if (tolerance > 0 || ['geo', 'line', 'arrow'].includes(record.type)) for (const endpoint of [previous, p]) {
        const point = project(endpoint, a, b), d = (endpoint.x - point.x) ** 2 + (endpoint.y - point.y) ** 2
        if (d < distance) { nearest = point; distance = d }
      }
      if (tolerance > 0) for (const point of [a, b]) {
        const edge = project(point, previous, p), d = (edge.x - point.x) ** 2 + (edge.y - point.y) ** 2
        if (d < distance) { nearest = point; distance = d }
      }
    }
    // One shared hit test per path includes the actual stroke width without
    // rebuilding a large draw/connection contour once for every vertex.
    return nearest && (tolerance > 0 && distance <= tolerance ** 2 || record.type !== 'frame' && pointInShape(record, nearest, tolerance, context))
  })
}
