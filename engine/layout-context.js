import { isEqual } from '@tldraw/utils'
import { getShapePageBounds } from '../renderer/geometry.js'
import { getTargetShapes } from './shape-targets.js'
import { getShapeAncestors, pageDeltaToParentDelta } from './shape-coordinates.js'

export const LAYOUT_EPSILON = 1e-9

// 共用目标校验与父链查询；交互式排版额外排除锁定、被选祖先下的形状。
export function layoutContext(store, ids, eligible = () => true) {
  const shapes = getTargetShapes(store, ids)
  const records = Object.fromEntries(store.allRecords().map(record => [record.id, record]))
  const selected = new Set(shapes.map(shape => shape.id))
  const items = []
  for (const shape of shapes) {
    const ancestors = getShapeAncestors(records, shape.parentId)
    if (shape.isLocked || ancestors.some(parent => parent.isLocked || selected.has(parent.id)) || !eligible(shape)) continue
    const bounds = getShapePageBounds({ store: records }, shape.id)
    if (bounds && [bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) && bounds.w > 0 && bounds.h > 0) items.push({ shape, bounds })
  }
  const left = Math.min(...items.map(item => item.bounds.x)), top = Math.min(...items.map(item => item.bounds.y))
  const right = Math.max(...items.map(item => item.bounds.x + item.bounds.w)), bottom = Math.max(...items.map(item => item.bounds.y + item.bounds.h))
  return { store, records, items, bounds: { x: left, y: top, w: right - left, h: bottom - top }, updates: [] }
}

// 移动量在画布上计算，写回时只经过既有的父容器坐标换算。
export function placeLayoutShape(context, item, x, y, replacement = item.shape) {
  const records = replacement === item.shape ? context.records : { ...context.records, [replacement.id]: replacement }
  const current = replacement === item.shape ? item.bounds : getShapePageBounds({ store: records }, replacement.id)
  const dx = x - current.x, dy = y - current.y
  const delta = pageDeltaToParentDelta(context.records, item.shape.parentId, { x: Math.abs(dx) < LAYOUT_EPSILON ? 0 : dx, y: Math.abs(dy) < LAYOUT_EPSILON ? 0 : dy })
  const next = { ...replacement, x: replacement.x + delta.x, y: replacement.y + delta.y }
  if (!isEqual(item.shape, next)) context.updates.push(next)
}

export function finishLayout(context) {
  if (context.updates.length) context.store.put(context.updates)
  return { shapeIds: context.updates.map(shape => shape.id) }
}

export function orderedLayoutItems(context, axis) {
  return [...context.items].sort((a, b) => a.bounds[axis] - b.bounds[axis] || a.shape.id.localeCompare(b.shape.id))
}
