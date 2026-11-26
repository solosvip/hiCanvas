// Read-only geometry context with incremental relationship indexes. Records are
// immutable inputs; applying a change replaces references, never edits records.
export function createConnectionContext(initial = []) {
  const records = new Map(), children = new Map(), outgoing = new Map(), incoming = new Map()
  const link = (map, key, id, add) => {
    if (add) { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(id) }
    else { const ids = map.get(key); ids?.delete(id); if (!ids?.size) map.delete(key) }
  }
  function links(record, add) {
    if (record.typeName === 'shape') link(children, record.parentId, record.id, add)
    if (record.typeName === 'binding' && record.type === 'arrow') {
      link(outgoing, record.fromId, record.id, add); link(incoming, record.toId, record.id, add)
    }
  }
  const getRecords = (map, id) => [...(map.get(id) || [])].map(key => records.get(key)).filter(Boolean)
  function applyChanges(changes) {
    for (const record of [...Object.values(changes.removed || {}), ...Object.values(changes.updated || {}).map(pair => pair[0])]) { links(record, false); records.delete(record.id) }
    for (const record of [...Object.values(changes.added || {}), ...Object.values(changes.updated || {}).map(pair => pair[1])]) { records.set(record.id, record); links(record, true) }
  }
  for (const record of Array.isArray(initial) ? initial : Object.values(initial.store || initial)) { records.set(record.id, record); links(record, true) }
  return Object.freeze({ getRecord: id => records.get(id), childIds: id => [...(children.get(id) || [])], bindingsFrom: id => getRecords(outgoing, id), bindingsTo: id => getRecords(incoming, id), applyChanges })
}

export const connectionContext = value => value?.getRecord ? value : createConnectionContext(value || [])

// Public dependency query, shared by drawing and later spatial indexing (#87).
// Accept a snapshot or an indexed read context; return each arrow only once.
export function getBoundArrowIds(context, record) {
  const reader = connectionContext(context), root = typeof record === 'string' ? record : record?.id
  const pending = [root], seen = new Set(), result = new Set()
  for (const id of pending) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    for (const binding of reader.bindingsTo(id)) result.add(binding.fromId)
    pending.push(...reader.childIds(id))
  }
  // A group's contour is the union of its descendants. A child edit also
  // changes arrows bound to that group, but not arrows bound to its siblings.
  for (const ancestor of recordChain(reader, typeof record === 'string' ? reader.getRecord(record) : record).slice(1)) {
    if (ancestor.type === 'group') for (const binding of reader.bindingsTo(ancestor.id)) result.add(binding.fromId)
  }
  return [...result]
}

export function recordChain(context, record) {
  const result = [], seen = new Set()
  for (let r = typeof record === 'string' ? context.getRecord(record) : record; r?.typeName === 'shape'; r = context.getRecord(r.parentId)) {
    if (seen.has(r.id)) throw new Error('连接线的父子关系存在环。')
    seen.add(r.id); result.push(r)
  }
  return result
}
export function toPage(context, record, point) {
  return recordChain(context, record).reduce((p, r) => {
    const c = Math.cos(r.rotation || 0), s = Math.sin(r.rotation || 0)
    return { x: r.x + p.x * c - p.y * s, y: r.y + p.x * s + p.y * c }
  }, point)
}
export function fromPage(context, record, point) {
  return recordChain(context, record).reverse().reduce((p, r) => {
    const dx = p.x - r.x, dy = p.y - r.y, c = Math.cos(r.rotation || 0), s = Math.sin(r.rotation || 0)
    return { x: dx * c + dy * s, y: -dx * s + dy * c }
  }, point)
}
