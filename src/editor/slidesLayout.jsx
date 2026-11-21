// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { isAiSlidesItemShape, isAiSlidesShape, isAiDraftHolderShape, isAiFilmHolderShape } from './holderMeta.jsx'
import { AI_SLIDES_GAP, AI_SLIDES_PADDING, AI_SLIDES_DEFAULT_W, AI_SLIDES_DEFAULT_H, AI_DRAFT_HOLDER_LABEL, AI_FILM_LABEL } from './configuration.jsx'
import { cowartCopiedContent, cowartPendingSlidesPastes } from './assets.jsx'
function getAiSlidesItems(editor, slidesShapeId) {
  return editor
    .getSortedChildIdsForParent(slidesShapeId)
    .map((shapeId) => editor.getShape(shapeId))
    .filter(isAiSlidesItemShape)
    .sort((a, b) => {
      const aCenter = Number(a.x) + Number(a.props?.w || 0) / 2
      const bCenter = Number(b.x) + Number(b.props?.w || 0) / 2
      return aCenter - bCenter
    })
}
function layoutAiSlides(editor, slidesShapeId) {
  const slidesShape = editor.getShape(slidesShapeId)
  if (!isAiSlidesShape(slidesShape)) return false
  const items = getAiSlidesItems(editor, slidesShapeId)
  if (!items.length) return false
  const padding = Number(slidesShape.meta?.cowartAiSlidesPadding) || AI_SLIDES_PADDING
  const gap = Number(slidesShape.meta?.cowartAiSlidesGap) || AI_SLIDES_GAP
  let cursorX = padding
  let maxHeight = 0
  const updates = []
  for (const item of items) {
    const width = Math.max(1, Number(item.props?.w) || 1)
    const height = Math.max(1, Number(item.props?.h) || 1)
    maxHeight = Math.max(maxHeight, height)
    if (Math.abs(item.x - cursorX) > 0.01 || Math.abs(item.y - padding) > 0.01 || item.rotation !== 0) {
      updates.push({ id: item.id, type: item.type, x: cursorX, y: padding, rotation: 0 })
    }
    cursorX += width + gap
  }
  const nextWidth = Math.max(AI_SLIDES_DEFAULT_W, cursorX - gap + padding)
  const nextHeight = Math.max(AI_SLIDES_DEFAULT_H, maxHeight + padding * 2)
  if (
    Math.abs(Number(slidesShape.props.w) - nextWidth) > 0.01 ||
    Math.abs(Number(slidesShape.props.h) - nextHeight) > 0.01
  ) {
    updates.push({
      id: slidesShape.id,
      type: 'frame',
      props: { w: nextWidth, h: nextHeight }
    })
  }
  if (!updates.length) return false
  editor.updateShapes(updates)
  return true
}
function layoutAllAiSlides(editor) {
  for (const shape of editor.getCurrentPageShapes()) {
    if (isAiSlidesShape(shape)) layoutAiSlides(editor, shape.id)
  }
}
function adoptGeneratedAiSlidesItems(editor) {
  const itemsBySlides = new Map()
  for (const shape of editor.getCurrentPageShapes()) {
    if (!isAiSlidesItemShape(shape)) continue
    const slidesShapeId = shape.meta?.cowartAiSlidesParentShapeId
    const slidesShape = slidesShapeId ? editor.getShape(slidesShapeId) : null
    if (!isAiSlidesShape(slidesShape) || shape.parentId === slidesShapeId) continue
    const itemIds = itemsBySlides.get(slidesShapeId) ?? []
    itemIds.push(shape.id)
    itemsBySlides.set(slidesShapeId, itemIds)
  }
  for (const [slidesShapeId, itemIds] of itemsBySlides) {
    editor.reparentShapes(itemIds, slidesShapeId)
  }
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
function movePastedItemsIntoAiSlides(editor) {
  const pendingPaste = getPendingAiSlidesPaste(editor)
  if (!pendingPaste) return false
  const slidesShape = editor.getShape(pendingPaste.slidesShapeId)
  if (!isAiSlidesShape(slidesShape)) {
    cowartPendingSlidesPastes.delete(editor)
    return false
  }
  const pastedItems = editor.getSelectedShapes().filter((shape) =>
    isAiSlidesItemShape(shape) &&
    !pendingPaste.existingShapeIds.has(shape.id)
  )
  if (!pastedItems.length) return false
  editor.run(
    () => {
      const itemsToReparent = pastedItems.filter((shape) => shape.parentId !== slidesShape.id)
      if (itemsToReparent.length) {
        editor.reparentShapes(itemsToReparent.map((shape) => shape.id), slidesShape.id)
      }
      layoutAiSlides(editor, slidesShape.id)
    },
    { history: 'ignore' }
  )
  cowartPendingSlidesPastes.delete(editor)
  return true
}
const cowartTldrawOptions = {
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
