import { getShapePageBounds, shapeToPagePoint, pageToShapePoint } from '../renderer/geometry.js'
import { getShapeAncestors } from './shape-coordinates.js'
import { CanvasEditError } from './errors.js'

export const snapshotOf = store => ({ store: Object.fromEntries(store.allRecords().map(record => [record.id, record])) })

export function contentBounds(snapshot, ids, parentId) {
  const parent = snapshot.store[parentId]
  // 在父容器坐标系里测量，避免逆转画布 AABB 时把旋转内容的外框扩大。
  const local = parent.typeName === 'page' ? snapshot : { store: { ...snapshot.store, [parentId]: { ...parent, x: 0, y: 0, rotation: 0, parentId: getShapeAncestors(snapshot.store, parentId).at(-1)?.parentId } } }
  const bounds = ids.map(id => getShapePageBounds(local, id))
  if (bounds.some(box => !box || ![box.x, box.y, box.w, box.h].every(Number.isFinite))) throw new CanvasEditError('形状范围无效或当前尚不支持。')
  const x = Math.min(...bounds.map(box => box.x)), y = Math.min(...bounds.map(box => box.y))
  return { x, y, w: Math.max(...bounds.map(box => box.x + box.w)) - x, h: Math.max(...bounds.map(box => box.y + box.h)) - y }
}

export function reparentPose(snapshot, shape, parentId) {
  const parent = snapshot.store[parentId]
  if (parent?.typeName === 'shape' && parent.parentId === shape.parentId && parent.rotation === 0) return { x: shape.x - parent.x, y: shape.y - parent.y, rotation: shape.rotation }
  const point = pageToShapePoint(snapshot, parentId, shapeToPagePoint(snapshot, shape.id, { x: 0, y: 0 }))
  const rotation = shape.rotation + getShapeAncestors(snapshot.store, shape.parentId).reduce((sum, record) => sum + record.rotation, 0) - getShapeAncestors(snapshot.store, parentId).reduce((sum, record) => sum + record.rotation, 0)
  return { ...point, rotation }
}

export function unlockedShapes(store, shapes) {
  const snapshot = snapshotOf(store)
  return shapes.filter(shape => !shape.isLocked && !getShapeAncestors(snapshot.store, shape.parentId).some(parent => parent.isLocked))
}
