import { CanvasEditError } from '../errors.js'
import { getTargetShapes } from '../shape-targets.js'
import { reparentChildren } from '../reparent-children.js'
import { unlockedShapes } from '../container-geometry.js'
import { updateRecord } from './update.js'
import { deleteRecords } from './delete.js'
import { restoreGrouping } from '../group-provenance.js'

export function ungroupShape(store, group) {
  const records = store.allRecords(), moved = reparentChildren(records, group)
  const outside = new Set(records.filter(record => record.typeName === 'shape' && record.parentId === group.parentId && record.id !== group.id).map(record => record.index))
  const originalIndices = moved.map(({ id }) => store.get(id).index)
  const { preserveIndices, positions } = restoreGrouping(group, moved.map(({ id }) => store.get(id)))
  // 同父组合沿用原索引；没有碰撞时解组逐值还原，不扰动未参与的同级记录。
  const preserve = preserveIndices && new Set(originalIndices).size === originalIndices.length && originalIndices.every(index => !outside.has(index))
  for (const change of moved) updateRecord(store, { ...change, changes: { ...change.changes, ...positions.get(change.id), ...(preserve && { index: store.get(change.id).index }) } })
  deleteRecords(store, { ids: [group.id] })
}

export function ungroupShapes(store, { ids }) {
  const groups = unlockedShapes(store, getTargetShapes(store, ids))
  if (groups.some(group => group.type !== 'group')) throw new CanvasEditError('解组需要有效的组 ID 列表。')
  for (const group of groups) if (store.has(group.id)) ungroupShape(store, store.get(group.id))
}
