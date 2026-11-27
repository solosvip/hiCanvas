import { segmentHitsShape } from './selection-geometry.js'

// Erasing shares geometry and group ancestry with selection, but opacity zero
// is still erasable (2026-11-26 isolated legacy native observation).
export function createEraserTargets(index, targets) {
  function allowed(id) {
    const chain = targets.lineage(id)
    return Boolean(chain.length && chain.at(-1).parentId === targets.pageId && chain.every(r => !r.isLocked))
  }
  function segment(from, to, tolerance, scope) {
    const box = { x: Math.min(from.x, to.x) - tolerance, y: Math.min(from.y, to.y) - tolerance,
      w: Math.max(1e-6, Math.abs(to.x - from.x)) + tolerance * 2, h: Math.max(1e-6, Math.abs(to.y - from.y)) + tolerance * 2 }
    return index.query(box, { ordered: true, includeTransparent: true }).filter(id => allowed(id) && segmentHitsShape(id, from, to, targets, tolerance))
      .map(id => targets.target(id, targets.scopeFor(id, scope)))
  }
  function point(point, tolerance, scope, topOnly) {
    const hits = segment(point, point, tolerance, scope)
    const ids = topOnly ? hits.slice(0, 1) : hits
    return targets.roots([...new Set(ids)]).sort()
  }
  function capture(ids, basis) {
    const remember = id => {
      const record = targets.records.getRecord(id)
      if (record && !basis.expected.has(id)) basis.expected.set(id, JSON.stringify(record))
    }
    for (const root of ids) {
      if (basis.roots.has(root)) continue
      basis.roots.add(root)
      targets.lineage(root).forEach(r => remember(r.id))
      const pending = [root]
      for (const id of pending) {
        if (basis.deleted.has(id)) continue
        basis.deleted.add(id); remember(id)
        pending.push(...targets.records.childIds(id))
        for (const binding of [...targets.records.bindingsTo(id), ...targets.records.bindingsFrom(id)]) {
          remember(binding.id); remember(binding.fromId)
        }
      }
    }
  }
  function changed(changes, basis) {
    for (const record of [...Object.values(changes.added), ...Object.values(changes.updated).map(([, next]) => next), ...Object.values(changes.removed)]) {
      if (basis.expected.has(record.id) && JSON.stringify(targets.records.getRecord(record.id)) !== basis.expected.get(record.id)) return true
      // New descendants/bindings would silently enlarge the deletion on up.
      if (!basis.expected.has(record.id) && (basis.deleted.has(record.parentId) || record.typeName === 'binding' && (basis.deleted.has(record.toId) || basis.deleted.has(record.fromId)))) return true
    }
    return false
  }
  return { allowed, point, segment, capture, changed }
}
