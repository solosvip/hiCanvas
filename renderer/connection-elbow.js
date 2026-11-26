import { cardinalDirection } from './connection-binding.js'
import { elbowPath, polyline } from './connection-path.js'
import { ELBOW_ESCAPE, connectionWidth, CONNECTION_METRICS as m } from './connection-metrics.js'

const route = points => polyline(points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y))
function escapePoint(descriptor, direction, clearance) {
  const p = { ...descriptor.point }, b = descriptor.bounds
  if (direction.x) p.x = direction.x > 0 ? b.x + b.w + clearance : b.x - clearance
  else p.y = direction.y > 0 ? b.y + b.h + clearance : b.y - clearance
  return p
}

export function boundElbowPath(start, end, props) {
  const mid = props.elbowMidPoint ?? .5
  if (!start.binding && !end.binding) return elbowPath(start.point, end.point, mid, connectionWidth(props) * m.elbowClearance)
  // A precise near-edge anchor selects its outward axis. Imprecise center
  // anchors face the other terminal. snap records the editing gesture's mode;
  // legacy none/center/edge/edge-point records paint the stored anchor alike.
  const sn = start.normal || cardinalDirection(start.point, end.point), en = end.normal || cardinalDirection(end.point, start.point)
  const clearance = (ELBOW_ESCAPE[props.size] || ELBOW_ESCAPE.m) * (props.scale || 1)
  const a = start.binding ? escapePoint(start, sn, clearance) : start.point
  const b = end.binding ? escapePoint(end, en, clearance) : end.point
  if (!start.binding) return route([start.point, en.x ? { x: b.x, y: start.point.y } : { x: start.point.x, y: b.y }, b, end.point])
  if (!end.binding) return route([start.point, a, sn.x ? { x: a.x, y: end.point.y } : { x: end.point.x, y: a.y }, end.point])
  if (!!sn.x !== !!en.x) return route([start.point, a, sn.x ? { x: b.x, y: a.y } : { x: a.x, y: b.y }, b, end.point])
  const axis = sn.x ? 'x' : 'y', across = axis === 'x' ? 'y' : 'x'
  const common = sn[axis] === en[axis] ? (sn[axis] > 0 ? Math.max(a[axis], b[axis]) : Math.min(a[axis], b[axis])) : a[axis] + (b[axis] - a[axis]) * mid
  return route([start.point, a, { [axis]: common, [across]: a[across] }, { [axis]: common, [across]: b[across] }, b, end.point])
}
