import { getConnectionTargetBounds, getShapeContour } from '../../renderer/geometry.js'
import { clamp, connectionCoordinates } from './connection-coordinates.js'

function containsTarget(context, id, point) {
  const target = context.index.getRecord(id), bounds = getConnectionTargetBounds(target, context.targets.records)
  if (!bounds) return false
  const p = connectionCoordinates(context.index, id).local(point)
  if (p.x < bounds.x || p.y < bounds.y || p.x > bounds.x + bounds.w || p.y > bounds.y + bounds.h) return false
  const polygon = getShapeContour(target, context.targets.records)?.outline
  if (!polygon?.length) return target.type === 'group'
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i], cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)
    if (Math.abs(cross) < 1e-8 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) return true
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function captureBindingTargets(context, shapeId, previous) {
  const ids = [...new Set(context.targets.records.bindingsFrom(shapeId).map(binding => binding.toId))].sort(), targetIds = JSON.stringify(ids)
  if (previous?.targetIds === targetIds) return previous
  const dependencies = new Set(), groups = new Set()
  for (const id of ids) {
    for (const record of context.targets.lineage(id)) dependencies.add(record.id)
    if (context.index.getRecord(id)?.type === 'group') {
      const pending = [id]
      for (const parent of pending) {
        groups.add(parent)
        for (const child of context.targets.records.childIds(parent)) {
          dependencies.add(child)
          if (context.index.getRecord(child)?.type === 'group') pending.push(child)
        }
      }
    }
  }
  // Capture each bound group's subtree once. Incremental changes invalidate
  // it, including membership changes; pointer moves never rescan that subtree.
  let valid = true
  return Object.assign(() => valid, { targetIds, apply(changes) {
    for (const record of [...Object.values(changes.added), ...Object.values(changes.removed), ...Object.values(changes.updated).flat()]) {
      if (dependencies.has(record.id) || record.typeName === 'shape' && groups.has(record.parentId)) { valid = false; break }
    }
  } })
}

// Native synthetic rectangles, 2026-11-26: boundary binds; 1px outside
// does not. Alt AFTER handle-down makes exact/precise; Ctrl removes binding.
// Precise dwell was false at 200ms and true at 300ms. 300ms is our explicit
// policy within that observed interval, not an asserted legacy constant.
export function createTerminalBinding(context, shapeId, terminal) {
  let candidate = null, entered = 0
  const { index, targets } = context
  const original = targets.records.bindingsFrom(shapeId).find(binding => binding.props.terminal === terminal)
  let bindingId = original?.id || null
  function commands(point, input) {
    const hit = !input.ctrlKey && index.hitsAtPoint(point, 0, { geoInterior: true }).find(id => {
      const record = index.getRecord(id)
      return id !== shapeId && !['line', 'arrow', 'draw', 'highlight'].includes(record?.type) && targets.isSelectable(id)
        && !targets.lineage(shapeId).some(r => r.id === id) && !targets.lineage(id).some(r => r.id === shapeId) && containsTarget(context, id, point)
    })
    const targetId = hit && targets.target(hit), target = targetId && index.getRecord(targetId)
    const bounds = target && getConnectionTargetBounds(target, targets.records)
    if (candidate !== targetId) { candidate = targetId; entered = input.time }
    const existing = targets.records.bindingsFrom(shapeId).filter(b => b.props.terminal === terminal)
    if (!bounds || !bounds.w || !bounds.h) return existing.map(b => ({ type: 'delete', ids: [b.id] }))
    const precise = input.altKey || input.time - entered >= 300
    const local = connectionCoordinates(index, targetId).local(point)
    const normalizedAnchor = precise ? { x: clamp((local.x - bounds.x) / bounds.w), y: clamp((local.y - bounds.y) / bounds.h) } : { x: .5, y: .5 }
    bindingId ||= existing[0]?.id || `binding:${globalThis.crypto.randomUUID()}`
    const previous = existing.find(binding => binding.id === bindingId) || original
    return [...existing.filter(b => b.id !== bindingId).map(b => ({ type: 'delete', ids: [b.id] })), { type: 'put', record: {
      ...previous, id: bindingId, typeName: 'binding', type: 'arrow', fromId: shapeId, toId: targetId, meta: previous?.meta || {},
      props: { ...previous?.props, terminal, normalizedAnchor, isExact: input.altKey, isPrecise: precise, snap: precise ? 'none' : 'center' },
    } }]
  }
  return { commands, get needsFrame() { return Boolean(candidate) } }
}
