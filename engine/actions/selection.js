// Read-only record access keeps planning independent of Store, DOM and runtime.
// childIds includes locked children: unlock-all and post-ungroup selection need
// document membership, rather than the selectable subset used by hit testing.
export function actionSelection({ records, selectedIds = [], pageId }, allowLocked = false) {
  const lineage = id => {
    const chain = [], seen = new Set()
    for (let r = records.getRecord(id); r?.typeName === 'shape' && !seen.has(r.id); r = records.getRecord(r.parentId)) { seen.add(r.id); chain.push(r) }
    return chain
  }
  const selected = new Set(selectedIds)
  return [...selected].map(id => lineage(id)).filter(chain => chain.length && chain.at(-1).parentId === pageId && chain.every((r, i) => (!r.isLocked || i === 0 && allowLocked) && r.opacity !== 0) && !chain.slice(1).some(r => selected.has(r.id))).map(chain => chain[0])
}

export function pageShapes(records, pageId) {
  const result = [], pending = [pageId], seen = new Set(pending)
  for (const parent of pending) for (const id of records.childIds(parent)) {
    if (seen.has(id)) continue
    seen.add(id); pending.push(id)
    const r = records.getRecord(id)
    if (r?.typeName === 'shape') result.push(r)
  }
  return result
}

export function expandedSelection(records, shapes, type) {
  return [...shapes.filter(r => r.type !== type).map(r => r.id), ...shapes.filter(r => r.type === type).flatMap(r => records.childIds(r.id))]
}
