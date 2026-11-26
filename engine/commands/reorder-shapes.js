import { getIndicesBetween, sortByIndex } from '@tldraw/utils'
import { CanvasEditError } from '../errors.js'
import { getTargetShapes } from '../shape-targets.js'
import { snapshotOf } from '../container-geometry.js'
import { getShapePageBounds } from '../../renderer/geometry.js'

function reordered(siblings, targets, operation) {
  const listed = siblings.filter(shape => targets.has(shape.id))
  const others = siblings.filter(shape => !targets.has(shape.id))
  if (operation === 'front') return [...others, ...listed]
  if (operation === 'back') return [...listed, ...others]
  const result = [...siblings]
  // 从移动方向的边界向回扫描：连续的一组越过同一个邻居，每个目标只越过一个未列出的形状。
  const step = operation === 'forward' ? -1 : 1
  for (let i = step < 0 ? result.length - 2 : 1; i >= 0 && i < result.length; i += step) {
    const neighbor = i - step
    if (targets.has(result[i].id) && !targets.has(result[neighbor].id)) [result[i], result[neighbor]] = [result[neighbor], result[i]]
  }
  return result
}

function assignIndices(siblings, targets) {
  const updates = []
  for (let i = 0; i < siblings.length; i++) {
    if (!targets.has(siblings[i].id)) continue
    const start = i
    while (i + 1 < siblings.length && targets.has(siblings[i + 1].id)) i++
    const block = siblings.slice(start, i + 1)
    const below = siblings[start - 1]?.index
    const above = siblings[i + 1]?.index
    if (block.every((shape, offset) => (!below || shape.index > below) && (!above || shape.index < above) && (!offset || shape.index > block[offset - 1].index))) continue
    const indices = getIndicesBetween(below, above, block.length)
    for (const [offset, shape] of block.entries()) {
      if (shape.index !== indices[offset]) updates.push({ ...shape, index: indices[offset] })
    }
  }
  return updates
}

function overlappingOrder(siblings, targets, operation, snapshot) {
  const bounds = new Map(siblings.map(shape => [shape.id, getShapePageBounds(snapshot, shape.id)]))
  const selectedBounds = siblings.filter(shape => targets.has(shape.id)).map(shape => bounds.get(shape.id))
  const overlapsSelection = shape => {
    const box = bounds.get(shape.id)
    return box && selectedBounds.some(selected => selected && box.x <= selected.x + selected.w && box.x + box.w >= selected.x && box.y <= selected.y + selected.h && box.y + box.h >= selected.y)
  }
  const result = [...siblings], direction = operation === 'forward' ? 1 : -1
  // 旧版原生多选观察：阻挡可以碰到任一选中形状（不是选择外框的空隙）；
  // 从移动方向的边界回扫，已选形状不互相越过，边缘接触也算阻挡。
  for (let i = direction > 0 ? result.length - 1 : 0; i >= 0 && i < result.length; i -= direction) {
    if (!targets.has(result[i].id)) continue
    for (let j = i + direction; j >= 0 && j < result.length; j += direction) {
      if (targets.has(result[j].id)) break
      if (!overlapsSelection(result[j])) continue
      result.splice(j, 0, result.splice(i, 1)[0])
      break
    }
  }
  return result
}

export function reorderShapes(store, { ids, operation, mode = 'adjacent' }) {
  if (!['front', 'forward', 'backward', 'back'].includes(operation)) throw new CanvasEditError('层级操作必须是 front、forward、backward 或 back。')
  if (!['adjacent', 'overlapping'].includes(mode)) throw new CanvasEditError('层级模式必须是 adjacent 或 overlapping。')
  const shapes = getTargetShapes(store, ids)
  const targets = new Set(shapes.map(shape => shape.id))
  const parents = new Set(shapes.map(shape => shape.parentId))
  const groups = new Map([...parents].map(parentId => [parentId, []]))
  for (const record of store.allRecords()) {
    if (record.typeName === 'shape' && groups.has(record.parentId)) groups.get(record.parentId).push(record)
  }
  const snapshot = mode === 'overlapping' ? snapshotOf(store) : undefined
  for (const siblings of groups.values()) {
    siblings.sort(sortByIndex)
    if (new Set(siblings.map(shape => shape.index)).size !== siblings.length) throw new CanvasEditError('同级形状的层级索引重复，无法确定前后顺序。')
    const ordered = mode === 'overlapping' && ['forward', 'backward'].includes(operation) ? overlappingOrder(siblings, targets, operation, snapshot) : reordered(siblings, targets, operation)
    store.put(assignIndices(ordered, targets))
  }
}
