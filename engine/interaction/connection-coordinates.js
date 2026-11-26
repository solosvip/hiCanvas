import { shapeToPagePoint, pageToShapePoint } from '../../renderer/geometry.js'

export const clamp = value => Math.max(0, Math.min(1, value))
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
export const linePoints = shape => Object.values(shape.props.points).sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : 0)
// Only capture the ancestry needed for coordinate transforms and conflict
// detection. No pointer-move path enumerates the board.
export function connectionCoordinates(index, id) {
  const store = Object.create(null), expected = new Map()
  for (let record = index.getRecord(id); record?.typeName === 'shape'; record = index.getRecord(record.parentId)) {
    store[record.id] = record; expected.set(record.id, JSON.stringify(record))
  }
  return { page: point => shapeToPagePoint({ store }, id, point), local: point => pageToShapePoint({ store }, id, point),
    parentsMatch: () => [...expected].every(([key, value]) => key === id || JSON.stringify(index.getRecord(key)) === value) }
}
// Native legacy Shift drag (250,400)->(550,450), 2026-11-26:
// (293.7748711599246,78.71673948385883), preserving length at 15 degrees.
export function constrainConnectionPoint(origin, point, shift) {
  if (!shift) return point
  const length = distance(origin, point), angle = Math.round(Math.atan2(point.y - origin.y, point.x - origin.x) / (Math.PI / 12)) * Math.PI / 12
  return { x: origin.x + length * Math.cos(angle), y: origin.y + length * Math.sin(angle) }
}
export function projectPath(path, point) {
  let best = { distance: Infinity, position: 0, point: path.points[0] }
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], dx = b.x - a.x, dy = b.y - a.y
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1))
    const projected = { x: a.x + t * dx, y: a.y + t * dy }, gap = distance(point, projected)
    if (gap < best.distance) best = { distance: gap, point: projected, position: path.length ? (path.lengths[i - 1] + t * distance(a, b)) / path.length : .5 }
  }
  return best
}
