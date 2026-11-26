import { getShapePageBounds, pageToShapePoint, pointInShape, getShapeBounds, shapeToPagePoint, createConnectionContext, getBoundArrowIds } from './geometry.js'

import { strokeWidth } from './geo-metrics.js'
import { clipPolygon, boxPolygon } from './polygon-clip.js'

const cellSize = 256, maxCells = 256
const overlaps = (a, b) => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y
const union = boxes => {
  if (!boxes.length) return null
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y))
  return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y }
}
function cellsFor(box) {
  const left = Math.floor(box.x / cellSize), top = Math.floor(box.y / cellSize)
  const right = Math.floor((box.x + box.w) / cellSize), bottom = Math.floor((box.y + box.h) / cellSize)
  if ((right - left + 1) * (bottom - top + 1) > maxCells) return null
  const keys = []
  for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) keys.push(`${x},${y}`)
  return keys
}

// Pure, incrementally maintained geometry. Initial records are read once; no
// Store or snapshot provider is retained. Each query visits only nearby cells.
export function createSpatialIndex(initial, pageId) {
  const records = Object.create(null), snapshot = { store: records }
  const connections = createConnectionContext(initial)
  const children = new Map(), entries = new Map(), cells = new Map(), oversized = new Set(), boundsCache = new Map()
  let lastUpdatedIds = [], lastRemovedIds = [], totalUpdates = 0
  let page = pageId || initial.find(r => r.typeName === 'page')?.id
  function link(record, add) {
    if (record.typeName !== 'shape') return
    if (!children.has(record.parentId)) children.set(record.parentId, new Set())
    if (add) children.get(record.parentId).add(record.id)
    else children.get(record.parentId).delete(record.id)
  }
  function chain(id) {
    const result = [], seen = new Set()
    for (let record = records[id]; record?.typeName === 'shape'; record = records[record.parentId]) {
      if (seen.has(record.id)) throw new Error('形状父子关系存在环。')
      seen.add(record.id); result.push(record)
    }
    return result
  }
  function visible(id) {
    const lineage = chain(id), root = lineage.at(-1)
    return Boolean(root && root.parentId === page && lineage.every(r => r.opacity !== 0))
  }
  function pagePolygon(id, padding = 0) {
    const bounds = getShapeBounds(records[id], connections)
    return boxPolygon({ x: bounds.x - padding, y: bounds.y - padding, w: bounds.w + padding * 2, h: bounds.h + padding * 2 }).map(p => shapeToPagePoint(snapshot, id, p))
  }
  function getBounds(id) {
    if (boundsCache.has(id)) return boundsCache.get(id)
    const record = records[id]
    const box = record?.type === 'group' ? union([...(children.get(id) || [])].map(getBounds).filter(Boolean))
      : record?.typeName === 'shape' ? getShapePageBounds(snapshot, id, connections) : null
    boundsCache.set(id, box)
    return box
  }
  function unindex(id) {
    const entry = entries.get(id)
    if (!entry) return
    for (const key of entry.keys || []) {
      const ids = cells.get(key); ids?.delete(id)
      if (!ids?.size) cells.delete(key)
    }
    oversized.delete(id); entries.delete(id)
  }
  function reindex(id) {
    unindex(id)
    const record = records[id], bounds = record?.type !== 'group' && getBounds(id)
    if (!bounds || ![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite)) return
    const padding = record.type === 'geo' ? strokeWidth(record.props) / 2 : 0
    const box = { x: bounds.x - padding, y: bounds.y - padding, w: bounds.w + padding * 2, h: bounds.h + padding * 2 }
    let polygon = pagePolygon(id, padding)
    for (const ancestor of chain(id).slice(1)) if (ancestor.type === 'frame') polygon = clipPolygon(polygon, pagePolygon(ancestor.id))
    const keys = cellsFor(box)
    entries.set(id, { box, keys, polygon })
    if (!keys) oversized.add(id)
    else for (const key of keys) {
      if (!cells.has(key)) cells.set(key, new Set())
      cells.get(key).add(id)
    }
  }
  function candidates(box) {
    const keys = cellsFor(box), ids = new Set(oversized)
    if (!keys) return [...entries.keys()].filter(id => overlaps(entries.get(id).box, box))
    for (const key of keys) for (const id of cells.get(key) || []) ids.add(id)
    return [...ids].filter(id => overlaps(entries.get(id).box, box))
  }
  function visiblePoint(id, point) {
    for (const ancestor of chain(id).slice(1)) if (ancestor.type === 'frame') {
      const local = pageToShapePoint(snapshot, ancestor.id, point), box = getShapeBounds(ancestor)
      if (local.x < 0 || local.y < 0 || local.x > box.w || local.y > box.h) return false
    }
    return true
  }
  function paintOrder(a, b) {
    const left = chain(a).reverse(), right = chain(b).reverse()
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      if (left[i].id === right[i].id) continue
      const aKey = left[i].index || '', bKey = right[i].index || ''
      return aKey < bKey ? -1 : aKey > bKey ? 1 : left[i].id < right[i].id ? -1 : 1
    }
    return left.length - right.length
  }
  function hitsAtPoint(point, tolerance = 0, { geoInterior = false } = {}) {
    const ids = candidates({ x: point.x - tolerance, y: point.y - tolerance, w: tolerance * 2, h: tolerance * 2 }).sort(paintOrder).reverse()
    return ids.filter(id => {
      const record = records[id], shape = geoInterior && record.type === 'geo' ? { ...record, props: { ...record.props, fill: 'solid' } } : record
      return visible(id) && visiblePoint(id, point) && pointInShape(shape, pageToShapePoint(snapshot, id, point), tolerance, connections)
    })
  }
  function hitTest(point, tolerance = 0) { return hitsAtPoint(point, tolerance)[0] || null }
  function query(box, { ordered = false } = {}) {
    const area = boxPolygon(box)
    const result = candidates(box).filter(id => visible(id) && clipPolygon(entries.get(id).polygon, area).length > 0)
    return ordered ? result.sort(paintOrder).reverse() : result
  }
  function applyChanges(changes) {
    const dirty = new Set(), ancestors = new Set()
    const next = [...Object.values(changes.added || {}), ...Object.values(changes.updated || {}).map(pair => pair[1])]
    const previous = [...Object.values(changes.removed || {}), ...Object.values(changes.updated || {}).map(pair => pair[0])]
    const dependants = record => {
      if (record.typeName === 'binding' && record.type === 'arrow') dirty.add(record.fromId)
      for (const id of getBoundArrowIds(connections, record)) dirty.add(id)
    }
    // Read both relationship versions: removing / retargeting a binding must
    // also invalidate the arrow that depended on its previous endpoint.
    previous.forEach(dependants)
    for (const record of previous) { chain(record.id).forEach(r => ancestors.add(r.id)); link(record, false); dirty.add(record.id) }
    for (const record of Object.values(changes.removed || {})) delete records[record.id]
    for (const record of next) { records[record.id] = record; link(record, true); dirty.add(record.id) }
    connections.applyChanges(changes)
    next.forEach(dependants)
    // Parent transforms and inherited visibility affect every descendant.
    for (const id of dirty) {
      for (const child of children.get(id) || []) dirty.add(child)
      for (const arrow of getBoundArrowIds(connections, id)) dirty.add(arrow)
    }
    for (const id of dirty) chain(id).forEach(r => ancestors.add(r.id))
    for (const id of new Set([...dirty, ...ancestors])) boundsCache.delete(id)
    lastUpdatedIds = []; lastRemovedIds = []
    for (const id of dirty) {
      const existed = entries.has(id)
      reindex(id)
      if (entries.has(id)) lastUpdatedIds.push(id)
      else if (existed) lastRemovedIds.push(id)
    }
    totalUpdates += lastUpdatedIds.length
  }
  for (const record of initial) { records[record.id] = record; link(record, true) }
  for (const record of initial) if (record.typeName === 'shape') reindex(record.id)
  return Object.freeze({ applyChanges, hitTest, hitsAtPoint, query, getBounds: id => { const box = getBounds(id); return box && { ...box } }, getRecord: id => records[id],
    isPointVisible: (id, point) => visible(id) && visiblePoint(id, point),
    // Read-only diagnostics count refreshed entries, excluding initial build.
    getUpdateStats: () => Object.freeze({ updatedIds: Object.freeze([...lastUpdatedIds]), removedIds: Object.freeze([...lastRemovedIds]), totalUpdates }),
    // Convert a page displacement to the selected record's parent coordinates.
    parentDelta(id, delta) {
      const parentId = records[id]?.parentId
      const origin = pageToShapePoint(snapshot, parentId, { x: 0, y: 0 }), end = pageToShapePoint(snapshot, parentId, delta)
      return { x: end.x - origin.x, y: end.y - origin.y }
    },
  })
}
