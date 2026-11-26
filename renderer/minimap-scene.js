import { createSpatialIndex, shapeToPagePoint, getShapeBounds } from './geometry.js'
import { boxPolygon, clipPolygon } from './polygon-clip.js'

// Kept separate from camera frames: build geometry once, invalidate from record
// diffs. No images, fonts, DOM, or snapshot serialization enter the thumbnail.
export function createMinimapScene(store, pageId, onChange = () => {}) {
  const initial = store.allRecords(), records = Object.fromEntries(initial.map(r => [r.id, r]))
  const page = pageId || initial.find(r => r.typeName === 'page')?.id
  const index = createSpatialIndex(initial, page), snapshot = { store: records }
  let cached = null
  function visibleBox(record) {
    if (record.typeName !== 'shape' || record.type === 'group') return null
    const bounds = index.getBounds(record.id)
    if (!bounds) return null
    let polygon = boxPolygon(bounds), current = record
    while (current?.typeName === 'shape') {
      if (current.opacity === 0) return null
      const parent = records[current.parentId]
      if (parent?.type === 'frame') {
        const clip = boxPolygon(getShapeBounds(parent)).map(p => shapeToPagePoint(snapshot, parent.id, p))
        polygon = clipPolygon(polygon, clip)
        if (!polygon.length) return null
      }
      if (parent?.id === page) {
        const x = Math.min(...polygon.map(p => p.x)), y = Math.min(...polygon.map(p => p.y))
        return Object.freeze({ id: record.id, x, y, w: Math.max(...polygon.map(p => p.x)) - x, h: Math.max(...polygon.map(p => p.y)) - y })
      }
      current = parent
    }
    return null
  }
  const stop = store.addHistoryInterceptor(({ changes }) => {
    if (![...Object.values(changes.added), ...Object.values(changes.removed), ...Object.values(changes.updated).flat()].some(r => r.typeName === 'shape' || r.typeName === 'binding')) return
    for (const id of Object.keys(changes.removed)) delete records[id]
    for (const record of Object.values(changes.added)) records[record.id] = record
    for (const [, record] of Object.values(changes.updated)) records[record.id] = record
    index.applyChanges(changes); cached = null; onChange()
  })
  return Object.freeze({
    boxes() { return cached ||= Object.freeze(Object.values(records).map(visibleBox).filter(Boolean)) },
    dispose: stop,
  })
}
