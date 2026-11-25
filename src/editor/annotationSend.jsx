// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { generateOnCanvas } from '../image-models/canvasImages.js'
import { hasCowartWidgetBridge, saveCowartReferenceImage } from "../cowartClient.js"
import { buildAnnotationEditPrompt, annotationEditScreenshotFileName, dataUrlToImageContent, followUpSender, supportsCowartMessageImages, expandBox, collectAnnotationEditShapeIds, buildAnnotationHtmlPrompt, getAnnotationEditExportPixelRatio, annotationHtmlScreenshotFileName } from './annotationRequests.jsx'
import { ANNOTATION_EDIT_EXPORT_PADDING } from './configuration.jsx'
import { isImageShape } from './holderMeta.jsx'
async function sendAnnotationEditRequest(editor, imageShapeId, request) {
  const pageId = editor.getCurrentPageId()
  const { shapeIds, exportBounds, exportSize } = request
  const exportResult = await editor.toImageDataUrl(shapeIds, {
    bounds: exportBounds,
    background: true,
    darkMode: false,
    format: 'png',
    padding: 0,
    pixelRatio: exportSize.pixelRatio
  })
  if (!hasCowartWidgetBridge()) {
    return generateOnCanvas(editor, {
      anchorId: imageShapeId, beside: true, pageId,
      prompt: '根据图片中的文字和箭头标注意见修改原图。标注仅是修改指令，结果中不要保留这些箭头、文字和画布边缘。保留未要求修改的内容。',
      references: [exportResult.url]
    })
  }
  const screenshotAsset = await saveCowartReferenceImage({
    anchorShapeId: imageShapeId,
    fileName: annotationEditScreenshotFileName(),
    dataUrl: exportResult.url,
    mimeType: 'image/png'
  })
  const prompt = buildAnnotationEditPrompt({
    imageShapeId,
    shapeIds,
    exportWidth: exportResult.width,
    exportHeight: exportResult.height,
    screenshotAsset
  })
  const sender = followUpSender()
  if (!sender) {
    throw new Error('当前 Cowart 画布没有可用的 Codex MCP 消息桥。')
  }
  const content = [{ type: 'text', text: prompt }]
  if (supportsCowartMessageImages()) {
    content.push(
      dataUrlToImageContent(exportResult.url, {
        cowartAnnotationEdit: true,
        cowartSourceImageShapeId: imageShapeId,
        cowartIncludedShapeIds: shapeIds,
        cowartAnnotationScreenshotPath: screenshotAsset.assetPath || null,
        cowartAnnotationScreenshotFileName: screenshotAsset.fileName || null
      })
    )
  }
  return sender(
    { prompt, content },
    { promptType: 'annotation_edit', hasReference: true }
  )
}
async function sendAnnotationHtmlRequest(editor, imageShapeId) {
  const imageShape = editor.getShape(imageShapeId)
  if (!isImageShape(imageShape)) throw new Error('请选择一张图片后再按标注生成网页。')
  const shapeIds = collectAnnotationEditShapeIds(editor, imageShapeId)
  const rawBounds = editor.getShapesPageBounds(shapeIds)
  if (!rawBounds) throw new Error('无法计算截图范围。')
  const exportBounds = expandBox(rawBounds, ANNOTATION_EDIT_EXPORT_PADDING)
  const exportResult = await editor.toImageDataUrl(shapeIds, {
    bounds: exportBounds,
    background: true,
    darkMode: false,
    format: 'png',
    padding: 0,
    pixelRatio: getAnnotationEditExportPixelRatio(exportBounds)
  })
  const screenshotAsset = await saveCowartReferenceImage({
    anchorShapeId: imageShapeId,
    fileName: annotationHtmlScreenshotFileName(),
    dataUrl: exportResult.url,
    mimeType: 'image/png'
  })
  const prompt = buildAnnotationHtmlPrompt({
    imageShape,
    shapeIds,
    exportWidth: exportResult.width,
    exportHeight: exportResult.height,
    screenshotAsset
  })
  const sender = followUpSender()
  if (!sender) throw new Error('当前 Cowart 画布没有可用的 Codex MCP 消息桥。')
  const content = [{ type: 'text', text: prompt }]
  if (supportsCowartMessageImages()) {
    content.push(
      dataUrlToImageContent(exportResult.url, {
        cowartAnnotationHtml: true,
        cowartSourceImageShapeId: imageShapeId,
        cowartIncludedShapeIds: shapeIds,
        cowartAnnotationScreenshotPath: screenshotAsset.assetPath || null,
        cowartAnnotationScreenshotFileName: screenshotAsset.fileName || null
      })
    )
  }
  return sender(
    { prompt, content },
    { promptType: 'annotation_html', aiType: 'html', hasReference: true }
  )
}
export { sendAnnotationEditRequest, sendAnnotationHtmlRequest }
