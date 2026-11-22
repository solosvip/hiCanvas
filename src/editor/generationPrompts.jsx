// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { buildFilmGenerationPrompt } from "../filmConfig.js"
import { AI_IMAGE_HOLDER_DEFAULT_W, AI_IMAGE_HOLDER_DEFAULT_H, AI_IMAGE_GENERATION_PANEL_OFFSET, AI_IMAGE_GENERATION_PANEL_MIN_W, AI_IMAGE_GENERATION_PANEL_MAX_W, AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN, AI_IMAGE_GENERATION_PANEL_ESTIMATED_H, AI_IMAGE_GENERATION_PROMPT_PREFIX, AI_DRAFT_GENERATION_PROMPT_PREFIX, COWART_WIDGET_ALREADY_OPEN_PROMPT_LINE, AI_SLIDES_GENERATION_PROMPT_PREFIX } from './configuration.jsx'
import { getAiImageAspectPreset } from './holderMeta.jsx'
function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max)
}
function formatAiImageGenerationTarget(shape) {
  const targetWidth = Math.round(Number(shape?.props?.w) || AI_IMAGE_HOLDER_DEFAULT_W)
  const targetHeight = Math.round(Number(shape?.props?.h) || AI_IMAGE_HOLDER_DEFAULT_H)
  const ratio = targetHeight ? targetWidth / targetHeight : 1
  const preset = getAiImageAspectPreset(shape)
  const ratioLabel = preset?.label ?? `${targetWidth}:${targetHeight}`
  return {
    targetWidth,
    targetHeight,
    ratio,
    ratioLabel,
    label: `${ratioLabel} · ${targetWidth}x${targetHeight}`
  }
}
function getAiImageGenerationPanelLayout(editor, shapeId, panelHeight = AI_IMAGE_GENERATION_PANEL_ESTIMATED_H) {
  const bounds = editor.getShapePageBounds(shapeId)
  if (!bounds) return null
  const containerBounds = editor.getContainer().getBoundingClientRect()
  const viewportWidth = containerBounds.width || window.innerWidth || 0
  const viewportHeight = containerBounds.height || window.innerHeight || 0
  if (!viewportWidth || !viewportHeight) return null
  const bottomLeft = editor.pageToViewport({ x: bounds.x, y: bounds.y + bounds.h })
  const bottomRight = editor.pageToViewport({ x: bounds.x + bounds.w, y: bounds.y + bounds.h })
  const screenWidth = Math.abs(bottomRight.x - bottomLeft.x)
  const panelWidth = Math.min(
    AI_IMAGE_GENERATION_PANEL_MAX_W,
    Math.max(AI_IMAGE_GENERATION_PANEL_MIN_W, screenWidth * 2.6)
  )
  const panelLeft = clampNumber(
    bottomLeft.x + screenWidth / 2 - panelWidth / 2,
    AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN,
    Math.max(AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN, viewportWidth - panelWidth - AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN)
  )
  // The taller film panel must clear the fixed bottom tool palette.
  const bottomMargin = 88
  const preferredTop = bottomLeft.y + AI_IMAGE_GENERATION_PANEL_OFFSET
  const panelTop = clampNumber(
    preferredTop,
    AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN,
    Math.max(AI_IMAGE_GENERATION_PANEL_VIEWPORT_MARGIN, viewportHeight - panelHeight - bottomMargin)
  )
  return {
    left: panelLeft,
    top: panelTop,
    width: panelWidth
  }
}
function aiImageReferenceLines({ references, referenceAttached }) {
  if (!references.length) return ['Reference images: none']
  const lines = [`Reference images: ${references.length}`]
  const localPathLines = []
  references.forEach((reference, index) => {
    const savedReference = reference.savedReference
    const displayName = savedReference?.fileName || reference.file?.name || `selected reference image ${index + 1}`
    if (savedReference?.assetPath) {
      localPathLines.push(`${index + 1}. ${savedReference.assetPath}`)
    } else {
      localPathLines.push(`${index + 1}. ${displayName} (local path unavailable)`)
    }
  })
  if (localPathLines.some((line) => !line.endsWith('(local path unavailable)'))) {
    lines.push('Reference image local paths:', ...localPathLines, 'Use these local files as visual references.')
  } else if (referenceAttached) {
    lines.push('Reference images are attached as image content blocks; use them as visual references.')
  } else {
    lines.push('Reference image local paths were unavailable.')
  }
  return lines
}
function buildAiImageGenerationPrompt({ holderShape, userPrompt, references, referenceAttached }) {
  const { targetWidth, targetHeight, ratio, ratioLabel } = formatAiImageGenerationTarget(holderShape)
  const referenceLines = aiImageReferenceLines({ references, referenceAttached })
  return [
    AI_IMAGE_GENERATION_PROMPT_PREFIX,
    '',
    `Cowart AI image holder shape: ${holderShape.id}`,
    `Target canvas slot: ${targetWidth} x ${targetHeight} canvas units.`,
    `Target aspect ratio: ${ratioLabel} (${ratio.toFixed(3)} width/height).`,
    'Compose the final bitmap for this slot without cropping or stretching.',
    ...referenceLines,
    '',
    'Prompt:',
    userPrompt.trim()
  ].join('\n')
}
function buildAiDraftGenerationPrompt({ holderShape, userPrompt, references, referenceAttached }) {
  const { targetWidth, targetHeight, ratio, ratioLabel } = formatAiImageGenerationTarget(holderShape)
  const referenceLines = aiImageReferenceLines({ references, referenceAttached })
  return [
    AI_DRAFT_GENERATION_PROMPT_PREFIX,
    '',
    `Cowart AI draft holder shape: ${holderShape.id}`,
    `Target canvas draft slot: ${targetWidth} x ${targetHeight} canvas units.`,
    `Target aspect ratio: ${ratioLabel} (${ratio.toFixed(3)} width/height).`,
    'Design the HTML so it fills this iframe size without needing external files.',
    ...referenceLines,
    '',
    'Required tool call after generating the HTML:',
    `- Call insert_cowart_html_draft with draftShapeId: "${holderShape.id}".`,
    '- Pass the final HTML document as htmlContent.',
    '- Use a short .html fileName that describes the draft.',
    '- Leave replaceDraftHolder unset or true so the AI HTML frame becomes the embedded HTML preview.',
    '- If the prompt requests multiple HTML outputs, call insert_cowart_html_draft once per HTML. Use the holder id above only for the first call.',
    '- For each additional HTML, use the previous call result shapeId as draftShapeId and set updateExistingDraft: false, replaceDraftHolder: false, matchAnchor: false, and placement: "right" so the independent HTML embeds are laid out horizontally.',
    '',
    'Prompt:',
    userPrompt.trim()
  ].join('\n')
}
function buildAiFilmGenerationPrompt({ holderShape, userPrompt, references, referenceAttached }) {
  const target = formatAiImageGenerationTarget(holderShape)
  return buildFilmGenerationPrompt({
    holderShape,
    userPrompt,
    target,
    referenceLines: aiImageReferenceLines({ references, referenceAttached }),
    canvasContext: window.openai?.toolOutput || {},
    alreadyOpenLine: COWART_WIDGET_ALREADY_OPEN_PROMPT_LINE
  })
}
function buildAiSlidesGenerationPrompt({ slidesShape, pageCount, userPrompt, references, referenceAttached }) {
  const referenceLines = aiImageReferenceLines({ references, referenceAttached })
  return [
    AI_SLIDES_GENERATION_PROMPT_PREFIX,
    '',
    `Cowart AI Slides frame: ${slidesShape.id}`,
    `Required page count: exactly ${pageCount}.`,
    'Create the deck as a coherent sequence with a clear opening, development, and conclusion.',
    ...referenceLines,
    '',
    'Required tool calls after generating the HTML pages:',
    `- Call insert_cowart_html_draft exactly ${pageCount} times, once per page, in page order.`,
    `- For every call set draftShapeId to "${slidesShape.id}".`,
    '- Set replaceDraftHolder: false, updateExistingDraft: false, matchAnchor: false, displayWidth: 1024, and displayHeight: 576.',
    `- Set shapeMeta.cowartAiSlidesParentShapeId to "${slidesShape.id}".`,
    `- Set shapeMeta.cowartAiSlidesGeneratedPageCount to ${pageCount}, and shapeMeta.cowartAiSlidesGeneratedPage to the 1-based page number.`,
    '- Use unique ordered file names such as slide-01.html, slide-02.html, and so on.',
    '- Do not replace or delete the AI Slides frame.',
    '',
    'Prompt:',
    userPrompt.trim()
  ].join('\n')
}
function clipboardImageFiles(event) {
  const clipboardData = event.clipboardData
  if (!clipboardData) return []
  const itemFiles = Array.from(clipboardData.items || [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean)
  if (itemFiles.length) return itemFiles
  return Array.from(clipboardData.files || []).filter((file) => file.type.startsWith('image/'))
}
function stopEditorOverlayEvent(event) {
  event.stopPropagation()
}
function handleGenerationPromptKeyDown(event, submit) {
  stopEditorOverlayEvent(event)
  if (
    event.key !== 'Enter' || event.shiftKey || event.altKey ||
    event.isComposing || event.nativeEvent?.isComposing ||
    event.keyCode === 229 || event.nativeEvent?.keyCode === 229
  ) return
  event.preventDefault()
  if (!event.repeat) submit(event)
}
export { clampNumber, formatAiImageGenerationTarget, getAiImageGenerationPanelLayout, aiImageReferenceLines, buildAiImageGenerationPrompt, buildAiDraftGenerationPrompt, buildAiFilmGenerationPrompt, buildAiSlidesGenerationPrompt, clipboardImageFiles, stopEditorOverlayEvent, handleGenerationPromptKeyDown }
