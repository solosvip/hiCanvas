import { getConnectionGeometry, getShapeContour } from '../../renderer/geometry.js'
import { clamp, connectionCoordinates, distance, linePoints } from './connection-coordinates.js'

function appendPath(candidates, page, outline, closed, visible) {
  for (const target of outline) if (visible(target)) candidates.push(target)
  const count = closed ? outline.length : outline.length - 1
  for (let i = 0; i < count; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length], dx = b.x - a.x, dy = b.y - a.y
    const t = clamp(((page.x - a.x) * dx + (page.y - a.y) * dy) / (dx * dx + dy * dy || 1))
    const target = { x: a.x + dx * t, y: a.y + dy * t }
    if (visible(target)) candidates.push(target)
  }
}

// C23 native positive: a three-point line's last point snaps to its FIRST
// (non-neighbour) vertex; two-point adjacent vertices did not snap. Legacy
// samples at (7,3) snapped to that vertex; (8,3) snapped to its segment.
// Use an 8 CSS px radius within that observed 7.62–8.54 interval.
// This is a local control-point policy, not the #128 global snapping system.
export function snapConnectionPoint(context, shape, point, excluded, input, movingId = null) {
  if (context.controlPointSnapping === Boolean(input.ctrlKey)) return { point, indicator: null }
  const radius = 8 / context.read().camera.z
  const coordinates = connectionCoordinates(context.index, shape.id), page = coordinates.page(point)
  const own = shape.type === 'line' ? linePoints(shape) : []
  const candidates = [], vertices = own.filter(p => !excluded.includes(p.id)).map(p => coordinates.page(p)).filter(point => context.index.isPointVisible(shape.id, point))
  if (own.length) {
    const path = getConnectionGeometry(shape, context.targets.records).path.points
    let start = 0
    for (let i = 1; i < own.length; i++) {
      const end = path.findIndex((p, n) => n > start && distance(p, own[i]) < 1e-8)
      if (end < 0) break
      if (movingId ? own[i - 1].id !== movingId && own[i].id !== movingId : !excluded.includes(own[i - 1].id) && !excluded.includes(own[i].id)) appendPath(candidates, page, path.slice(start, end + 1).map(p => coordinates.page(p)), false, point => context.index.isPointVisible(shape.id, point))
      start = end
    }
  }
  for (const id of context.index.query({ x: page.x - radius, y: page.y - radius, w: radius * 2, h: radius * 2 })) {
    if (id === shape.id || !context.targets.isSelectable(id)) continue
    const record = context.index.getRecord(id), transform = connectionCoordinates(context.index, id)
    const connection = ['line', 'arrow'].includes(record.type) && getConnectionGeometry(record, context.targets.records)
    const contour = !connection && getShapeContour(record, context.targets.records)
    const controls = record.type === 'line' ? linePoints(record) : record.type === 'arrow' ? [connection.path.at(0), connection.path.at(1)] : contour?.outline || []
    vertices.push(...controls.map(p => transform.page(p)).filter(p => context.index.isPointVisible(id, p)))
    // The flattened connection outline also contains heads/label corners;
    // joining it would invent chords across an open arc or between its parts.
    const paths = connection ? [{ points: connection.path.points, closed: false }, ...connection.heads] : [
      { points: contour?.outline || [], closed: true }, ...(contour?.decorations || []).map(points => ({ points, closed: false })),
    ]
    for (const path of paths) {
      appendPath(candidates, page, path.points.map(p => transform.page(p)), path.closed, point => context.index.isPointVisible(id, point))
    }
  }
  // Native (7,3) prefers the vertex despite a closer segment; (8,3)
  // projects to that non-incident segment once the vertex is out of range.
  const nearest = values => values.filter(p => distance(p, page) <= radius).sort((a, b) => distance(a, page) - distance(b, page))[0]
  const target = nearest(vertices) || nearest(candidates)
  return target ? { point: coordinates.local(target), indicator: { kind: 'snap', bounds: { x: 0, y: 0, w: 0, h: 0 }, handles: [{ id: 'point', kind: 'vertex', ...target }] } } : { point, indicator: null }
}
