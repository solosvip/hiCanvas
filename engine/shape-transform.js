import { isEqual } from '@tldraw/utils'
import { shapeToPagePoint } from '../renderer/geometry.js'
import { CanvasEditError } from './errors.js'
import { layoutContext } from './layout-context.js'
import { pageDeltaToParentDelta } from './shape-coordinates.js'

export const fullTurn = Math.PI * 2
export function normalizeAngle(angle) {
  const remainder = angle % fullTurn
  const value = remainder < 0 ? remainder + fullTurn : remainder
  return value === fullTurn ? 0 : value
}

export function checkedPoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new CanvasEditError('变换原点需要有限的画布坐标。')
  return point
}

// 组没有自己的尺寸，整体旋转缩放的规则留给 #75：先把组整体跳过，组和子孙同选时子孙也不单独改；
// 组内形状单独选中时照常变换。
export function transformTargets(store, ids) {
  const { records, items } = layoutContext(store, ids, shape => shape.type !== 'group')
  return { snapshot: { store: records }, shapes: items.map(item => item.shape) }
}

export function placeShapeAtPagePoint(snapshot, shape, point) {
  const previous = shapeToPagePoint(snapshot, shape.id, { x: 0, y: 0 })
  const delta = pageDeltaToParentDelta(snapshot.store, shape.parentId, { x: point.x - previous.x, y: point.y - previous.y })
  return { ...shape, x: shape.x + delta.x, y: shape.y + delta.y }
}

export function putTransformedShapes(store, updates) {
  const changed = updates.filter(shape => !isEqual(store.get(shape.id), shape))
  store.put(changed)
  return { shapeIds: changed.map(shape => shape.id) }
}
