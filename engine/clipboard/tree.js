import { sortByIndex } from '@tldraw/utils'
import { CanvasEditError } from '../errors.js'
import { createConnectionContext, getConnectionGeometry } from '../../renderer/geometry.js'

export function copyAncestors(store, record) {
  const result = [], visited = new Set([record.id])
  for (let parent = store.get(record.parentId); parent?.typeName === 'shape'; parent = store.get(parent.parentId)) {
    if (visited.has(parent.id)) throw new CanvasEditError('形状的父子关系形成循环。')
    visited.add(parent.id); result.push(parent)
  }
  return result
}

// Shared by Mod+D and clipboard extraction: roots/descendants and detached
// arrow tips must have one definition. This does not assign IDs or write.
export function collectCopyTree(store, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || store.get(id)?.typeName !== 'shape')) throw new CanvasEditError('复制需要有效的形状 ID 列表。')
  const records = store.allRecords(), selected = new Set(ids), children = new Map()
  const roots = [...selected].map(id => store.get(id)).filter(r => !copyAncestors(store, r).some(parent => selected.has(parent.id))).sort(sortByIndex)
  for (const record of records) {
    if (record.typeName !== 'shape') continue
    if (!children.has(record.parentId)) children.set(record.parentId, [])
    children.get(record.parentId).push(record)
  }
  const originals = [...roots], included = new Set(roots.map(r => r.id))
  for (const record of originals) for (const child of children.get(record.id) || []) {
    if (!included.has(child.id)) { included.add(child.id); originals.push(child) }
  }
  const bindings = records.filter(r => r.typeName === 'binding' && included.has(r.fromId) && included.has(r.toId))
  const detached = records.filter(r => r.typeName === 'binding' && r.type === 'arrow' && included.has(r.fromId) && !included.has(r.toId))
  const geometry = detached.length && createConnectionContext(records), props = new Map()
  for (const binding of detached) {
    const arrow = store.get(binding.fromId)
    if (arrow?.type !== 'arrow') continue
    // Legacy native Mod+D and synthetic clipboard observations both freeze
    // detached visible tips: stored end=250 becomes visible end=236.5.
    const path = getConnectionGeometry({ ...arrow, props: { ...arrow.props, richText: { type: 'doc', content: [{ type: 'paragraph' }] } } }, geometry).path
    props.set(arrow.id, { ...(props.get(arrow.id) || arrow.props), [binding.props.terminal]: path.at(binding.props.terminal === 'start' ? 0 : 1) })
  }
  return { roots, originals, bindings, props, children }
}
