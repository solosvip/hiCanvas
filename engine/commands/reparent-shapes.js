import { getIndicesAbove } from '@tldraw/utils'
import { CanvasEditError } from '../errors.js'
import { getTargetShapes } from '../shape-targets.js'
import { getShapeAncestors } from '../shape-coordinates.js'
import { reparentPose } from '../container-geometry.js'
import { updateRecord } from './update.js'

// UI previews and host/MCP commits use this same validated operation. Capture
// only the involved ancestry; sibling lookup uses the MIT Store's parent index.
export function reparentShapes(store, { ids, parentId }) {
  const shapes = getTargetShapes(store, ids), records = Object.create(null)
  function capture(id) {
    const seen = new Set()
    for (let record = store.get(id); record; record = record.typeName === 'shape' ? store.get(record.parentId) : null) {
      if (seen.has(record.id)) throw new CanvasEditError('形状的父子关系形成循环。')
      seen.add(record.id); records[record.id] = record
    }
  }
  capture(parentId); shapes.forEach(shape => capture(shape.id))
  const parent = records[parentId]
  if (parent?.typeName !== 'page' && !(parent?.typeName === 'shape' && parent.type === 'frame')) throw new CanvasEditError('目标父级必须是有效画布或画框。')
  const chain = parent.typeName === 'shape' ? [parent, ...getShapeAncestors(records, parent.parentId)] : []
  if (chain.some(record => record.isLocked)) throw new CanvasEditError('锁定的画框不能接收形状。')
  const selected = new Set(shapes.map(shape => shape.id))
  const roots = shapes.filter(shape => !getShapeAncestors(records, shape.parentId).some(record => selected.has(record.id)))
  for (const shape of roots) {
    if (shape.id === parentId || chain.some(record => record.id === shape.id)) throw new CanvasEditError('形状的父子关系形成循环。')
    if (shape.isLocked || getShapeAncestors(records, shape.parentId).some(record => record.isLocked)) throw new CanvasEditError('锁定的形状不能换父级。')
  }
  const paths = new Map(roots.map(shape => [shape.id, [shape, ...getShapeAncestors(records, shape.parentId)].reverse()]))
  const moved = roots.filter(shape => shape.parentId !== parentId).sort((a, b) => {
    const left = paths.get(a.id), right = paths.get(b.id)
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      if (left[i].id === right[i].id) continue
      return left[i].index < right[i].index ? -1 : left[i].index > right[i].index ? 1 : left[i].id.localeCompare(right[i].id)
    }
    return left.length - right.length
  })
  if (!moved.length) return { shapeIds: [] }
  const siblings = store.query.records('shape', () => ({ parentId: { eq: parentId } })).get()
  const indices = getIndicesAbove(siblings.map(record => record.index).sort().at(-1), moved.length)
  for (const [i, shape] of moved.entries()) updateRecord(store, { id: shape.id, changes: { parentId, index: indices[i], ...reparentPose({ store: records }, shape, parentId) } })
  return { shapeIds: moved.map(shape => shape.id) }
}
