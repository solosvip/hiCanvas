import { getShapeTextLayout, pageToShapePoint } from '../../renderer/geometry.js'

// ADR0011: only the host measures system-ui title width. No DOM or saved
// geometry depends on it. Reuse the spatial index and only nearby ancestors.
export function frameTitleAtPoint(context, point) {
  const { index, targets, read, measureFrameTitle } = context
  if (!measureFrameTitle) return null
  const zoom = read().camera.z, margin = 44 / zoom
  const bodyHits = new Set(index.hitsAtPoint(point, 0))
  for (const id of index.query({ x: point.x - margin, y: point.y - margin, w: margin * 2, h: margin * 2 }, { ordered: true })) {
    const shape = index.getRecord(id)
    if (!targets.isSelectable(id) || !index.isPointVisible(id, point)) continue
    if (shape.type !== 'frame') { if (bodyHits.has(id)) return null; continue }
    const records = Object.fromEntries(targets.lineage(id).map(record => [record.id, record]))
    const local = pageToShapePoint({ store: records }, id, point)
    const box = getShapeTextLayout(shape, null, { zoom, titleWidth: measureFrameTitle(shape.props.name) })
    if (local.x >= box.x && local.x <= box.x + box.w && local.y >= box.y && local.y <= box.y + box.h) return id
    if (bodyHits.has(id)) return null
  }
  return null
}
