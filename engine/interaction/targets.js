import { createConnectionContext, getConnectionGeometry } from '../../renderer/geometry.js'

const contains = (a, b) => b && a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const order = (a, b) => compare(a.index || '', b.index || '') || compare(a.id, b.id)

// Geometry reports visible records; editing owns locks, groups and containment.
// Relationships are built once and maintained from the same runtime record diffs.
export function createSelectionTargets(index, pageId, initial = []) {
  const records = createConnectionContext(initial), widths = new Map(), widthCounts = new Map()
  let padding = 0
  function updateWidth(id, record) {
    const old = widths.get(id), connection = record && ['line', 'arrow'].includes(record.type)
    if (!connection && !old || connection && old?.props === record.props) return
    const width = connection ? getConnectionGeometry(record, records).width / 2 : 0
    if (old) { const count = widthCounts.get(old.width) - 1; if (count) widthCounts.set(old.width, count); else widthCounts.delete(old.width) }
    if (connection) { widths.set(id, { props: record.props, width }); widthCounts.set(width, (widthCounts.get(width) || 0) + 1) }
    else widths.delete(id)
    padding = Math.max(0, ...widthCounts.keys())
  }
  for (const record of initial) if (record.typeName === 'shape' && ['line', 'arrow'].includes(record.type)) updateWidth(record.id, record)
  function lineage(id) {
    const result = [], seen = new Set()
    for (let record = index.getRecord(id); record?.typeName === 'shape' && !seen.has(record.id); record = index.getRecord(record.parentId)) { seen.add(record.id); result.push(record) }
    return result
  }
  function isSelectable(id) {
    const chain = lineage(id)
    return Boolean(chain.length && chain.at(-1).parentId === pageId && chain.every(r => !r.isLocked && r.opacity !== 0))
  }
  function validScope(id) { return id !== pageId && index.getRecord(id)?.type === 'group' && isSelectable(id) ? id : pageId }
  function inside(id, scope) { return scope === pageId || lineage(id).some(r => r.parentId === scope) }
  function target(id, scope = pageId) {
    let result = id
    for (const record of lineage(id)) {
      if (record.id === scope) break
      if (record.type === 'group') result = record.id
    }
    return result
  }
  function scopeFor(id, scope) {
    const ancestors = new Set(lineage(id).map(r => r.parentId))
    for (const record of lineage(scope)) if (record.type === 'group' && ancestors.has(record.id)) return record.id
    return pageId
  }
  function children(id) { return records.childIds(id).map(key => index.getRecord(key)).filter(r => r && isSelectable(r.id)).sort(order).map(r => r.id) }
  function roots(ids) {
    const selected = new Set(ids)
    return ids.filter(id => !lineage(id).slice(1).some(r => selected.has(r.id)))
  }
  function hit(point, tolerance, scope = pageId) {
    const id = index.hitsAtPoint(point, tolerance).find(isSelectable)
    if (!id) return { id: null, focusedGroupId: validScope(scope) }
    const focusedGroupId = scopeFor(id, validScope(scope))
    return { id: target(id, focusedGroupId), focusedGroupId }
  }
  function query(box, scope = pageId, wrap = false) {
    const ids = [...new Set(index.query(box).filter(id => isSelectable(id) && inside(id, scope)).map(id => target(id, scope)))]
    // 2026-11-26 native legacy brush: a frame itself requires full enclosure;
    // its visible children can be partially intersected, including at page scope.
    return roots(ids.filter(id => (!wrap && index.getRecord(id).type !== 'frame') || contains(box, index.getBounds(id))))
  }
  // 2026-11-26 native Tab/Shift+Tab observations: vertically overlapping items
  // form transitive rows, then run left-to-right (tall-frame overlap included).
  function readingOrder(scope = pageId) {
    const items = children(scope).map(id => ({ id, box: index.getBounds(id) })).filter(r => r.box)
      .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x || order(index.getRecord(a.id), index.getRecord(b.id)))
    const rows = []
    for (const item of items) {
      let row = rows.at(-1)
      if (!row || item.box.y > row.bottom) { row = { bottom: -Infinity, items: [] }; rows.push(row) }
      row.bottom = Math.max(row.bottom, item.box.y + item.box.h); row.items.push(item)
    }
    return rows.flatMap(row => row.items.sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y || order(index.getRecord(a.id), index.getRecord(b.id))).map(r => r.id))
  }
  function neighbor(id, direction, scope = pageId) {
    const box = index.getBounds(id)
    if (!box) return null
    const center = b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 }), origin = center(box)
    const axis = ['left', 'right'].includes(direction) ? 'x' : 'y', sign = ['left', 'up'].includes(direction) ? -1 : 1
    // Native Mod+Arrow chose the closer diagonal over the aligned distant item,
    // including directions beyond 45 degrees: a half-plane, Euclidean distance.
    return readingOrder(scope).filter(key => key !== id).map(key => ({ id: key, point: center(index.getBounds(key)) }))
      .filter(r => (r.point[axis] - origin[axis]) * sign > 0)
      .sort((a, b) => Math.hypot(a.point.x - origin.x, a.point.y - origin.y) - Math.hypot(b.point.x - origin.x, b.point.y - origin.y))[0]?.id || null
  }
  return { pageId, records, lineage, isSelectable, validScope, scopeFor, children, roots, target, query, readingOrder, neighbor,
    apply(changes) {
      records.applyChanges(changes)
      for (const id of new Set([...Object.keys(changes.added || {}), ...Object.keys(changes.updated || {}), ...Object.keys(changes.removed || {})])) if (index.getRecord(id)?.typeName === 'shape' || widths.has(id)) updateWidth(id, index.getRecord(id))
    },
    // Connection index bounds describe the center path. Expand the coarse query
    // by the incrementally cached widest half-stroke, then test exact geometry.
    candidates: (box, scope) => index.query({ x: box.x - padding, y: box.y - padding, w: box.w + padding * 2, h: box.h + padding * 2 }).filter(id => isSelectable(id) && inside(id, scope)),
    hit, hitTest: (point, tolerance, scope) => hit(point, tolerance, scope).id,
  }
}
