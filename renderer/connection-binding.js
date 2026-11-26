import { getShapeBounds, getShapeContour } from './bounds.js'
import { fromPage, toPage } from './connection-records.js'
import { sub, lerp, distance, pointBounds } from './connection-path.js'

function targetOutline(context, target, visiting = new Set()) {
  if (visiting.has(target.id)) return null
  visiting.add(target.id)
  const contour = getShapeContour(target)
  if (contour?.outline?.length) return { bounds: getShapeBounds(target), points: contour.outline }
  if (target.type !== 'group') return null
  const points = context.childIds(target.id).flatMap(id => {
    const child = context.getRecord(id), outline = child && targetOutline(context, child, visiting)
    return outline ? outline.points.map(p => fromPage(context, target, toPage(context, child, p))) : []
  })
  if (!points.length) return null
  const b = pointBounds(points)
  return { bounds: b, points: [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }] }
}

// Editing normalizes anchors against exactly the same local box as drawing,
// including groups whose box is derived from their descendants.
export function getConnectionTargetBounds(target, context) { return targetOutline(context, target)?.bounds || null }

export function boundTerminal(shape, terminal, context) {
  const binding = context.bindingsFrom(shape.id).find(b => b.props.terminal === terminal)
  const target = binding && context.getRecord(binding.toId)
  if (!target || target.id === shape.id) return { point: { ...shape.props[terminal] } }
  const outline = targetOutline(context, target)
  if (!outline?.bounds) return { point: { ...shape.props[terminal] } }
  const b = outline.bounds, anchor = binding.props.isPrecise ? binding.props.normalizedAnchor : { x: .5, y: .5 }
  const local = { x: b.x + b.w * anchor.x, y: b.y + b.h * anchor.y }
  const convert = p => fromPage(context, shape, toPage(context, target, p))
  const polygon = outline.points.map(convert), point = convert(local)
  const distances = [anchor.x * b.w, anchor.y * b.h, (1 - anchor.x) * b.w, (1 - anchor.y) * b.h]
  const edge = distances.indexOf(Math.min(...distances)), normals = [{ x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }]
  const normal = sub(convert({ x: local.x + normals[edge].x, y: local.y + normals[edge].y }), point)
  return { point, binding, target, polygon, bounds: pointBounds(polygon), normal: binding.props.isPrecise && (anchor.x !== .5 || anchor.y !== .5) ? cardinalDirection({ x: 0, y: 0 }, normal) : null }
}

const cross = (a, b) => a.x * b.y - a.y * b.x
function intersection(a, b, c, d) {
  const ab = sub(b, a), cd = sub(d, c), det = cross(ab, cd)
  if (Math.abs(det) < 1e-12) return null
  const relative = sub(c, a), t = cross(relative, cd) / det, u = cross(relative, ab) / det
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? Math.max(0, Math.min(1, t)) : null
}

// Intersect the actual route with the target contour. The shared contour's
// ellipse tolerance is <=.1; route subdivision is <=.025 canvas units.
export function terminalContact(path, terminal, descriptor) {
  const start = terminal === 'start', fallback = start ? 0 : path.length
  if (!descriptor.binding || descriptor.binding.props.isExact) return { point: path.at(start ? 0 : 1), distance: fallback }
  const contacts = []
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i]
    for (let j = 0; j < descriptor.polygon.length; j++) {
      const t = intersection(a, b, descriptor.polygon[j], descriptor.polygon[(j + 1) % descriptor.polygon.length])
      if (t !== null) contacts.push({ point: lerp(a, b, t), distance: path.lengths[i - 1] + distance(a, b) * t })
    }
  }
  contacts.sort((a, b) => a.distance - b.distance)
  return (start ? contacts[0] : contacts.at(-1)) || { point: { ...descriptor.point }, distance: fallback }
}

export function cardinalDirection(a, b) {
  const d = sub(b, a)
  return Math.abs(d.x) >= Math.abs(d.y) ? { x: Math.sign(d.x) || 1, y: 0 } : { x: 0, y: Math.sign(d.y) || 1 }
}
