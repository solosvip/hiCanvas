import { CanvasEditError } from '../errors.js'
import { createConnectionContext, getConnectionGeometry } from '../../renderer/geometry.js'

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
  // 2026-11-26 synthetic native legacy: deleting a moved binding target
  // removes its binding but keeps the visible arrow tip, not its stale stored
  // terminal. Include this update in the same transaction so undo restores all.
  const removedBindings = records.filter(record => record.typeName === 'binding' && record.type === 'arrow' && ids.has(record.toId) && !ids.has(record.fromId))
  const context = removedBindings.length && createConnectionContext(records), updates = new Map()
  for (const record of removedBindings) {
    const arrow = updates.get(record.fromId) || store.get(record.fromId)
    if (arrow?.type !== 'arrow') continue
    const original = store.get(record.fromId), terminal = record.props.terminal
    // The arrow's own label does not affect terminals. Omit its unrelated
    // layout; text/note TARGETS still require the host's normal font preparation
    // because their real contour determines the visible connection tip.
    const geometry = getConnectionGeometry({ ...original, props: { ...original.props, richText: { type: 'doc', content: [{ type: 'paragraph' }] } } }, context)
    updates.set(arrow.id, { ...arrow, props: { ...arrow.props, [terminal]: geometry.path.at(terminal === 'start' ? 0 : 1) } })
  }
  if (updates.size) store.put([...updates.values()])
  store.remove([...ids])
}
