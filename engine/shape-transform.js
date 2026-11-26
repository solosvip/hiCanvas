import { isEqual } from '@tldraw/utils'
import { getShapePageBounds, shapeToPagePoint } from '../renderer/geometry.js'
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

export function transformTargets(store, ids, { expandGroups = false, includeGroupFrameContents = false } = {}) {
  const context = layoutContext(store, ids), { records, items } = context
  const snapshot = { store: records }, roots = items.map(item => item.shape)
  if (!expandGroups) return { snapshot, shapes: roots, context }
  const children = new Map()
  for (const shape of Object.values(records)) if (shape.typeName === 'shape') {
    if (!children.has(shape.parentId)) children.set(shape.parentId, [])
    children.get(shape.parentId).push(shape)
  }
  const pending = [...roots].reverse().map(shape => ({ shape, insideGroup: false })), expanded = [], visited = new Set()
  while (pending.length) {
    const { shape, insideGroup } = pending.pop()
    if (visited.has(shape.id)) continue
    visited.add(shape.id)
    // 锁定与父子同选在顶层目标筛选；已选父容器的内部记录随整体变换，
    // 与移动/旋转父容器相同。缩放在画框处停止；组镜像须继续反射框内内容。
    if (shape.type === 'group' || (insideGroup && includeGroupFrameContents)) {
      pending.push(...[...(children.get(shape.id) || [])].reverse().map(child => ({ shape: child, insideGroup: true })))
    }
    if (shape.type !== 'group') {
      const bounds = getShapePageBounds(snapshot, shape.id)
      if (bounds && [bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) && bounds.w > 0 && bounds.h > 0) expanded.push({ shape, bounds })
    }
  }
  return { snapshot, shapes: expanded.map(item => item.shape), context: { ...context, items: expanded } }
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
