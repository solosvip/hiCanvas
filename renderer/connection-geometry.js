import { linePath, arcPath, pointBounds, segmentDistance, mul, distance } from './connection-path.js'
import { connectionContext } from './connection-records.js'
import { boundTerminal, terminalContact } from './connection-binding.js'
import { boundElbowPath } from './connection-elbow.js'
import { arrowHead } from './connection-heads.js'
import { connectionLabel } from './connection-label.js'
import { connectionWidth, CONNECTION_METRICS as m } from './connection-metrics.js'

const corners = b => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }]
const inBox = (p, b, tolerance = 0) => p.x >= b.x - tolerance && p.x <= b.x + b.w + tolerance && p.y >= b.y - tolerance && p.y <= b.y + b.h + tolerance

// Pure drawing geometry in the connection's LOCAL coordinates. Context is a
// snapshot or {getRecord,childIds,bindingsFrom,bindingsTo}; it is never modified.
// contacts sit on the target contour; body terminals preserve observed spacing.
export function getConnectionGeometry(shape, context) {
  const props = shape.props, width = connectionWidth(props)
  let path, contacts = null, terminals = null, heads = [], label = null
  if (shape.type === 'line') path = linePath(props)
  else {
    const reader = connectionContext(context), start = boundTerminal(shape, 'start', reader), end = boundTerminal(shape, 'end', reader)
    terminals = { start: start.point, end: end.point }
    const full = props.kind === 'elbow'
      ? boundElbowPath(start, end, props)
      : arcPath(start.point, end.point, props.bend || 0)
    const a = terminalContact(full, 'start', start), b = terminalContact(full, 'end', end)
    contacts = { start: a.point, end: b.point }
    // 2026-11-25 legacy rectangle/ellipse samples: no cap touches the contour;
    // capped, non-exact ends leave 10 + half the two stroke widths (m:13.5).
    const gap = (descriptor, kind) => !descriptor.binding || descriptor.binding.props.isExact || ['none', 'pipe'].includes(kind) ? 0 : m.bindingGap * (props.scale || 1) + (width + connectionWidth(descriptor.target.props)) / 2
    let from = a.distance + gap(start, props.arrowheadStart), to = b.distance - gap(end, props.arrowheadEnd)
    if (from > to) { const middle = (a.distance + b.distance) / 2; from = middle; to = middle }
    path = from === 0 && to === full.length ? full : full.slice(from, to)
    const length = Math.min(width * m.headFactor, path.length / 3), points = path.points
    // Legacy bound elbows shorten caps to half the terminal leg (l/xl samples).
    const capLength = start => props.kind === 'elbow' && points.length > 1 ? Math.min(length, distance(points[start ? 0 : points.length - 1], points[start ? 1 : points.length - 2]) / 2) : length
    heads = [arrowHead(props.arrowheadStart, path.at(0), path.tangent(0), capLength(true)), arrowHead(props.arrowheadEnd, path.at(1), mul(path.tangent(1), -1), capLength(false))].filter(Boolean)
    label = connectionLabel(props, path)
  }
  const bounds = pointBounds([...path.points, ...heads.flatMap(h => h.points), ...(label ? corners(label.bounds) : [])])
  return { type: shape.type, path, width, contacts, terminals, heads, label, bounds,
    contour: { outline: [...path.points, ...heads.flatMap(h => h.points), ...(label ? corners(label.bounds) : [])], decorations: [], ellipse: null },
    hit(point, tolerance = 0) {
      if (label && inBox(point, label.bounds, tolerance)) return true
      const margin = Math.max(width / 2, tolerance)
      return [path.points, ...heads.map(h => h.closed ? [...h.points, h.points[0]] : h.points)].some(points => points.some((p, i) => i > 0 && segmentDistance(point, points[i - 1], p) <= margin))
    },
  }
}
