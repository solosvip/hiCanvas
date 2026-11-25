export function checkedCamera(camera = { x: 0, y: 0, z: 1 }) {
  if (![camera.x, camera.y, camera.z].every(Number.isFinite) || camera.z <= 0) throw new Error('相机需要有限坐标和正数缩放。')
  return { x: camera.x, y: camera.y, z: camera.z }
}

export function canvasToScreen(point, camera) {
  const { x, y, z } = checkedCamera(camera)
  return { x: (point.x + x) * z, y: (point.y + y) * z }
}

export function screenToCanvas(point, camera) {
  const { x, y, z } = checkedCamera(camera)
  return { x: point.x / z - x, y: point.y / z - y }
}
import { getShapeBounds, getShapeContour } from './bounds.js'
import { strokeWidth } from './geo-metrics.js'
export { getShapeBounds, getShapeContour } from './bounds.js'


export function orderedChildren(records) {
  const children = new Map()
  for (const record of records) {
    if (record.typeName !== 'shape') continue
    if (!children.has(record.parentId)) children.set(record.parentId, [])
    children.get(record.parentId).push(record)
  }
  for (const list of children.values()) list.sort((a, b) => {
    const left = a.index || '', right = b.index || ''
    return left < right ? -1 : left > right ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return children
}

function toLocal(point, shape) {
  const dx = point.x - shape.x, dy = point.y - shape.y
  const c = Math.cos(shape.rotation || 0), s = Math.sin(shape.rotation || 0)
  return { x: dx * c + dy * s, y: -dx * s + dy * c }
}

function inBox(point, w, h, margin = 0) {
  return point.x >= -margin && point.y >= -margin && point.x <= w + margin && point.y <= h + margin
}

export function pointInShape(shape, point, tolerance = 0) {
  const bounds = getShapeBounds(shape)
  if (!bounds) return false
  const { w, h } = bounds
  if (w <= 0 || h <= 0) return false
  const contour = getShapeContour(shape)
  if (!contour) return false
  const margin = shape.type === 'geo' ? Math.max(strokeWidth(shape.props) / 2, tolerance) : 0
  const edgeHit = (points, closed) => points.some((end, i) => (i || closed) && segmentDistance(point, points[(i + points.length - 1) % points.length], end) <= margin)
  return ((shape.type !== 'geo' || shape.props.fill !== 'none') && pointInPolygon(point, contour.outline))
    || edgeHit(contour.outline, true) || contour.decorations.some(line => edgeHit(line, false))
}

function segmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}

function pointInPolygon(point, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// point is relative to the mounted viewport, in CSS pixels. No DOM, Store,
// React or editor dependency; the input snapshot is never modified.
export function hitTestCanvas(snapshot, point, camera, pageId) {
  const view = checkedCamera(camera)
  const records = Object.values(snapshot.store || {})
  const page = pageId || records.find(r => r.typeName === 'page')?.id
  const children = orderedChildren(records), visited = new Set()
  const visit = (parentId, parentPoint) => {
    for (const shape of [...(children.get(parentId) || [])].reverse()) {
      if (visited.has(shape.id) || shape.opacity === 0) continue
      visited.add(shape.id)
      const local = toLocal(parentPoint, shape), bounds = getShapeBounds(shape)
      if (shape.type === 'frame' && !inBox(local, bounds.w, bounds.h)) continue
      const child = visit(shape.id, local)
      if (child) return child
      if (pointInShape(shape, local, 4 / view.z)) return shape.id
    }
    return null
  }
  return visit(page, screenToCanvas(point, view))
}

function ancestors(snapshot, shapeId) {
  const chain = [], seen = new Set()
  let record = snapshot.store[shapeId]
  while (record?.typeName === 'shape') {
    if (seen.has(record.id)) throw new Error('形状父子关系存在环。')
    seen.add(record.id); chain.push(record); record = snapshot.store[record.parentId]
  }
  return chain
}

export function shapeToPagePoint(snapshot, shapeId, point) {
  return ancestors(snapshot, shapeId).reduce((p, shape) => {
    const c = Math.cos(shape.rotation || 0), s = Math.sin(shape.rotation || 0)
    return { x: shape.x + p.x * c - p.y * s, y: shape.y + p.x * s + p.y * c }
  }, point)
}

export function pageToShapePoint(snapshot, shapeId, point) {
  return ancestors(snapshot, shapeId).reverse().reduce(toLocal, point)
}

export function getShapePageBounds(snapshot, shapeId) {
  if (snapshot.store[shapeId]?.type === 'group') {
    const children = orderedChildren(Object.values(snapshot.store)), pending = [shapeId], seen = new Set(pending), bounds = []
    for (const parentId of pending) for (const child of children.get(parentId) || []) {
      if (seen.has(child.id)) throw new Error('形状父子关系存在环。')
      seen.add(child.id); pending.push(child.id)
      if (child.type !== 'group') { const box = getShapePageBounds(snapshot, child.id); if (box) bounds.push(box) }
    }
    if (!bounds.length) return null
    const x = Math.min(...bounds.map(box => box.x)), y = Math.min(...bounds.map(box => box.y))
    return { x, y, w: Math.max(...bounds.map(box => box.x + box.w)) - x, h: Math.max(...bounds.map(box => box.y + box.h)) - y }
  }
  const shape = snapshot.store[shapeId], bounds = shape && getShapeBounds(shape)
  if (!bounds) return null
  const contour = getShapeContour(shape)
  if (!contour) return null
  if (contour.ellipse) {
    const center = shapeToPagePoint(snapshot, shapeId, { x: bounds.w / 2, y: bounds.h / 2 })
    const angle = ancestors(snapshot, shapeId).reduce((sum, record) => sum + (record.rotation || 0), 0)
    const c = Math.cos(angle), s = Math.sin(angle)
    const rx = Math.hypot(bounds.w / 2 * c, bounds.h / 2 * s), ry = Math.hypot(bounds.w / 2 * s, bounds.h / 2 * c)
    return { x: center.x - rx, y: center.y - ry, w: rx * 2, h: ry * 2 }
  }
  const corners = contour.outline.map(p => shapeToPagePoint(snapshot, shapeId, p))
  const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y))
  return { x, y, w: Math.max(...corners.map(p => p.x)) - x, h: Math.max(...corners.map(p => p.y)) - y }
}
