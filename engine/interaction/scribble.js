import { segmentHitsShape } from './selection-geometry.js'

// 2026-11-26 legacy native Alt brush: crossed objects stay selected when the
// short visual trail shrinks away; holding still retains its final marker.
// Keep at most 128 points / 100ms of visible tail, independent of accumulated hits.
const lifetime = 100, maxPoints = 128
export function createScribble(targets, scope, start, time) {
  const hitIds = new Set(), points = [{ ...start, time }]
  let last = start
  function age(now) {
    while (points.length > 1 && points[0].time < now - lifetime) points.shift()
    return describe()
  }
  function describe() {
    const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
    return { kind: 'scribble', bounds: { x, y, w: Math.max(...points.map(p => p.x)) - x, h: Math.max(...points.map(p => p.y)) - y }, points: points.map(({ x, y }) => ({ x, y })) }
  }
  return {
    move(point, now) {
      const box = { x: Math.min(last.x, point.x), y: Math.min(last.y, point.y), w: Math.max(1e-6, Math.abs(last.x - point.x)), h: Math.max(1e-6, Math.abs(last.y - point.y)) }
      for (const id of targets.candidates(box, scope)) if (segmentHitsShape(id, last, point, targets)) hitIds.add(targets.target(id, scope))
      if (point.x !== last.x || point.y !== last.y) points.push({ ...point, time: now })
      if (points.length > maxPoints) points.splice(0, points.length - maxPoints)
      last = point
      return { ids: targets.roots([...hitIds]), overlay: age(now) }
    },
    age, get needsFrame() { return points.length > 1 },
  }
}
