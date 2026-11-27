// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { isAiSlidesItemShape, isAiSlidesShape, isAiDraftHolderShape, isAiFilmHolderShape } from './holderMeta.jsx'
import { AI_DRAFT_HOLDER_LABEL, AI_FILM_LABEL } from './configuration.jsx'
import { getSlidesPages, planSlidesLayout } from '../../engine/index.js'
import { cowartCopiedContent, cowartPendingSlidesPastes } from './assets.jsx'
function getAiSlidesItems(editor, slidesShapeId) {
  return getSlidesPages(editor.getShape(slidesShapeId), editor.getSortedChildIdsForParent(slidesShapeId).map(id => editor.getShape(id)).filter(Boolean))
}
function slidesShapeLocked(editor, id) {
  const seen = new Set()
  for (let shape = editor.getShape(id); shape && !seen.has(shape.id); shape = editor.getShape(shape.parentId)) {
    seen.add(shape.id)
    if (shape.isLocked) return true
  }
  return false
}
function layoutAiSlides(editor, slidesShapeId) {
  const slidesShape = editor.getShape(slidesShapeId)
  if (!isAiSlidesShape(slidesShape)) return false
  let updates
  try { updates = planSlidesLayout(slidesShape, getAiSlidesItems(editor, slidesShapeId)) }
  catch { return false }
  // Legacy timers must not turn a rejected locked layout into a partial one.
  if (updates.some(update => slidesShapeLocked(editor, update.id))) return false
  if (!updates.length) return false
  editor.updateShapes(updates)
  return true
}
function layoutAllAiSlides(editor) {
  for (const shape of editor.getCurrentPageShapes()) {
    if (isAiSlidesShape(shape)) layoutAiSlides(editor, shape.id)
  }
}
function adoptGeneratedAiSlidesItems() {
  // New generated pages are adopted by the editing transaction, which knows
  // whether their parent was explicit. The old timer has no such intent and
  // must not scan saved hints or pull copied/grouped descendants out of trees.
  // Keep its callback until the legacy App is retired; it performs no writes.
  return false
}
function normalizeAiDraftHolderLabels(editor) {
  const updates = editor
    .getCurrentPageShapes()
    .filter((shape) => isAiDraftHolderShape(shape) && !shape.props?.name)
    .map((shape) => ({
      id: shape.id,
      type: shape.type,
      props: { name: isAiFilmHolderShape(shape) ? AI_FILM_LABEL : AI_DRAFT_HOLDER_LABEL }
    }))
  if (updates.length) editor.updateShapes(updates)
}
function copySelectedCowartContent(editor, event) {
  if (!event.clipboardData || editor.getEditingShapeId() !== null) return false
  const content = editor.getContentFromCurrentPage(editor.getSelectedShapeIds())
  if (!content) return false
  const copiedContent = structuredClone(content)
  cowartCopiedContent.set(editor, copiedContent)
  const clipboardPayload = JSON.stringify({
    type: 'application/tldraw',
    kind: 'content',
    version: 2,
    data: copiedContent
  })
  event.clipboardData.setData('text/html', `<div data-tldraw>${clipboardPayload}</div>`)
  event.clipboardData.setData('text/plain', ' ')
  event.preventDefault()
  event.stopImmediatePropagation()
  return true
}
function rememberAiSlidesPasteTarget(editor) {
  const slidesShape = editor.getOnlySelectedShape()
  if (!isAiSlidesShape(slidesShape)) {
    cowartPendingSlidesPastes.delete(editor)
    return
  }
  cowartPendingSlidesPastes.set(editor, {
    slidesShapeId: slidesShape.id,
    existingShapeIds: new Set(editor.getCurrentPageShapeIds()),
    expiresAt: Date.now() + 5000
  })
}
function getPendingAiSlidesPaste(editor) {
  const pendingPaste = cowartPendingSlidesPastes.get(editor)
  if (!pendingPaste) return null
  if (pendingPaste.expiresAt >= Date.now()) return pendingPaste
  cowartPendingSlidesPastes.delete(editor)
  return null
}
function preparePastedItemForAiSlides(editor, shape, source) {
  if (source !== 'user' || !isAiSlidesItemShape(shape)) return shape
  const pendingPaste = getPendingAiSlidesPaste(editor)
  if (!pendingPaste || pendingPaste.existingShapeIds.has(shape.id)) return shape
  // Clipboard descendants may arrive before their new parent is in the Store.
  // Preserve that copied tree instead of pulling its pages into the source.
  if (shape.parentId?.startsWith('shape:') && !pendingPaste.existingShapeIds.has(shape.parentId)) return shape
  const slidesShape = editor.getShape(pendingPaste.slidesShapeId)
  if (!isAiSlidesShape(slidesShape)) {
    cowartPendingSlidesPastes.delete(editor)
    return shape
  }
  return {
    ...shape,
    parentId: slidesShape.id
  }
}
function normalizeCopiedSlidesHints(editor, roots, existingShapeIds) {
  const pending = roots.map(shape => shape.id), seen = new Set()
  while (pending.length) {
    const id = pending.pop()
    if (seen.has(id) || existingShapeIds.has(id)) continue
    seen.add(id)
    const shape = editor.getShape(id)
    if (!shape) continue
    pending.push(...editor.getSortedChildIdsForParent(id))
    if (!isAiSlidesItemShape(shape) || !Object.hasOwn(shape.meta, 'cowartAiSlidesParentShapeId')) continue
    const parent = editor.getShape(shape.parentId), meta = { ...shape.meta }
    if (isAiSlidesShape(parent)) {
      if (meta.cowartAiSlidesParentShapeId === parent.id) continue
      meta.cowartAiSlidesParentShapeId = parent.id
    } else delete meta.cowartAiSlidesParentShapeId
    // Public Store replacement removes only the stale hint, retaining all
    // other metadata and leaving geometry and the copied parent chain intact.
    editor.store.put([{ ...shape, meta }])
  }
}
function movePastedItemsIntoAiSlides(editor) {
  const pendingPaste = getPendingAiSlidesPaste(editor)
  if (!pendingPaste) return false
  const slidesShape = editor.getShape(pendingPaste.slidesShapeId)
  if (!isAiSlidesShape(slidesShape)) {
    cowartPendingSlidesPastes.delete(editor)
    return false
  }
  const pastedRoots = editor.getSelectedShapes().filter(shape => !pendingPaste.existingShapeIds.has(shape.id))
  if (!pastedRoots.length) return false
  const pastedItems = pastedRoots.filter(isAiSlidesItemShape)
  // Clear before writes, whose operationComplete callbacks can reenter here.
  cowartPendingSlidesPastes.delete(editor)
  editor.run(
    () => {
      const itemsToReparent = pastedItems.filter((shape) => shape.parentId !== slidesShape.id)
      if (itemsToReparent.length) {
        editor.reparentShapes(itemsToReparent.map((shape) => shape.id), slidesShape.id)
      }
      if (pastedItems.length) layoutAiSlides(editor, slidesShape.id)
    },
    { history: 'ignore' }
  )
  // Hint repairs belong to the existing paste entry, including mixed roots.
  // Ignoring them replays stale source hints on redo. Keep legacy geometry
  // history unchanged and do not add another history stopping point.
  editor.run(() => normalizeCopiedSlidesHints(editor, pastedRoots, pendingPaste.existingShapeIds), { history: 'record' })
  return pastedItems.length > 0
}
const cowartTldrawOptions = {
  maxPages: 1,
  onBeforeCopyToClipboard({ editor, content }) {
    cowartCopiedContent.set(editor, structuredClone(content))
  },
  onBeforePasteFromClipboard({ editor }) {
    rememberAiSlidesPasteTarget(editor)
  },
  onClipboardPasteRaw({ editor }) {
    const slidesShape = editor.getOnlySelectedShape()
    const copiedContent = cowartCopiedContent.get(editor)
    if (!isAiSlidesShape(slidesShape) || !copiedContent) return
    rememberAiSlidesPasteTarget(editor)
    editor.markHistoryStoppingPoint('paste')
    editor.putContentOntoCurrentPage(structuredClone(copiedContent), { select: true })
    return false
  }
}
export { getAiSlidesItems, layoutAiSlides, layoutAllAiSlides, adoptGeneratedAiSlidesItems, normalizeAiDraftHolderLabels, copySelectedCowartContent, rememberAiSlidesPasteTarget, getPendingAiSlidesPaste, preparePastedItemForAiSlides, movePastedItemsIntoAiSlides, cowartTldrawOptions }
