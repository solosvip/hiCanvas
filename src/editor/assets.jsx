// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { getAssetUrlsByImport } from "@tldraw/assets/imports.vite"
import { cowartAssetCacheKey, cowartBlobFromBase64, createCowartAssetObjectUrlCache } from "../cowartAssetCache.js"
import { hasCowartWidgetBridge, readCowartPageAsset } from "../cowartClient.js"
import { readFileAsDataUrl } from './readFileAsDataUrl.jsx'
import { iconSvgSources, PAGE_ASSETS_ROUTE, GLOBAL_ASSETS_ROUTE, COWART_HTML_DRAFT_URL_ORIGIN } from './configuration.jsx'
const cowartAssetUrls = buildCowartAssetUrls()
const cowartAssetObjectUrlCache = createCowartAssetObjectUrlCache({
  getKey: (asset) => `${window.openai?.toolOutput?.canvasDir || window.openai?.toolOutput?.projectDir || ''}\u001e${cowartAssetCacheKey(asset)}`,
  async load(asset, signal) {
    const pageAsset = await readCowartPageAsset(asset.props.src, { signal })
    return blobFromBase64(pageAsset.dataBase64, pageAsset.mimeType)
  }
})
const cowartHtmlDraftIframes = new Map()
const cowartHtmlDraftDomEditSessions = new Map()
const cowartFilmControllers = new Map()
const cowartFilmStatuses = new Map()
const cowartPendingSlidesPastes = new WeakMap()
const cowartCopiedContent = new WeakMap()
const cowartTldrawAssetStore = {
  upload: async (_asset, file) => ({ src: await readFileAsDataUrl(file) }),
  resolve: resolveCowartTldrawAssetUrl
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', revokeCowartAssetObjectUrls, { once: true })
}
function buildCowartAssetUrls() {
  const icons = {}
  for (const [path, source] of Object.entries(iconSvgSources)) {
    const name = path.split('/').pop().replace(/\.svg$/, '')
    icons[name] = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(source)))}`
  }
  let base = {}
  try {
    base = getAssetUrlsByImport()
  } catch (error) {
    console.warn('Cowart could not load bundled tldraw asset URLs.', error)
  }
  return { ...base, icons: { ...base.icons, ...icons } }
}
function isCowartLocalAssetUrl(src) {
  return typeof src === 'string' && (src.startsWith(PAGE_ASSETS_ROUTE) || src.startsWith(GLOBAL_ASSETS_ROUTE))
}
const COWART_HTML_DRAFT_LOCAL_IMAGE_PATTERN =
  /(?:https?:\/\/cowart\.local)?(\/(?:page-assets|assets)\/[^"'()\s<>?#]+\.(?:apng|avif|gif|jpe?g|png|svg|webp))(?:[?#][^"'()\s<>]*)?/gi
async function hydrateCowartHtmlDraftLocalImages(htmlContent, options = {}) {
  if (typeof htmlContent !== 'string' || !htmlContent || !hasCowartWidgetBridge()) return htmlContent
  const references = new Map()
  for (const match of htmlContent.matchAll(COWART_HTML_DRAFT_LOCAL_IMAGE_PATTERN)) {
    references.set(match[0], match[1])
  }
  if (!references.size) return htmlContent
  const replacements = new Map()
  // HTML can contain several full-resolution references. Read each file once
  // and sequentially so the bridge does not hold every base64 response at once.
  for (const assetUrl of new Set(references.values())) {
    try {
      options.signal?.throwIfAborted()
      const asset = await readCowartPageAsset(assetUrl, options)
      if (asset?.dataBase64 && asset?.mimeType?.startsWith('image/')) {
        replacements.set(assetUrl, `data:${asset.mimeType};base64,${asset.dataBase64}`)
      }
    } catch (error) {
      if (error.name === 'AbortError') throw error
      console.warn(`Cowart could not hydrate HTML draft image ${assetUrl}.`, error)
    }
  }
  // Build one hydrated document, avoiding a full intermediate copy per image.
  return htmlContent.replace(COWART_HTML_DRAFT_LOCAL_IMAGE_PATTERN,
    (reference) => replacements.get(references.get(reference)) || reference)
}
function isCowartHtmlDraftAssetUrl(src) {
  return typeof src === 'string' && src.startsWith(PAGE_ASSETS_ROUTE) && /\.html?(?:$|[?#])/i.test(src)
}
function isCowartHtmlDraftDataUrl(src) {
  return typeof src === 'string' && /^data:text\/html(?:;[^,]*)?,/i.test(src)
}
function cowartHtmlDraftAssetUrlFromVirtualUrl(src) {
  if (isCowartHtmlDraftAssetUrl(src)) return src
  if (typeof src !== 'string') return null
  try {
    const url = new URL(src)
    if (url.origin !== COWART_HTML_DRAFT_URL_ORIGIN) return null
    const assetUrl = `${url.pathname}${url.search}${url.hash}`
    return isCowartHtmlDraftAssetUrl(assetUrl) ? assetUrl : null
  } catch (_error) {
    return null
  }
}
function cowartHtmlDraftVirtualUrl(assetUrl) {
  const normalizedAssetUrl = cowartHtmlDraftAssetUrlFromVirtualUrl(assetUrl)
  return normalizedAssetUrl ? `${COWART_HTML_DRAFT_URL_ORIGIN}${normalizedAssetUrl}` : ''
}
function revokeCowartAssetObjectUrls() {
  cowartAssetObjectUrlCache.clear()
}
function retainCowartEditorAssets(editor) {
  const assets = editor.getCurrentPageShapes()
    .map((shape) => shape?.props?.assetId ? editor.getAsset(shape.props.assetId) : null)
    .filter(Boolean)
  cowartAssetObjectUrlCache.retain(assets)
}
function cowartAssetReferencesChanged(changes) {
  if (Object.values(changes.added).some((record) => record.typeName === 'asset' || record.typeName === 'shape')) return true
  if (Object.values(changes.removed).some((record) => record.typeName === 'asset' || record.typeName === 'shape')) return true
  return Object.values(changes.updated).some(([previous, next]) =>
    next.typeName === 'asset' ||
    (next.typeName === 'shape' && (previous.props?.assetId !== next.props?.assetId || previous.parentId !== next.parentId)) ||
    (next.typeName === 'instance' && previous.currentPageId !== next.currentPageId)
  )
}
function blobFromBase64(dataBase64, mimeType) {
  return cowartBlobFromBase64(dataBase64, mimeType)
}
async function resolveCowartTldrawAssetUrl(asset) {
  const src = asset?.props?.src
  if (!src) return null
  if (!hasCowartWidgetBridge() || !isCowartLocalAssetUrl(src)) return src
  try {
    return await cowartAssetObjectUrlCache.resolve(asset)
  } catch (error) {
    console.warn('Cowart could not resolve local page asset through MCP; falling back to source URL.', error)
    return src
  }
}
export { cowartAssetUrls, cowartAssetObjectUrlCache, cowartHtmlDraftIframes, cowartHtmlDraftDomEditSessions, cowartFilmControllers, cowartFilmStatuses, cowartPendingSlidesPastes, cowartCopiedContent, cowartTldrawAssetStore, buildCowartAssetUrls, isCowartLocalAssetUrl, COWART_HTML_DRAFT_LOCAL_IMAGE_PATTERN, hydrateCowartHtmlDraftLocalImages, isCowartHtmlDraftAssetUrl, isCowartHtmlDraftDataUrl, cowartHtmlDraftAssetUrlFromVirtualUrl, cowartHtmlDraftVirtualUrl, revokeCowartAssetObjectUrls, retainCowartEditorAssets, cowartAssetReferencesChanged, blobFromBase64, resolveCowartTldrawAssetUrl }
