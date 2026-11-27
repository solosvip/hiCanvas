import { EMBED_SERVICES, resolveEmbedUrl, getEmbedServiceConstraints } from '../model/index.js'
import {contentSandbox} from '../content-channel/index.js'

// Until a validated publication supplies its own attributes, the frame is opaque.
export const EMBED_FRAME_ATTRIBUTES = Object.freeze({ sandbox: contentSandbox(), referrerPolicy: 'no-referrer', tabIndex: -1, draggable: false, frameBorder: '0' })
const virtualOrigin = 'https://cowart.local'

// Second approved constructor: resolveExternalEmbed only attaches these to
// model's HTTPS provider whitelist. Preserve the observed #83 permissions.
const frame = extra => Object.freeze({ sandbox: `allow-popups ${extra ? extra + ' ' : ''}allow-scripts allow-same-origin allow-forms`, referrerPolicy: 'strict-origin-when-cross-origin', allowFullScreen: true, tabIndex: -1, draggable: false, frameBorder: '0' })
const entry = (id, minimumObserved, extra = {}) => {
  const { name, size } = EMBED_SERVICES.find(service => service.id === id)
  const constraints = getEmbedServiceConstraints(id)
  return Object.freeze({ id, name, size: Object.freeze(size), minimumObserved: minimumObserved && Object.freeze(minimumObserved), canResize: constraints.canResize, lockAspectRatio: constraints.lockAspectRatio, attributes: frame(''), convert: (_url, raw) => { const result = resolveEmbedUrl(raw); return result?.id === id ? result.src : null }, ...extra })
}

// Independent black-box samples from the running legacy UI (2026-11-25).
// The observed limits describe that probe, not independently inferred minW/minH.
// Permissions preserve legacy behavior per #83 and ADR0013's controlled boundary.
export const EXTERNAL_EMBED_SERVICES = Object.freeze([
  entry('G05', [300, 300], { attributes: frame('allow-top-navigation') }),
  entry('G06', [200, 200]),
  entry('G07', [200, 200]),
  entry('G08', [200, 200], { attributes: frame('allow-presentation') }),
  entry('G09', [260, 100]),
  entry('G10', [300, 300]),
  entry('G11', [300, 300]),
  entry('G12', null),
  entry('G13', [355.556, 200], { attributes: frame('allow-popups-to-escape-sandbox allow-presentation') }),
  entry('G14', [460, 360], { attributes: frame('allow-popups-to-escape-sandbox') }),
  entry('G15', [460, 360], { attributes: frame('allow-popups-to-escape-sandbox') }),
  entry('G16', [200, 200], { fallbackIssue: 78, attributes: Object.freeze({ ...frame(''), sandbox: 'allow-popups allow-scripts allow-forms', allowFullScreen: false }) }),
  entry('G17', [200, 200]),
  entry('G18', [200, 200]),
  // #83 preserves observed permissions, including provider-specific capabilities.
  entry('G19', [200, 500]),
  entry('G20', [355.556, 200]),
  entry('G21', [200, 200]),
  entry('G22', [200, 200]),
])

export function resolveExternalEmbed(value) {
  const source = resolveEmbedUrl(value)
  if (!source) return null
  const service = EXTERNAL_EMBED_SERVICES.find(service => service.id === source.id)
  return { service, src: source.src, attributes: service.attributes }
}

function assetUrl(value, extensions = /\.html?$/i) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value, virtualOrigin)
    if (![virtualOrigin, 'http://cowart.local'].includes(url.origin)) return null
    const parts = url.pathname.split('/').slice(1).map(decodeURIComponent)
    if (parts.some(part => !part || ['.', '..'].includes(part) || /[\\/\0]/.test(part))) return null
    const local = parts[0] === 'c' ? parts.slice(2) : parts
    if (!(local[0] === 'assets' && local.length === 2 || local[0] === 'page-assets' && local.length === 3)) return null
    return extensions.test(parts.at(-1)) ? `${url.pathname}${url.search}${url.hash}` : null
  } catch { return null }
}

const inlineHtml = value => typeof value === 'string' && /^data:text\/html(?:;[^,]*)?,/i.test(value)
export function describeEmbed(shape) {
  const source = inlineHtml(shape.props.url) ? shape.props.url : assetUrl(shape.meta?.cowartHtmlDraftAssetUrl) || assetUrl(shape.props.url)
  const draft = !!source || shape.meta?.cowartHtmlDraft === true
  const kind = shape.type === 'bookmark' ? '书签' : !draft ? '外部嵌入' : shape.meta?.cowartFilm ? '影片' : shape.meta?.cowartAiSlidesParentShapeId ? '幻灯片' : '网页'
  return { kind, source: shape.type === 'bookmark' ? null : source, draft }
}

async function readAsset(url, { fetcher, signal }, image = false) {
  const response = await fetcher(url, { method: 'GET', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', signal })
  if (!response.ok) throw new Error(`内容加载失败：${response.status}`)
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (image ? !/^image\/(?:png|jpe?g|gif|webp|avif|apng|svg\+xml)$/i.test(type) : type !== 'text/html') throw new Error('本机资源的内容类型不匹配。')
  if (!image) return response.text()
  const bytes = new Uint8Array(await response.arrayBuffer()), chunks = []
  for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)))
  return `data:${type};base64,${btoa(chunks.join(''))}`
}

export async function loadEmbedHtml(source, { fetcher = globalThis.fetch, signal } = {}) {
  let html
  if (inlineHtml(source)) {
    // 浏览器 data URL 解码能保留裸百分号并处理百分号编码的 base64；与旧版一致。
    // 此处仅接受 data:text/html，既不请求 HTTP，也不经本机资源 fetcher。
    try { html = await (await globalThis.fetch(source, { signal })).text() }
    catch (error) { if (signal?.aborted) throw error; throw new Error('HTML 内容无法解析。', { cause: error }) }
  } else {
    const url = assetUrl(source)
    if (!url) throw new Error('仅允许当前文档引用的本机 HTML 内容。')
    html = await readAsset(url, { fetcher, signal })
  }
  // 与旧版一致：把虚拟来源的本机图片内联，避免 cowart.local 被当成真实域名。
  const references = new Map()
  const pattern = /(?:https?:\/\/cowart\.local)?\/(?:c\/[^/]+\/)?(?:page-assets|assets)\/[^"'()\s<>?#]+\.(?:apng|avif|gif|jpe?g|png|svg|webp)(?:[?#][^"'()\s<>]*)?/gi
  for (const match of html.matchAll(pattern)) {
    const url = assetUrl(match[0], /\.(?:apng|avif|gif|jpe?g|png|svg|webp)$/i)
    if (url) references.set(match[0], url)
  }
  const images = new Map()
  for (const url of new Set(references.values())) {
    signal?.throwIfAborted()
    try { images.set(url, await readAsset(url, { fetcher, signal }, true)) }
    catch (error) { if (signal?.aborted || error.name === 'AbortError') throw error }
  }
  if (!html.trim()) throw new Error('HTML 内容为空。')
  return html.replace(pattern, value => images.get(references.get(value)) || value)
}
