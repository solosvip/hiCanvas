// Selection policy lives in the editing layer. The geometry index reports
// visible records, including locked ones, without choosing editing targets.
export function createSelectionTargets(index, pageId) {
  function lineage(id) {
    const result = []
    for (let record = index.getRecord(id); record?.typeName === 'shape'; record = index.getRecord(record.parentId)) result.push(record)
    return result
  }
  function isSelectable(id) {
    const records = lineage(id)
    return Boolean(records.length && records.at(-1).parentId === pageId && records.every(r => !r.isLocked && r.opacity !== 0))
  }
  function target(id) {
    let result = id
    for (const record of lineage(id)) if (record.type === 'group') result = record.id
    return result
  }
  return {
    isSelectable,
    hitTest(point, tolerance) { const id = index.hitsAtPoint(point, tolerance).find(isSelectable); return id ? target(id) : null },
    query(box) { return [...new Set(index.query(box).filter(isSelectable).map(target))] },
  }
}
