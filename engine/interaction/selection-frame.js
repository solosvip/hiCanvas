import { getShapeBounds, shapeToPagePoint } from '../../renderer/geometry.js'
import { getShapeScalingCapabilities } from '../shape-scaling.js'

const rotate = (p, angle) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) })
const box = points => {
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
  return { x, y, w: Math.max(...points.map(p => p.x)) - x, h: Math.max(...points.map(p => p.y)) - y }
}

// Membership is maintained from Store diffs, so selecting a group visits only
// its descendants. Pointer/camera frames never enumerate the document here.
export function createSelectionFrame(initial, index) {
  const records = Object.create(null), children = new Map()
  function remove(record) {
    delete records[record.id]
    children.get(record.parentId)?.delete(record.id)
  }
  function put(record) {
    if (records[record.id]) remove(records[record.id])
    records[record.id] = record
    if (record.typeName !== 'shape') return
    if (!children.has(record.parentId)) children.set(record.parentId, new Set())
    children.get(record.parentId).add(record.id)
  }
  initial.forEach(put)
  function lineage(id) {
    const result = []
    for (let r = records[id]; r?.typeName === 'shape'; r = records[r.parentId]) result.push(r)
    return result
  }
  function roots(ids) {
    const selected = new Set(ids)
    return ids.filter(id => !lineage(id).slice(1).some(r => selected.has(r.id)))
  }
  function expanded(ids, includeGroups = false) {
    const result = [], pending = [...roots(ids)], seen = new Set()
    for (const id of pending) {
      if (seen.has(id)) continue
      seen.add(id)
      const r = records[id]
      if (!r) continue
      if (r.type === 'group') pending.push(...(children.get(id) || []))
      if (r.type !== 'group' || includeGroups) result.push(r)
    }
    return result
  }
  function get(ids, rotationHint = null) {
    const selected = roots(ids)
    if (!selected.length) return null
    const angles = selected.map(id => lineage(id).reduce((sum, r) => sum + (r.rotation || 0), 0))
    const shared = angles.every(a => Math.abs(a - angles[0]) < 1e-9) ? angles[0] : 0
    const rotation = selected.length > 1 ? rotationHint ?? shared : angles[0]
    if (selected.length > 1 && rotation === 0) {
      const points = selected.flatMap(id => { const b = index.getBounds(id); return b ? [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }] : [] })
      return points.length ? { ...box(points), rotation: 0 } : null
    }
    const snapshot = { store: records }
    const points = expanded(selected).flatMap(r => {
      const b = getShapeBounds(r, snapshot)
      return b ? [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }].map(p => rotate(shapeToPagePoint(snapshot, r.id, p), -rotation)) : []
    })
    if (!points.length) return null
    const b = box(points), origin = rotate(b, rotation)
    return { ...b, x: origin.x, y: origin.y, rotation }
  }
  return {
    get, roots, lineage,
    children: id => [...(children.get(id) || [])].map(key => records[key]).filter(Boolean),
    canRotate(ids) {
      const selected = roots(ids)
      return Boolean(selected.length && selected.every(id => { const b = index.getBounds(id); return b && b.w > 0 && b.h > 0 }))
    },
    capability(ids, options) {
      const leaves = expanded(ids), capabilities = leaves.map(r => getShapeScalingCapabilities(r, options))
      const selected = roots(ids)
      return { canScale: Boolean(leaves.length && capabilities.every(c => c.canScale)), lockAspectRatio: capabilities.some(c => c.lockAspectRatio), hideResizeHandles: selected.length === 1 && records[selected[0]]?.type !== 'group' && Boolean(capabilities[0]?.hideResizeHandles) }
    },
    capture(ids) {
      // Scaling stops at a frame. Its descendants retain their local records
      // and may be edited remotely without being overwritten by our preview.
      return expanded(ids, true)
    },
    expected(ids) {
      return new Map(expanded(ids, true).flatMap(r => lineage(r.id)).map(r => [r.id, JSON.stringify(r)]))
    },
    apply(changes) {
      Object.values(changes.removed).forEach(remove)
      Object.values(changes.updated).forEach(([, next]) => put(next))
      Object.values(changes.added).forEach(put)
    },
  }
}

export function framePoint(frame, point) {
  const p = rotate(point, frame.rotation)
  return { x: frame.x + p.x, y: frame.y + p.y }
}
export function pointInFrame(frame, point) { return rotate({ x: point.x - frame.x, y: point.y - frame.y }, -frame.rotation) }
