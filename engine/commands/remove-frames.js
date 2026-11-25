import { CanvasEditError } from '../errors.js'
import { reparentChildren } from '../reparent-children.js'
import { updateRecord } from './update.js'
import { deleteRecords } from './delete.js'

export function removeFrames(store, { ids }) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || store.get(id)?.typeName !== 'shape' || store.get(id).type !== 'frame')) throw new CanvasEditError('移除画框需要有效的画框 ID 列表。')
  for (const id of new Set(ids)) {
    const frame = store.get(id)
    for (const change of reparentChildren(store.allRecords(), frame)) updateRecord(store, change)
    deleteRecords(store, { ids: [id] })
  }
}
