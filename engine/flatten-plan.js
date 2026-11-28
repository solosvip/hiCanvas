import { CanvasEditError } from './errors.js'
import { orderedChildren, shapeToPagePoint, pageToShapePoint } from '../renderer/geometry.js'

const invalid = message => { throw new CanvasEditError(message, 'flatten-unavailable') }
function lineage(records, id) {
  const result = [], seen = new Set()
  for (let record = records[id]; record?.typeName === 'shape'; record = records[record.parentId]) {
    if (seen.has(record.id)) invalid('对象父级存在循环。')
    seen.add(record.id); result.push(record)
  }
  return result
}

// Both the interaction's last pre-submit check and the authoritative command
// validate the same bounded asset intent. Board ownership stays in the host.
export function validateFlattenImage(image, bounds) {
  const scale = image?.mimeType === 'image/svg+xml' ? 1 : image?.mimeType === 'image/png' ? 2 : 0, extension = scale === 1 ? 'svg' : 'png'
  if (!scale || !bounds || !['x', 'y', 'w', 'h'].every(key => Number.isSafeInteger(bounds[key])) || bounds.w <= 0 || bounds.h <= 0 || ![image.w, image.h].every(n => Number.isSafeInteger(n) && n > 0 && n <= 8192) || image.w * image.h > 16_000_000 || image.w !== bounds.w * scale || image.h !== bounds.h * scale || image.isAnimated !== false || typeof image.src !== 'string' || !new RegExp(`^/c/[0-9a-f-]{36}/assets/[a-zA-Z0-9_-]+-media-import-[a-zA-Z0-9_-]+\\.${extension}$`).test(image.src)) throw new CanvasEditError('扁平化图片回执或范围无效。', 'flatten-invalid-receipt')
}

// 2026-11-27 F03/F07: legacy splits distant/cross-parent selections. #213
// intentionally produces ONE image: same parent only, no unselected interleave.
// F04–F06: preserve unselected siblings; standard single-child groups dissolve.
export function flattenPlan(snapshot, ids, { render = true } = {}) {
  const records = snapshot?.store
  if (!records || !Array.isArray(ids) || ids.some(id => typeof id !== 'string' || records[id]?.typeName !== 'shape')) invalid('扁平化需要明确且仍然存在的对象。')
  const selected = new Set(ids)
  if (!selected.size) return { status: 'unavailable', reason: 'empty-selection' }
  const roots = [...selected].map(id => records[id]).filter(shape => !lineage(records, shape.parentId).some(parent => selected.has(parent.id))).sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : a.id.localeCompare(b.id))
  const parentId = roots[0].parentId
  if (roots.some(shape => shape.parentId !== parentId)) invalid('所选对象属于不同父级，请分开扁平化。')
  const ancestors = lineage(records, parentId), pageId = ancestors.length ? ancestors.at(-1).parentId : parentId
  if (records[pageId]?.typeName !== 'page') invalid('找不到对象所在画布。')
  const children = orderedChildren(Object.values(records)), included = new Set(roots.map(shape => shape.id)), pending = [...included]
  for (const id of pending) for (const child of children.get(id) || []) {
    if (included.has(child.id)) invalid('对象后代关系存在循环。')
    included.add(child.id); pending.push(child.id)
  }
  // F11/F12/F18: lock changes never cause a partial replacement. Include locked
  // descendants of a selected container, as well as every effective ancestor.
  if ([...included].some(id => records[id].isLocked) || ancestors.some(shape => shape.isLocked)) invalid('所选对象、后代或父级已锁定，不能扁平化。')
  if (roots.length === 1 && roots[0].type === 'image') return { status: 'unavailable', reason: 'already-image' }
  const siblings = children.get(parentId) || [], first = siblings.findIndex(shape => shape.id === roots[0].id), last = siblings.findIndex(shape => shape.id === roots.at(-1).id)
  if (siblings.slice(first, last + 1).some(shape => !included.has(shape.id))) invalid('所选对象之间夹有未选对象，请分开扁平化。')
  const plan = { status: 'ready', ids: roots.map(shape => shape.id), allIds: [...included], parentId, pageId, index: roots[0].index }
  if (!render) return plan
  const renderSnapshot = structuredClone(snapshot), bindings = Object.values(records).filter(record => record.typeName === 'binding')
  // Render in the parent's LOCAL coordinates. The replacement inherits its
  // original parent transform/opacity/clip once, rather than baking them twice.
  // Keep bound routes, including arc curvature/elbow exit normals, unchanged.
  // External targets get read-only geometry copies in the same local space;
  // they are NOT selected/rendered and never enter the committed document.
  for (const shape of roots) renderSnapshot.store[shape.id].parentId = pageId
  const targets = new Map(), parentRotation = ancestors.reduce((sum, shape) => sum + shape.rotation, 0)
  function copyTarget(id) {
    if (targets.has(id)) return targets.get(id)
    const source = records[id]
    if (source?.typeName !== 'shape') invalid('箭头绑定目标已失效。')
    const copied = new Map(), visit = original => {
      let copyId
      do { copyId = `shape:flatten-context-${globalThis.crypto.randomUUID()}` } while (renderSnapshot.store[copyId])
      copied.set(original.id, copyId)
      const copy = structuredClone(original); copy.id = copyId
      renderSnapshot.store[copyId] = copy
      for (const child of children.get(original.id) || []) visit(child)
    }
    visit(source)
    for (const [originalId, copyId] of copied) {
      const copy = renderSnapshot.store[copyId]
      copy.parentId = copied.get(records[originalId].parentId) || pageId
    }
    const root = renderSnapshot.store[copied.get(id)], world = shapeToPagePoint(snapshot, id, { x: 0, y: 0 })
    const local = records[parentId]?.typeName === 'shape' ? pageToShapePoint(snapshot, parentId, world) : world
    root.x = local.x; root.y = local.y; root.rotation = lineage(records, id).reduce((sum, shape) => sum + shape.rotation, 0) - parentRotation
    targets.set(id, root.id); return root.id
  }
  for (const binding of bindings) if (included.has(binding.fromId) && records[binding.fromId].type === 'arrow' && !included.has(binding.toId)) renderSnapshot.store[binding.id].toId = copyTarget(binding.toId)
  return { ...plan, renderSnapshot }
}
