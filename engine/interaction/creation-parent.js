import { pageToShapePoint } from '../../renderer/geometry.js'

// Ask the existing geometry index for visible frames; only creation policy
// chooses a parent. Capture its ancestor chain, never a full-board snapshot.
export function captureCreationParent({ index, targets, pageId }, point, skipId = null) {
  const parent = point && index.hitsAtPoint(point).find(id => id !== skipId && index.getRecord(id)?.type === 'frame' && targets.isSelectable(id))
  const parentId = parent || pageId, records = Object.create(null), expected = new Map()
  let angle = 0
  for (let record = index.getRecord(parentId); record?.typeName === 'shape'; record = index.getRecord(record.parentId)) {
    records[record.id] = record; angle += record.rotation || 0
    expected.set(record.id, JSON.stringify(record))
  }
  return {
    matches: () => [...expected].every(([id, value]) => JSON.stringify(index.getRecord(id)) === value),
    pose(bounds) {
      const point = pageToShapePoint({ store: records }, parentId, { x: bounds.x, y: bounds.y })
      return { ...point, parentId, rotation: angle ? -angle : 0 }
    },
  }
}
