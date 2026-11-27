// Point storage is shared, while each tool owns its lifetime policy. In
// particular eraser's drop-oldest limit and 100ms aging remain unchanged.
export function appendTrailPoint(points, point, maxPoints, overflow = 'drop-oldest') {
  points.push(point)
  if (points.length <= maxPoints) return
  if (overflow === 'decimate') {
    const last = points.at(-1), kept = points.filter((_, i) => i % 2 === 0)
    if (kept.at(-1) !== last) kept.push(last)
    points.splice(0, points.length, ...kept)
  } else points.splice(0, points.length - maxPoints)
}

export function describeTrail(points) {
  const copy = points.map(({ x, y }) => ({ x, y }))
  const x = copy.length ? Math.min(...copy.map(p => p.x)) : 0, y = copy.length ? Math.min(...copy.map(p => p.y)) : 0
  return { points: copy, bounds: { x, y, w: copy.length ? Math.max(...copy.map(p => p.x)) - x : 0, h: copy.length ? Math.max(...copy.map(p => p.y)) - y : 0 } }
}
