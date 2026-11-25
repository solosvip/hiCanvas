import { CanvasEditError } from '../errors.js'
import { getTargetShapes } from '../shape-targets.js'
import { getShapeAncestors, pageDeltaToParentDelta } from '../shape-coordinates.js'

export function nudgeShapes(store, { ids, delta }) {
  if (!delta || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new CanvasEditError('画布位移需要有限的 x、y 数值。')
  const shapes = getTargetShapes(store, ids)
  if (delta.x === 0 && delta.y === 0) return
  const records = Object.fromEntries(store.allRecords().map(record => [record.id, record]))
  const targets = new Set(shapes.map(shape => shape.id))
  const updates = []
  for (const shape of shapes) {
    if (getShapeAncestors(records, shape.parentId).some(parent => targets.has(parent.id))) continue
    const local = pageDeltaToParentDelta(records, shape.parentId, delta)
    updates.push({ ...shape, x: shape.x + local.x, y: shape.y + local.y })
  }
  store.put(updates)
}
