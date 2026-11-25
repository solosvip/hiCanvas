// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { Box } from "tldraw"
import { sendTrackedWidgetMessage } from "../analytics.js"
import { sendCanvasAgentRequest } from '../agentBridge.js'
import { ANNOTATION_EDIT_NEAR_MARGIN_MIN, ANNOTATION_EDIT_NEAR_MARGIN_MAX, ANNOTATION_EDIT_COLORS, ANNOTATION_EDIT_RELATED_TEXT_MARGIN, ANNOTATION_EDIT_PROMPT, AI_IMAGE_HOLDER_DEFAULT_W, AI_IMAGE_HOLDER_DEFAULT_H, ANNOTATION_HTML_PROMPT, ANNOTATION_EDIT_MAX_EXPORT_DIMENSION, ANNOTATION_EDIT_MAX_EXPORT_PIXELS, ANNOTATION_EDIT_EXPORT_PADDING } from './configuration.jsx'
import { isImageShape, isCowartHtmlDraftEmbedShape, isAiSlidesShape } from './holderMeta.jsx'
function expandBox(bounds, padding) {
  return new Box(
    bounds.x - padding,
    bounds.y - padding,
    bounds.w + padding * 2,
    bounds.h + padding * 2
  )
}
function annotationEditNearMargin(targetBounds) {
  return Math.min(
    ANNOTATION_EDIT_NEAR_MARGIN_MAX,
    Math.max(ANNOTATION_EDIT_NEAR_MARGIN_MIN, Math.max(targetBounds.w, targetBounds.h))
  )
}
function shapeHasAnnotationColor(shape) {
  const color = shape?.props?.color
  const labelColor = shape?.props?.labelColor
  return ANNOTATION_EDIT_COLORS.has(color) || ANNOTATION_EDIT_COLORS.has(labelColor)
}
function isAnnotationArrowShape(shape) {
  return shape?.type === 'arrow' && (shape.meta?.cowartAnnotationArrow === true || shapeHasAnnotationColor(shape))
}
function isAnnotationTextShape(shape) {
  return shape?.type === 'text' && (shape.meta?.cowartAnnotationText === true || shapeHasAnnotationColor(shape))
}
function uniqueShapeIds(shapeIds) {
  return Array.from(new Set(shapeIds.filter(Boolean)))
}
function collectAnnotationTargetShapeIds(editor, targetShapeId, isTargetShape, invalidTargetMessage) {
  const targetShape = editor.getShape(targetShapeId)
  if (!isTargetShape(targetShape)) {
    throw new Error(invalidTargetMessage)
  }
  const targetBounds = editor.getShapePageBounds(targetShapeId)
  if (!targetBounds) {
    throw new Error('无法读取当前内容的画布位置。')
  }
  const nearBounds = expandBox(targetBounds, annotationEditNearMargin(targetBounds))
  const relatedArrowIds = []
  const relatedArrowBounds = []
  const relatedTextIds = []
  for (const shape of editor.getCurrentPageShapesSorted()) {
    if (!shape || shape.id === targetShapeId) continue
    const bounds = editor.getShapePageBounds(shape)
    if (!bounds) continue
    if (isAnnotationArrowShape(shape) && nearBounds.collides(bounds)) {
      relatedArrowIds.push(shape.id)
      relatedArrowBounds.push(bounds)
      continue
    }
    if (!isAnnotationTextShape(shape)) continue
    if (nearBounds.collides(bounds)) {
      relatedTextIds.push(shape.id)
      continue
    }
    if (
      relatedArrowBounds.some((arrowBounds) =>
        expandBox(arrowBounds, ANNOTATION_EDIT_RELATED_TEXT_MARGIN).collides(bounds)
      )
    ) {
      relatedTextIds.push(shape.id)
    }
  }
  return uniqueShapeIds([targetShapeId, ...relatedArrowIds, ...relatedTextIds])
}
function collectAnnotationEditShapeIds(editor, imageShapeId) {
  return collectAnnotationTargetShapeIds(
    editor,
    imageShapeId,
    isImageShape,
    '请选择一张图片后再按标注修改。'
  )
}
function collectHtmlDraftAnnotationShapeIds(editor, draftShapeId) {
  return collectAnnotationTargetShapeIds(
    editor,
    draftShapeId,
    isCowartHtmlDraftEmbedShape,
    '请选择一个已生成网页的 AI 网页。'
  )
}
function collectAiSlidesAnnotationShapeIds(editor, slidesShapeId) {
  return collectAnnotationTargetShapeIds(
    editor,
    slidesShapeId,
    isAiSlidesShape,
    '请选择一个已有内容的 AI 幻灯片。'
  )
}
function buildAnnotationEditPrompt({ imageShapeId, shapeIds, exportWidth, exportHeight, screenshotAsset }) {
  const annotationCount = Math.max(0, shapeIds.length - 1)
  const lines = [
    ANNOTATION_EDIT_PROMPT,
    '',
    `Cowart source image shape: ${imageShapeId}`,
    `Included annotation shapes: ${annotationCount}`,
    `Screenshot size: ${Math.round(exportWidth)}x${Math.round(exportHeight)}`
  ]
  if (screenshotAsset?.assetPath) {
    lines.push(
      `Annotation screenshot local path: ${screenshotAsset.assetPath}`,
      'Use this local screenshot file as the authoritative visual reference for the requested edits.'
    )
  }
  return lines.join('\n')
}
function buildAnnotationHtmlPrompt({ imageShape, shapeIds, exportWidth, exportHeight, screenshotAsset }) {
  const targetWidth = Math.round(Number(imageShape.props?.w) || AI_IMAGE_HOLDER_DEFAULT_W)
  const targetHeight = Math.round(Number(imageShape.props?.h) || AI_IMAGE_HOLDER_DEFAULT_H)
  const ratio = targetHeight ? targetWidth / targetHeight : 1
  const annotationCount = Math.max(0, shapeIds.length - 1)
  return [
    ANNOTATION_HTML_PROMPT,
    '',
    `Cowart source image shape: ${imageShape.id}`,
    `Target canvas HTML size: ${targetWidth} x ${targetHeight} canvas units.`,
    `Target aspect ratio: ${targetWidth}:${targetHeight} (${ratio.toFixed(3)} width/height).`,
    `Included annotation shapes: ${annotationCount}`,
    `Screenshot size: ${Math.round(exportWidth)}x${Math.round(exportHeight)}`,
    ...(screenshotAsset?.assetPath
      ? [
          `Annotation screenshot local path: ${screenshotAsset.assetPath}`,
          'Use this local screenshot as the authoritative visual reference and annotation brief.'
        ]
      : []),
    '',
    'Required completion step:',
    `- Call insert_cowart_html_draft with anchorShapeId: "${imageShape.id}", replaceDraftHolder: false, placement: "right", margin: 40, matchAnchor: true, displayWidth: ${targetWidth}, and displayHeight: ${targetHeight}.`,
    '- Pass the final complete HTML document as htmlContent.',
    '- Use a new short .html fileName that describes the result.',
    '- Do not pass draftShapeId for the source image and do not update or replace any existing shape.',
    '- Set shapeMeta.cowartGeneratedFromImageAnnotationHtml to true.',
    '- The returned shapeId must be a new HTML draft shape placed to the right of the source image.'
  ].join('\n')
}
function getAnnotationEditExportPixelRatio(bounds) {
  const maxDimension = Math.max(bounds.w, bounds.h)
  if (maxDimension > 1600) return 1
  if (maxDimension > 1000) return 1.5
  return 2
}
function getAnnotationEditExportSize(exportBounds) {
  const pixelRatio = getAnnotationEditExportPixelRatio(exportBounds)
  return {
    pixelRatio,
    width: Math.max(1, Math.round(exportBounds.w * pixelRatio)),
    height: Math.max(1, Math.round(exportBounds.h * pixelRatio))
  }
}
function isAnnotationEditExportTooLarge({ width, height }) {
  return (
    Math.max(width, height) > ANNOTATION_EDIT_MAX_EXPORT_DIMENSION ||
    width * height > ANNOTATION_EDIT_MAX_EXPORT_PIXELS
  )
}
function prepareAnnotationEditRequest(editor, imageShapeId) {
  const shapeIds = collectAnnotationEditShapeIds(editor, imageShapeId)
  const rawBounds = editor.getShapesPageBounds(shapeIds)
  if (!rawBounds) throw new Error('无法计算截图范围。')
  const exportBounds = expandBox(rawBounds, ANNOTATION_EDIT_EXPORT_PADDING)
  return {
    shapeIds,
    exportBounds,
    exportSize: getAnnotationEditExportSize(exportBounds)
  }
}
function annotationEditScreenshotFileName() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `annotation-edit-${timestamp}.png`
}
function annotationHtmlScreenshotFileName() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `image-annotation-html-${timestamp}.png`
}
function dataUrlToImageContent(dataUrl, meta = {}) {
  const match = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) {
    throw new Error('导出的截图不是有效的图片 data URL。')
  }
  return {
    type: 'image',
    data: match[2],
    mimeType: match[1],
    _meta: meta
  }
}
function followUpSender() {
  let sendMessage = null
  if (typeof window.cowartMcp?.sendFollowUpMessage === 'function') {
    sendMessage = (message) => window.cowartMcp.sendFollowUpMessage(message)
  } else if (typeof window.openai?.sendFollowUpMessage === 'function') {
    sendMessage = (message) => window.openai.sendFollowUpMessage(message)
  }
  if (!sendMessage) return sendCanvasAgentRequest
  return (message, analyticsContext = {}) =>
    sendTrackedWidgetMessage(sendMessage, message, analyticsContext)
}
function cowartHostCapabilities() {
  try {
    return (
      window.cowartMcp?.getHostCapabilities?.() ||
      window.openai?.hostCapabilities ||
      globalThis.__COWART_MCP_APP__?.getHostCapabilities?.() ||
      null
    )
  } catch (_error) {
    return null
  }
}
function supportsCowartMessageImages() {
  return !window.cowartMcp || Boolean(cowartHostCapabilities()?.message?.image)
}
export { expandBox, annotationEditNearMargin, shapeHasAnnotationColor, isAnnotationArrowShape, isAnnotationTextShape, uniqueShapeIds, collectAnnotationTargetShapeIds, collectAnnotationEditShapeIds, collectHtmlDraftAnnotationShapeIds, collectAiSlidesAnnotationShapeIds, buildAnnotationEditPrompt, buildAnnotationHtmlPrompt, getAnnotationEditExportPixelRatio, getAnnotationEditExportSize, isAnnotationEditExportTooLarge, prepareAnnotationEditRequest, annotationEditScreenshotFileName, annotationHtmlScreenshotFileName, dataUrlToImageContent, followUpSender, cowartHostCapabilities, supportsCowartMessageImages }
