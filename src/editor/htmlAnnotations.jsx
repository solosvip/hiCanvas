// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { Box, createShapeId } from "tldraw"
import { saveCowartReferenceImage } from "../cowartClient.js"
import { saveCowartEditorSnapshot } from "../cowartCanvasSave.js"
import { ANNOTATION_EDIT_EXPORT_PADDING, AI_SLIDES_LABEL, AI_SLIDES_DEFAULT_W, AI_SLIDES_DEFAULT_H, AI_SLIDES_ANNOTATION_EDIT_PROMPT, AI_IMAGE_HOLDER_DEFAULT_W, AI_IMAGE_HOLDER_DEFAULT_H, HTML_DRAFT_ANNOTATION_EDIT_PROMPT, HTML_DRAFT_ANNOTATION_IMAGE_PROMPT } from './configuration.jsx'
import { expandBox, collectHtmlDraftAnnotationShapeIds, getAnnotationEditExportPixelRatio, collectAiSlidesAnnotationShapeIds, dataUrlToImageContent, followUpSender, supportsCowartMessageImages } from './annotationRequests.jsx'
import { loadRasterImage, renderCowartHtmlDraftCanvas, getCowartHtmlDraftLocalPath, getCowartHtmlDraftAssetUrl } from './htmlCapture.jsx'
import { isCowartHtmlDraftEmbedShape, isAiSlidesShape } from './holderMeta.jsx'
import { getAiSlidesItems } from './slidesLayout.jsx'
import { createAiSlidesShape } from './holderCreation.jsx'
async function exportCowartHtmlDraftAnnotationScreenshot(editor, draftShapeId) {
  const shapeIds = collectHtmlDraftAnnotationShapeIds(editor, draftShapeId)
  const draftShape = editor.getShape(draftShapeId)
  const rawBounds = editor.getShapesPageBounds(shapeIds)
  if (!draftShape || !rawBounds) throw new Error('无法计算 HTML 草稿截图范围。')
  const exportBounds = expandBox(rawBounds, ANNOTATION_EDIT_EXPORT_PADDING)
  const pixelRatio = getAnnotationEditExportPixelRatio(exportBounds)
  const draftCapture = await renderCowartHtmlDraftCanvas(draftShape, pixelRatio)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(exportBounds.w * pixelRatio))
  canvas.height = Math.max(1, Math.round(exportBounds.h * pixelRatio))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建标注截图。')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const pageTransform = editor.getShapePageTransform(draftShapeId)
  if (!pageTransform) throw new Error('无法读取 HTML 草稿的画布变换。')
  context.setTransform(
    pixelRatio * pageTransform.a,
    pixelRatio * pageTransform.b,
    pixelRatio * pageTransform.c,
    pixelRatio * pageTransform.d,
    pixelRatio * (pageTransform.e - exportBounds.x),
    pixelRatio * (pageTransform.f - exportBounds.y)
  )
  context.drawImage(
    draftCapture.canvas,
    0,
    0,
    Number(draftShape.props.w) || draftCapture.displayWidth,
    Number(draftShape.props.h) || draftCapture.displayHeight
  )
  const annotationShapeIds = shapeIds.filter((shapeId) => shapeId !== draftShapeId)
  if (annotationShapeIds.length) {
    const overlay = await editor.toImageDataUrl(annotationShapeIds, {
      bounds: exportBounds,
      background: false,
      darkMode: false,
      format: 'png',
      padding: 0,
      pixelRatio
    })
    const overlayImage = await loadRasterImage(overlay.url)
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.drawImage(overlayImage, 0, 0, canvas.width, canvas.height)
  }
  return {
    url: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    shapeIds
  }
}
async function exportCowartSlidesAnnotationScreenshot(editor, slidesShapeId) {
  const shapeIds = collectAiSlidesAnnotationShapeIds(editor, slidesShapeId)
  const slidesShape = editor.getShape(slidesShapeId)
  const rawBounds = editor.getShapesPageBounds(shapeIds)
  if (!slidesShape || !rawBounds) throw new Error('无法计算 AI Slides 标注截图范围。')
  const exportBounds = expandBox(rawBounds, ANNOTATION_EDIT_EXPORT_PADDING)
  const pixelRatio = getAnnotationEditExportPixelRatio(exportBounds)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(exportBounds.w * pixelRatio))
  canvas.height = Math.max(1, Math.round(exportBounds.h * pixelRatio))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建 AI Slides 标注截图。')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const slidesCapture = await editor.toImageDataUrl([slidesShapeId], {
    bounds: exportBounds,
    background: false,
    darkMode: false,
    format: 'png',
    padding: 0,
    pixelRatio
  })
  context.drawImage(await loadRasterImage(slidesCapture.url), 0, 0, canvas.width, canvas.height)
  for (const item of getAiSlidesItems(editor, slidesShapeId)) {
    if (!isCowartHtmlDraftEmbedShape(item)) continue
    const htmlCapture = await renderCowartHtmlDraftCanvas(item, pixelRatio)
    const pageTransform = editor.getShapePageTransform(item.id)
    if (!pageTransform) continue
    context.setTransform(
      pixelRatio * pageTransform.a,
      pixelRatio * pageTransform.b,
      pixelRatio * pageTransform.c,
      pixelRatio * pageTransform.d,
      pixelRatio * (pageTransform.e - exportBounds.x),
      pixelRatio * (pageTransform.f - exportBounds.y)
    )
    context.drawImage(
      htmlCapture.canvas,
      0,
      0,
      Number(item.props.w) || htmlCapture.displayWidth,
      Number(item.props.h) || htmlCapture.displayHeight
    )
  }
  const annotationShapeIds = shapeIds.filter((shapeId) => shapeId !== slidesShapeId)
  if (annotationShapeIds.length) {
    const annotationOverlay = await editor.toImageDataUrl(annotationShapeIds, {
      bounds: exportBounds,
      background: false,
      darkMode: false,
      format: 'png',
      padding: 0,
      pixelRatio
    })
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.drawImage(await loadRasterImage(annotationOverlay.url), 0, 0, canvas.width, canvas.height)
  }
  return {
    url: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    shapeIds
  }
}
function aiSlidesAnnotationScreenshotFileName() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `ai-slides-annotation-edit-${timestamp}.png`
}
function createAiSlidesBelowSource(editor, sourceSlidesShape) {
  const sourceBounds = editor.getShapePageBounds(sourceSlidesShape.id)
  if (!sourceBounds) throw new Error('无法读取原 AI Slides 的画布位置。')
  const width = Math.max(AI_SLIDES_DEFAULT_W, Number(sourceSlidesShape.props?.w) || AI_SLIDES_DEFAULT_W)
  const height = Math.max(AI_SLIDES_DEFAULT_H, Number(sourceSlidesShape.props?.h) || AI_SLIDES_DEFAULT_H)
  const margin = 80
  const pageId = editor.getCurrentPageId()
  const obstacles = editor
    .getCurrentPageShapes()
    .filter((shape) => shape.parentId === pageId && shape.id !== sourceSlidesShape.id)
    .map((shape) => editor.getShapePageBounds(shape.id))
    .filter(Boolean)
  let x = sourceBounds.x
  let y = sourceBounds.maxY + margin
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const candidate = new Box(x, y, width, height)
    if (!obstacles.some((bounds) => candidate.collides(bounds))) break
    y += height + margin
  }
  const slidesShapeId = createShapeId()
  createAiSlidesShape(editor, slidesShapeId, {
    x,
    y,
    meta: {
      cowartGeneratedFromAiSlidesAnnotation: true,
      cowartSourceAiSlidesShapeId: sourceSlidesShape.id
    },
    props: {
      w: width,
      h: height,
      name: AI_SLIDES_LABEL
    }
  })
  return slidesShapeId
}
function buildAiSlidesAnnotationEditPrompt({
  sourceSlidesShape,
  targetSlidesShapeId,
  sourceItems,
  exportResult,
  screenshotAsset
}) {
  const pageCount = sourceItems.length
  const annotationCount = Math.max(0, exportResult.shapeIds.length - 1)
  const sourcePageLines = sourceItems.flatMap((item, index) => {
    if (isCowartHtmlDraftEmbedShape(item)) {
      const assetPath = getCowartHtmlDraftLocalPath(item)
      return [`${index + 1}. HTML shape ${item.id}${assetPath ? ` — ${assetPath}` : ''}`]
    }
    return [`${index + 1}. Image shape ${item.id}`]
  })
  return [
    AI_SLIDES_ANNOTATION_EDIT_PROMPT,
    '',
    `Cowart source AI Slides frame: ${sourceSlidesShape.id}`,
    `Cowart target AI Slides frame below source: ${targetSlidesShapeId}`,
    `Required page count: exactly ${pageCount}.`,
    `Included annotation shapes: ${annotationCount}`,
    `Screenshot size: ${exportResult.width}x${exportResult.height}`,
    ...(screenshotAsset?.assetPath
      ? [
          `Annotation screenshot local path: ${screenshotAsset.assetPath}`,
          'Use this screenshot as the authoritative visual reference and annotation brief.'
        ]
      : []),
    'Source pages in order:',
    ...sourcePageLines,
    '',
    'Required tool calls after generating the revised HTML pages:',
    `- Call insert_cowart_html_draft exactly ${pageCount} times, once per page, in page order.`,
    `- For every call set draftShapeId to "${targetSlidesShapeId}".`,
    '- Set replaceDraftHolder: false, updateExistingDraft: false, matchAnchor: false, displayWidth: 1024, and displayHeight: 576.',
    `- Set shapeMeta.cowartAiSlidesParentShapeId to "${targetSlidesShapeId}".`,
    `- Set shapeMeta.cowartAiSlidesGeneratedFromAnnotation to true and shapeMeta.cowartAiSlidesSourceShapeId to "${sourceSlidesShape.id}".`,
    `- Set shapeMeta.cowartAiSlidesGeneratedPageCount to ${pageCount}, and shapeMeta.cowartAiSlidesGeneratedPage to the 1-based page number.`,
    '- Use unique ordered file names such as revised-slide-01.html, revised-slide-02.html, and so on.',
    '- Keep the source Slides, source page assets, and annotations unchanged.',
    '- The target Slides already exists below the source; do not create another frame and do not place pages beside the source.'
  ].join('\n')
}
async function sendAiSlidesAnnotationEditRequest(editor, slidesShapeId) {
  const sender = followUpSender()
  if (!sender) throw new Error('当前 Cowart 画布没有可用的 Codex MCP 消息桥。')
  const sourceSlidesShape = editor.getShape(slidesShapeId)
  const sourceItems = getAiSlidesItems(editor, slidesShapeId)
  if (!isAiSlidesShape(sourceSlidesShape) || !sourceItems.length) {
    throw new Error('请选择一个已有内容的 AI Slides。')
  }
  const exportResult = await exportCowartSlidesAnnotationScreenshot(editor, slidesShapeId)
  const screenshotAsset = await saveCowartReferenceImage({
    anchorShapeId: slidesShapeId,
    fileName: aiSlidesAnnotationScreenshotFileName(),
    dataUrl: exportResult.url,
    mimeType: 'image/png'
  })
  const targetSlidesShapeId = createAiSlidesBelowSource(editor, sourceSlidesShape)
  try {
    const saveResult = await saveCowartEditorSnapshot(editor)
    if (saveResult?.ok === false) throw new Error(saveResult.message || '新的 AI Slides 保存失败。')
    const prompt = buildAiSlidesAnnotationEditPrompt({
      sourceSlidesShape,
      targetSlidesShapeId,
      sourceItems,
      exportResult,
      screenshotAsset
    })
    const content = [{ type: 'text', text: prompt }]
    if (supportsCowartMessageImages()) {
      content.push(
        dataUrlToImageContent(exportResult.url, {
          cowartAiSlidesAnnotation: true,
          cowartSourceAiSlidesShapeId: slidesShapeId,
          cowartTargetAiSlidesShapeId: targetSlidesShapeId,
          cowartIncludedShapeIds: exportResult.shapeIds,
          cowartAnnotationScreenshotPath: screenshotAsset.assetPath || null,
          cowartAnnotationScreenshotFileName: screenshotAsset.fileName || null
        })
      )
    }
    return await sender(
      { prompt, content },
      {
        promptType: 'slides_annotation_edit',
        aiType: 'slides',
        hasReference: true,
        pageCount: sourceItems.length
      }
    )
  } catch (error) {
    editor.deleteShapes([targetSlidesShapeId])
    await saveCowartEditorSnapshot(editor)
    throw error
  }
}
function htmlDraftAnnotationScreenshotFileName(mode) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `html-draft-annotation-${mode}-${timestamp}.png`
}
function buildHtmlDraftAnnotationEditPrompt({ draftShape, exportResult, screenshotAsset }) {
  const assetUrl = getCowartHtmlDraftAssetUrl(draftShape)
  const assetPath = getCowartHtmlDraftLocalPath(draftShape)
  const annotationCount = Math.max(0, exportResult.shapeIds.length - 1)
  const targetWidth = Math.round(Number(draftShape.props.w) || AI_IMAGE_HOLDER_DEFAULT_W)
  const targetHeight = Math.round(Number(draftShape.props.h) || AI_IMAGE_HOLDER_DEFAULT_H)
  return [
    HTML_DRAFT_ANNOTATION_EDIT_PROMPT,
    '',
    `Cowart HTML draft shape: ${draftShape.id}`,
    `HTML draft asset URL: ${assetUrl || 'unavailable'}`,
    ...(assetPath ? [`HTML draft local path: ${assetPath}`] : []),
    `Included annotation shapes: ${annotationCount}`,
    `Screenshot size: ${exportResult.width}x${exportResult.height}`,
    ...(screenshotAsset?.assetPath
      ? [
          `Annotation screenshot local path: ${screenshotAsset.assetPath}`,
          'Use this screenshot as the authoritative source for the annotation requests.'
        ]
      : []),
    '',
    'Required completion step:',
    `- Call insert_cowart_html_draft with draftShapeId: "${draftShape.id}", updateExistingDraft: false, replaceDraftHolder: false, placement: "right", margin: 40, matchAnchor: true, displayWidth: ${targetWidth}, and displayHeight: ${targetHeight}.`,
    '- Pass the final complete HTML document as htmlContent.',
    '- Use a new short .html fileName; do not overwrite the original HTML asset.',
    '- Keep the original draft shape and annotations unchanged. The returned shapeId must be a new shape placed to the right.',
    '- If this already-open Codex task does not expose updateExistingDraft yet, omit that argument but still pass replaceDraftHolder: false, placement: "right", margin: 40, matchAnchor: true, displayWidth and displayHeight. Never edit the original HTML file or original shape record.'
  ].join('\n')
}
function buildHtmlDraftAnnotationImagePrompt({ draftShape, exportResult, screenshotAsset }) {
  const targetWidth = Math.round(Number(draftShape.props.w) || AI_IMAGE_HOLDER_DEFAULT_W)
  const targetHeight = Math.round(Number(draftShape.props.h) || AI_IMAGE_HOLDER_DEFAULT_H)
  const ratio = targetHeight ? targetWidth / targetHeight : 1
  const annotationCount = Math.max(0, exportResult.shapeIds.length - 1)
  return [
    HTML_DRAFT_ANNOTATION_IMAGE_PROMPT,
    '',
    `Cowart HTML draft shape: ${draftShape.id}`,
    `Target canvas image size: ${targetWidth} x ${targetHeight} canvas units.`,
    `Target aspect ratio: ${targetWidth}:${targetHeight} (${ratio.toFixed(3)} width/height).`,
    `Included annotation shapes: ${annotationCount}`,
    `Screenshot size: ${exportResult.width}x${exportResult.height}`,
    ...(screenshotAsset?.assetPath
      ? [
          `Annotation screenshot local path: ${screenshotAsset.assetPath}`,
          'Use this screenshot as the authoritative visual input for image generation.'
        ]
      : []),
    '',
    'Required placement after imagegen:',
    `- Call insert_cowart_image with anchorShapeId: "${draftShape.id}", placement: "right", margin: 40, matchAnchor: true, displayWidth: ${targetWidth}, and displayHeight: ${targetHeight}.`,
    '- Leave replaceAiImageHolder false or unset; this HTML draft is the source anchor and must remain unchanged.',
    '- Set shapeMeta.cowartGeneratedFromHtmlDraftAnnotation to true.'
  ].join('\n')
}
async function sendHtmlDraftAnnotationRequest(editor, draftShapeId, mode) {
  const sender = followUpSender()
  if (!sender) throw new Error('当前 Cowart 画布没有可用的 Codex MCP 消息桥。')
  const draftShape = editor.getShape(draftShapeId)
  if (!isCowartHtmlDraftEmbedShape(draftShape)) {
    throw new Error('请选择一个已生成 HTML 的 AI HTML。')
  }
  const exportResult = await exportCowartHtmlDraftAnnotationScreenshot(editor, draftShapeId)
  const screenshotAsset = await saveCowartReferenceImage({
    anchorShapeId: draftShapeId,
    fileName: htmlDraftAnnotationScreenshotFileName(mode),
    dataUrl: exportResult.url,
    mimeType: 'image/png'
  })
  const prompt =
    mode === 'edit'
      ? buildHtmlDraftAnnotationEditPrompt({ draftShape, exportResult, screenshotAsset })
      : buildHtmlDraftAnnotationImagePrompt({ draftShape, exportResult, screenshotAsset })
  const content = [{ type: 'text', text: prompt }]
  if (supportsCowartMessageImages()) {
    content.push(
      dataUrlToImageContent(exportResult.url, {
        cowartHtmlDraftAnnotation: true,
        cowartHtmlDraftAnnotationMode: mode,
        cowartSourceHtmlDraftShapeId: draftShapeId,
        cowartIncludedShapeIds: exportResult.shapeIds,
        cowartAnnotationScreenshotPath: screenshotAsset.assetPath || null,
        cowartAnnotationScreenshotFileName: screenshotAsset.fileName || null
      })
    )
  }
  return sender(
    { prompt, content },
    {
      promptType: mode === 'edit' ? 'html_annotation_edit' : 'html_annotation_image',
      aiType: mode === 'edit' ? 'html' : 'image',
      hasReference: true
    }
  )
}
export { exportCowartHtmlDraftAnnotationScreenshot, exportCowartSlidesAnnotationScreenshot, aiSlidesAnnotationScreenshotFileName, createAiSlidesBelowSource, buildAiSlidesAnnotationEditPrompt, sendAiSlidesAnnotationEditRequest, htmlDraftAnnotationScreenshotFileName, buildHtmlDraftAnnotationEditPrompt, buildHtmlDraftAnnotationImagePrompt, sendHtmlDraftAnnotationRequest }
