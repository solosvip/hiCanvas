import { CanvasEditError } from '../errors.js'

export function deleteRecords(store, command) {
  if (!Array.isArray(command.ids) || command.ids.some(id => typeof id !== 'string' || !store.scopedTypes.document.has(store.get(id)?.typeName))) throw new CanvasEditError('要删除的画板记录不存在。')
  const ids = new Set(command.ids)
  const records = store.allRecords()
  let expanded = true
  while (expanded) {
    expanded = false
    for (const record of records) {
      if (!ids.has(record.id) && (ids.has(record.parentId) || (record.typeName === 'binding' && (ids.has(record.fromId) || ids.has(record.toId))))) {
        ids.add(record.id)
        expanded = true
      }
    }
  }
  store.remove([...ids])
}
