import { noteGeometry } from './note-geometry.js'

// Native legacy translation samples with snap preference OFF: ideal right
// origin510; x501/519 ->510, x500/520 unchanged. (6,6) ->ideal; (8,8) didn't.
// Thus use Euclidean distance <10 CSS px. Ctrl/Meta applied AFTER down did
// not disable this local note policy. Global preferences remain #128.
export function createNoteSnapping(context) {
  let indicator = null
  function preview(starts, delta) {
    indicator = null
    if (starts.length !== 1) return delta
    const start = starts[0], source = context.index.getRecord(start.id)
    if (source?.type !== 'note') return delta
    const geometry = noteGeometry(context.index, source), origin = start.page || geometry.coordinates.page({ x: 0, y: 0 })
    const point = { x: origin.x + delta.x, y: origin.y + delta.y }, radius = 10 / context.read().camera.z
    const reach = Math.max(geometry.w, geometry.h) + 10 * (source.props.scale || 1) + radius
    let best = null, gap = radius
    for (const id of context.index.query({ x: point.x - reach, y: point.y - reach, w: reach * 2, h: reach * 2 })) {
      const target = context.index.getRecord(id)
      if (id === source.id || target.type !== 'note' || target.parentId !== source.parentId || target.props.scale !== source.props.scale || target.rotation !== source.rotation || !context.targets.isSelectable(id)) continue
      const other = noteGeometry(context.index, target)
      for (const offset of Object.values(other.offsets)) {
        const candidate = other.coordinates.page(offset), distance = Math.hypot(point.x - candidate.x, point.y - candidate.y)
        if (distance < gap && context.index.isPointVisible(id, other.coordinates.page({ x: other.w / 2, y: other.h / 2 }))) { gap = distance; best = candidate }
      }
    }
    if (!best) return delta
    indicator = { kind: 'snap', bounds: { x: 0, y: 0, w: 0, h: 0 }, handles: [{ id: 'note-snap', kind: 'vertex', ...best }] }
    return { x: delta.x + best.x - point.x, y: delta.y + best.y - point.y }
  }
  return { preview, clear() { indicator = null }, indicator: () => indicator }
}
