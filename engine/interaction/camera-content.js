import { unionBounds } from './camera-math.js'

// Membership is captured once, then updated from record diffs. Camera frames use
// the cached box plus spatial queries, never allRecords()/getStoreSnapshot().
export function createCameraContent(initial, index, pageId) {
  const ids = new Set(initial.filter(r => r.typeName === 'shape').map(r => r.id))
  let dirty = true, cached = null, witness = null
  function visible(id) {
    let record = index.getRecord(id)
    while (record?.typeName === 'shape') {
      if (record.opacity === 0) return false
      record = index.getRecord(record.parentId)
    }
    return record?.id === pageId
  }
  function bounds(selection) {
    if (selection) return unionBounds(selection.filter(visible).map(id => index.getBounds(id)))
    if (dirty) { cached = unionBounds([...ids].filter(visible).map(id => index.getBounds(id))); dirty = false }
    return cached
  }
  return { bounds,
    apply(changes) {
      for (const record of Object.values(changes.removed)) ids.delete(record.id)
      for (const record of Object.values(changes.added)) if (record.typeName === 'shape') ids.add(record.id)
      dirty = true
    },
    offscreen(camera, viewport) {
      const box = { x: -camera.x, y: -camera.y, w: viewport.w / camera.z, h: viewport.h / camera.z }
      const intersects = b => b && b.x <= box.x + box.w && b.y <= box.y + box.h && b.x + b.w >= box.x && b.y + b.h >= box.y
      if (witness && visible(witness) && intersects(index.getBounds(witness))) return false
      const all = bounds()
      if (!all) return false
      if (all.x > box.x + box.w || all.y > box.y + box.h || all.x + all.w < box.x || all.y + all.h < box.y) return true
      // A view can lie in a gap inside the union. Query only the visible region.
      witness = index.query(box).find(visible)
      return !witness
    },
  }
}
