// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { renderHtmlDraftDocument } from "../htmlDraftCapture.js"
import { hasCowartWidgetBridge, readCowartPageAsset } from "../cowartClient.js"
import { HTML_DRAFT_CAPTURE_DELAY_MS, AI_IMAGE_HOLDER_DEFAULT_W, AI_IMAGE_HOLDER_DEFAULT_H, PAGE_ASSETS_ROUTE } from './configuration.jsx'
import { cowartHtmlDraftAssetUrlFromVirtualUrl, isCowartHtmlDraftDataUrl, blobFromBase64 } from './assets.jsx'
import { isCowartHtmlDraftEmbedShape } from './holderMeta.jsx'
import { waitForHtmlDraftDocument } from './htmlEditor.jsx'
import { readFileAsDataUrl } from './readFileAsDataUrl.jsx'
async function waitForHtmlDraftAssets(iframeDocument) {
  const pending = []
  if (iframeDocument.fonts?.ready) pending.push(iframeDocument.fonts.ready.catch(() => undefined))
  for (const image of Array.from(iframeDocument.images || [])) {
    if (image.complete) {
      if (typeof image.decode === 'function') pending.push(image.decode().catch(() => undefined))
      continue
    }
    pending.push(
      new Promise((resolve) => {
        const finish = () => resolve()
        image.addEventListener('load', finish, { once: true })
        image.addEventListener('error', finish, { once: true })
      })
    )
  }
  await Promise.race([
    Promise.all(pending),
    new Promise((resolve) => window.setTimeout(resolve, 1500))
  ])
}
function waitForHtmlDraftPaint(iframeDocument) {
  const frameWindow = iframeDocument.defaultView
  if (!frameWindow?.requestAnimationFrame) {
    return new Promise((resolve) => window.setTimeout(resolve, 34))
  }
  return new Promise((resolve) => {
    frameWindow.requestAnimationFrame(() => frameWindow.requestAnimationFrame(resolve))
  })
}
async function waitForHtmlDraftCaptureReady(iframeDocument) {
  await Promise.all([
    waitForHtmlDraftAssets(iframeDocument),
    new Promise((resolve) => window.setTimeout(resolve, HTML_DRAFT_CAPTURE_DELAY_MS))
  ])
  await waitForHtmlDraftPaint(iframeDocument)
}
function loadRasterImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image), { once: true })
    image.addEventListener('error', () => reject(new Error('HTML 草稿无法转换成图片。')), {
      once: true
    })
    image.src = src
  })
}
function getCowartHtmlDraftAssetUrl(shape) {
  return (
    cowartHtmlDraftAssetUrlFromVirtualUrl(shape?.meta?.cowartHtmlDraftAssetUrl) ||
    cowartHtmlDraftAssetUrlFromVirtualUrl(shape?.props?.url) ||
    null
  )
}
function getCowartHtmlDraftLocalPath(shape) {
  const projectDir = window.openai?.toolOutput?.projectDir
  const assetUrl = getCowartHtmlDraftAssetUrl(shape)
  const match = assetUrl?.match(/^\/page-assets\/([^/]+)\/(.+)$/)
  if (!projectDir || !match) return null
  try {
    return `${projectDir}/canvas/pages/${decodeURIComponent(match[1])}/assets/${decodeURIComponent(match[2])}`
  } catch (_error) {
    return null
  }
}
async function renderCowartHtmlDraftCanvas(shape, pixelRatio) {
  if (!isCowartHtmlDraftEmbedShape(shape)) {
    throw new Error('请选择一个已生成 HTML 的 AI HTML。')
  }
  const iframeDocument = await waitForHtmlDraftDocument(shape.id)
  await waitForHtmlDraftCaptureReady(iframeDocument)
  const width = Math.max(1, Number(shape.props.w) || AI_IMAGE_HOLDER_DEFAULT_W)
  const height = Math.max(1, Number(shape.props.h) || AI_IMAGE_HOLDER_DEFAULT_H)
  const captureRatio = Math.max(1, Number(pixelRatio) || 1)
  const canvas = await renderHtmlDraftDocument(iframeDocument, {
    width,
    height,
    pixelRatio: captureRatio
  })
  return {
    canvas,
    url: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    displayWidth: width,
    displayHeight: height,
    pixelRatio: captureRatio
  }
}
function htmlDraftExportBaseName(shape) {
  const assetUrl = getCowartHtmlDraftAssetUrl(shape)
  const rawName = assetUrl?.split('/').pop()?.split(/[?#]/)[0]
  let htmlName = 'ai-draft.html'
  if (rawName) {
    try {
      htmlName = decodeURIComponent(rawName)
    } catch (_error) {
      htmlName = rawName
    }
  }
  return htmlName.replace(/\.html?$/i, '')
}
function htmlDraftExportFileName(shape, extension) {
  return `${htmlDraftExportBaseName(shape)}.${extension}`
}
function textDataUrl(text, mimeType = 'text/plain') {
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`
}
async function readCowartHtmlDraftContent(shape) {
  if (!isCowartHtmlDraftEmbedShape(shape)) {
    throw new Error('请选择一个已生成 HTML 的 AI HTML。')
  }
  const directHtmlUrl = isCowartHtmlDraftDataUrl(shape.props?.url) ? shape.props.url : null
  if (directHtmlUrl) {
    const response = await window.fetch(directHtmlUrl)
    if (!response.ok) throw new Error(`HTML 草稿读取失败：${response.status}`)
    return response.text()
  }
  const assetUrl = getCowartHtmlDraftAssetUrl(shape)
  if (!assetUrl) throw new Error('当前 HTML 草稿没有可导出的源文件。')
  if (hasCowartWidgetBridge()) {
    const pageAsset = await readCowartPageAsset(assetUrl)
    return blobFromBase64(pageAsset.dataBase64, pageAsset.mimeType).text()
  }
  const response = await window.fetch(assetUrl)
  if (!response.ok) throw new Error(`HTML 草稿读取失败：${response.status}`)
  return response.text()
}
async function readCowartImageDataUrl(editor, imageShape) {
  const asset = imageShape?.props?.assetId ? editor.getAsset(imageShape.props.assetId) : null
  const sourceUrl = asset?.props?.src
  if (!asset || !sourceUrl) throw new Error('当前图片没有可读取的原始文件。')
  if (sourceUrl.startsWith(PAGE_ASSETS_ROUTE) && hasCowartWidgetBridge()) {
    const pageAsset = await readCowartPageAsset(sourceUrl)
    return `data:${pageAsset.mimeType};base64,${pageAsset.dataBase64}`
  }
  if (sourceUrl.startsWith('data:')) return sourceUrl
  const resolvedUrl = /^https?:\/\//.test(sourceUrl)
    ? sourceUrl
    : await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true })
  if (!resolvedUrl) throw new Error('无法读取当前图片的原始文件。')
  const response = await window.fetch(resolvedUrl)
  if (!response.ok) throw new Error(`读取当前图片失败：${response.status}`)
  return readFileAsDataUrl(await response.blob())
}
export { waitForHtmlDraftAssets, waitForHtmlDraftPaint, waitForHtmlDraftCaptureReady, loadRasterImage, getCowartHtmlDraftAssetUrl, getCowartHtmlDraftLocalPath, renderCowartHtmlDraftCanvas, htmlDraftExportBaseName, htmlDraftExportFileName, textDataUrl, readCowartHtmlDraftContent, readCowartImageDataUrl }
