// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { generateOnCanvas } from '../image-models/canvasImages.js'
import { filmAnalyticsContext } from "../filmAnalytics.js"
import { hasCowartWidgetBridge, saveCowartReferenceImage } from "../cowartClient.js"
import { AI_IMAGE_REFERENCE_MAX_FILES } from './configuration.jsx'
import { dataUrlToImageContent, followUpSender, supportsCowartMessageImages } from './annotationRequests.jsx'
import { buildAiImageGenerationPrompt, buildAiDraftGenerationPrompt, buildAiFilmGenerationPrompt, buildAiSlidesGenerationPrompt } from './generationPrompts.jsx'
import { readFileAsDataUrl } from './readFileAsDataUrl.jsx'
import { isAiFilmHolderShape } from './holderMeta.jsx'
async function sendAiImageGenerationRequest({ editor, modelId, holderShape, userPrompt, referenceFiles = [] }) {
  if (!hasCowartWidgetBridge()) {
    const pageId = editor.getCurrentPageId()
    const references = await Promise.all(referenceFiles.map(readFileAsDataUrl))
    return generateOnCanvas(editor, {
      anchorId: holderShape.id, modelId, pageId,
      prompt: `${userPrompt.trim() || '参考所提供的图片生成新图片。'}\n画面比例参考：${holderShape.props.w}:${holderShape.props.h}。`,
      references
    })
  }
  const sender = followUpSender()
  if (!sender) {
    throw new Error('当前 Cowart 画布没有可用的 Codex MCP 消息桥。')
  }
  const imageReferences = referenceFiles.slice(0, AI_IMAGE_REFERENCE_MAX_FILES)
  const referenceAttached = Boolean(imageReferences.length && supportsCowartMessageImages())
  const references = []
  for (const [index, referenceFile] of imageReferences.entries()) {
    const referenceDataUrl = await readFileAsDataUrl(referenceFile)
    let savedReference = null
    if (hasCowartWidgetBridge() || !window.cowartMcp) {
      try {
        savedReference = await saveCowartReferenceImage({
          holderShapeId: holderShape.id,
          fileName: referenceFile.name || `reference-${index + 1}.png`,
          dataUrl: referenceDataUrl,
          mimeType: referenceFile.type || undefined
        })
      } catch (error) {
        if (!referenceAttached) {
          throw new Error(`参考图无法保存到 Cowart 本地 assets：${error instanceof Error ? error.message : String(error)}`)
        }
        console.warn('Cowart reference image could not be saved; relying on direct image attachment.', error)
      }
    } else if (!referenceAttached) {
      throw new Error('当前 Codex host 没有声明支持图片附件，也没有可用的 Cowart MCP 文件保存桥。')
    }
    references.push({ file: referenceFile, dataUrl: referenceDataUrl, savedReference })
  }
  const prompt = buildAiImageGenerationPrompt({
    holderShape,
    userPrompt,
    references,
    referenceAttached
  })
  const content = [{ type: 'text', text: prompt }]
  if (referenceAttached) {
    for (const [index, reference] of references.entries()) {
      content.push(dataUrlToImageContent(reference.dataUrl, {
        cowartAiImageReference: true,
        cowartAiImageReferenceIndex: index + 1,
        cowartAiImageHolderShapeId: holderShape.id,
        cowartReferenceFileName: reference.file.name || null,
        cowartReferenceAssetPath: reference.savedReference?.assetPath || null
      }))
    }
  }
  return sender(
    { prompt, content },
    {
      promptType: 'ai_image', targetShapeId: holderShape.id,
      aiType: 'image',
      hasReference: imageReferences.length > 0
    }
  )
}
async function sendAiDraftGenerationRequest({ holderShape, userPrompt, referenceFiles = [] }) {
  const sender = followUpSender()
  if (!sender) {
    throw new Error('当前 Cowart 画布没有可用的 Codex MCP 消息桥。')
  }
  const imageReferences = referenceFiles.slice(0, AI_IMAGE_REFERENCE_MAX_FILES)
  const referenceAttached = Boolean(imageReferences.length && supportsCowartMessageImages())
  const references = []
  for (const [index, referenceFile] of imageReferences.entries()) {
    const referenceDataUrl = await readFileAsDataUrl(referenceFile)
    let savedReference = null
    if (hasCowartWidgetBridge() || !window.cowartMcp) {
      try {
        savedReference = await saveCowartReferenceImage({
          holderShapeId: holderShape.id,
          fileName: referenceFile.name || `draft-reference-${index + 1}.png`,
          dataUrl: referenceDataUrl,
          mimeType: referenceFile.type || undefined
        })
      } catch (error) {
        if (!referenceAttached) {
          throw new Error(`参考图无法保存到 Cowart 本地 assets：${error instanceof Error ? error.message : String(error)}`)
        }
        console.warn('Cowart draft reference image could not be saved; relying on direct image attachment.', error)
      }
    } else if (!referenceAttached) {
      throw new Error('当前 Codex host 没有声明支持图片附件，也没有可用的 Cowart MCP 文件保存桥。')
    }
    references.push({ file: referenceFile, dataUrl: referenceDataUrl, savedReference })
  }
  const prompt = (isAiFilmHolderShape(holderShape) ? buildAiFilmGenerationPrompt : buildAiDraftGenerationPrompt)({
    holderShape,
    userPrompt,
    references,
    referenceAttached
  })
  const content = [{ type: 'text', text: prompt }]
  if (referenceAttached) {
    for (const [index, reference] of references.entries()) {
      content.push(dataUrlToImageContent(reference.dataUrl, {
        cowartAiDraftReference: true,
        cowartAiDraftReferenceIndex: index + 1,
        cowartAiDraftHolderShapeId: holderShape.id,
        cowartReferenceFileName: reference.file.name || null,
        cowartReferenceAssetPath: reference.savedReference?.assetPath || null
      }))
    }
  }
  return sender(
    { prompt, content },
    {
      targetShapeId: holderShape.id,
      promptType: isAiFilmHolderShape(holderShape) ? 'ai_film' : 'ai_html',
      aiType: isAiFilmHolderShape(holderShape) ? 'film' : 'html',
      hasReference: imageReferences.length > 0,
      ...(isAiFilmHolderShape(holderShape) ? filmAnalyticsContext(holderShape) : {})
    }
  )
}
async function sendAiSlidesGenerationRequest({ slidesShape, pageCount, userPrompt, referenceFiles = [] }) {
  const sender = followUpSender()
  if (!sender) {
    throw new Error('当前 Cowart 画布没有可用的 Codex MCP 消息桥。')
  }
  const imageReferences = referenceFiles.slice(0, AI_IMAGE_REFERENCE_MAX_FILES)
  const referenceAttached = Boolean(imageReferences.length && supportsCowartMessageImages())
  const references = []
  for (const [index, referenceFile] of imageReferences.entries()) {
    const referenceDataUrl = await readFileAsDataUrl(referenceFile)
    let savedReference = null
    if (hasCowartWidgetBridge() || !window.cowartMcp) {
      try {
        savedReference = await saveCowartReferenceImage({
          holderShapeId: slidesShape.id,
          fileName: referenceFile.name || `slides-reference-${index + 1}.png`,
          dataUrl: referenceDataUrl,
          mimeType: referenceFile.type || undefined
        })
      } catch (error) {
        if (!referenceAttached) {
          throw new Error(`参考图无法保存到 Cowart 本地 assets：${error instanceof Error ? error.message : String(error)}`)
        }
        console.warn('Cowart slides reference image could not be saved; relying on direct image attachment.', error)
      }
    } else if (!referenceAttached) {
      throw new Error('当前 Codex host 没有声明支持图片附件，也没有可用的 Cowart MCP 文件保存桥。')
    }
    references.push({ file: referenceFile, dataUrl: referenceDataUrl, savedReference })
  }
  const prompt = buildAiSlidesGenerationPrompt({
    slidesShape,
    pageCount,
    userPrompt,
    references,
    referenceAttached
  })
  const content = [{ type: 'text', text: prompt }]
  if (referenceAttached) {
    for (const [index, reference] of references.entries()) {
      content.push(dataUrlToImageContent(reference.dataUrl, {
        cowartAiSlidesReference: true,
        cowartAiSlidesReferenceIndex: index + 1,
        cowartAiSlidesShapeId: slidesShape.id,
        cowartReferenceFileName: reference.file.name || null,
        cowartReferenceAssetPath: reference.savedReference?.assetPath || null
      }))
    }
  }
  return sender(
    { prompt, content },
    {
      promptType: 'ai_slides', targetShapeId: slidesShape.id,
      aiType: 'slides',
      hasReference: imageReferences.length > 0,
      pageCount
    }
  )
}
export { sendAiImageGenerationRequest, sendAiDraftGenerationRequest, sendAiSlidesGenerationRequest }
