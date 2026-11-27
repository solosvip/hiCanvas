import { CanvasEditError } from '../errors.js'
import { createConnectionContext, getShapePageBounds, getShapeBounds, hitTestCanvas, shapeToPagePoint, pageToShapePoint } from '../../renderer/geometry.js'
import { validateClipboardContent } from './validate.js'
import { isSlidesContainer, isSlidesPage } from '../slides-layout.js'

function boundsOf(content) {
  const records = [...content.shapes, ...content.bindings, ...content.assets]
  const snapshot = { store: Object.fromEntries(records.map(r => [r.id, r])) }, context = createConnectionContext(records)
  const boxes = content.rootIds.map(id => getShapePageBounds(snapshot, id, context)).filter(Boolean)
  if (!boxes.length) throw new CanvasEditError('剪贴板对象没有可放置的边界。')
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y))
  const bounds = { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y }
  if (![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite)) throw new CanvasEditError('剪贴板对象的联合边界越界。')
  return bounds
}

function usableParent(snapshot, id, pageId) {
  const record = snapshot.store[id]
  if (id === pageId) return record
  if (!record || !['frame', 'group'].includes(record.type)) return null
  const seen = new Set()
  for (let r = record; r?.typeName === 'shape'; r = snapshot.store[r.parentId]) {
    if (r.isLocked || seen.has(r.id)) return null
    seen.add(r.id)
  }
  return record
}

function frameAtPoint(snapshot, point, pageId) {
  let id = hitTestCanvas(snapshot, point, { x: 0, y: 0, z: 1 }, pageId)
  while (snapshot.store[id]?.typeName === 'shape') {
    const record = snapshot.store[id]
    if (record.type === 'frame' && usableParent(snapshot, id, pageId)) return record
    id = record.parentId
  }
  return null
}

function withinClippingFrames(snapshot, parent, point) {
  for (let r = parent; r?.typeName === 'shape'; r = snapshot.store[r.parentId]) {
    if (r.type !== 'frame') continue
    const local = pageToShapePoint(snapshot, r.id, point), box = getShapeBounds(r, snapshot)
    if (local.x < box.x || local.y < box.y || local.x > box.x + box.w || local.y > box.y + box.h) return false
  }
  return true
}

// Legacy observations, 2026-11-26: synthetic ClipboardEvent/private memory,
// native pointers/modifiers and native preference-menu click. Default repeats
// overlap; an offscreen copy centers in the viewport. Cursor mode centers the
// whole copied bounds at the current world point, including z=.5. Shift made
// no change in either mode. The preference is session data, not a command.
export function planClipboardPaste(snapshot, input, { viewport, point, atCursor = false, boardId = '', selectedIds = [], focusedGroupId = null, strategy = 'default' } = {}) {
  const content = validateClipboardContent(input), bounds = boundsOf(content)
  if (!viewport || ![viewport.x, viewport.y, viewport.w, viewport.h].every(Number.isFinite) || viewport.w <= 0 || viewport.h <= 0) throw new CanvasEditError('粘贴需要有效的画布视口。')
  if (!['default', 'viewport-page'].includes(strategy)) throw new CanvasEditError('不支持的粘贴落点策略。')
  const page = Object.values(snapshot.store).find(r => r.typeName === 'page')
  if (!page) throw new CanvasEditError('找不到粘贴画布。')
  const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
  // Observed external Excalidraw paste centers on the viewport's page even
  // with cursor preference, an enclosing frame or a focused group (#176).
  if (strategy === 'viewport-page') return { parentId: page.id, offset: { x: viewport.x + viewport.w / 2 - center.x, y: viewport.y + viewport.h / 2 - center.y } }
  if (atCursor && (!point || ![point.x, point.y].every(Number.isFinite))) throw new CanvasEditError('光标粘贴需要有效的世界坐标。')
  const selected = selectedIds.length === 1 && snapshot.store[selectedIds[0]]
  const slides = isSlidesContainer(selected) ? selected : isSlidesPage(selected) && snapshot.store[selected.parentId]
  // Container copies retain the existing root strategy; only leaf roots use
  // the explicit selected-deck destination. Descendants are never flattened.
  const copyHasContainerRoot = content.rootIds.some(id => ['frame', 'group'].includes(content.shapes.find(r => r.id === id)?.type))
  const selectedSlides = !copyHasContainerRoot && isSlidesContainer(slides) && usableParent(snapshot, slides.id, page.id)
  let parent = selectedSlides || usableParent(snapshot, focusedGroupId, page.id)
  if (!parent && atCursor) parent = frameAtPoint(snapshot, point, page.id)
  if (!parent && boardId && boardId === content.origin.boardId) {
    const parents = new Set(content.rootIds.map(id => content.origin.parents[id]))
    if (parents.size === 1) parent = usableParent(snapshot, [...parents][0], page.id)
  }
  parent ||= page
  let destination = center
  if (atCursor) destination = point
  else if (bounds.x + bounds.w < viewport.x || bounds.y + bounds.h < viewport.y || bounds.x > viewport.x + viewport.w || bounds.y > viewport.y + viewport.h) {
    destination = { x: viewport.x + viewport.w / 2, y: viewport.y + viewport.h / 2 }
  } else if (parent.type === 'frame' && (selectedSlides || content.rootIds.some(id => selectedIds.includes(id)))) {
    const box = getShapeBounds(parent, snapshot)
    destination = shapeToPagePoint(snapshot, parent.id, { x: box.x + box.w / 2, y: box.y + box.h / 2 })
  }
  // Groups can be nested inside a clipping frame too. An origin hint must
  // never hide a cursor/viewport paste behind any old ancestor's clip.
  if (!withinClippingFrames(snapshot, parent, destination)) parent = frameAtPoint(snapshot, destination, page.id) || page
  return { parentId: parent.id, offset: { x: destination.x - center.x, y: destination.y - center.y } }
}
