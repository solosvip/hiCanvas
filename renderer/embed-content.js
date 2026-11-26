import { getEmbedService, getEmbedServiceConstraints } from '../model/index.js'
import {contentSandbox} from '../content-channel/index.js'

// Until a validated publication supplies its own attributes, the frame is opaque.
export const EMBED_FRAME_ATTRIBUTES = Object.freeze({ sandbox: contentSandbox(), referrerPolicy: 'no-referrer', tabIndex: -1, draggable: false, frameBorder: '0' })
const virtualOrigin = 'https://cowart.local'

// Second approved constructor: resolveExternalEmbed only attaches these to
// model's HTTPS provider whitelist. Preserve the observed #83 permissions.
const frame = extra => Object.freeze({ sandbox: `allow-popups ${extra ? extra + ' ' : ''}allow-scripts allow-same-origin allow-forms`, referrerPolicy: 'strict-origin-when-cross-origin', allowFullScreen: true, tabIndex: -1, draggable: false, frameBorder: '0' })
function appendQuery(raw, field) {
  const [base, ...hash] = raw.split('#')
  return base + (base.includes('?') ? '&' : '?') + field + (hash.length ? '#' + hash.join('#') : '')
}
function youtube(url, raw) {
  if (url.hostname === 'www.youtube.com' && url.pathname.startsWith('/embed/')) return raw
  const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v')
  const params = new URLSearchParams()
  for (const [key, value] of url.searchParams) if (key !== 'v') params.append(key === 't' ? 'start' : key, value)
  return `https://www.youtube.com/embed/${id}${params.size ? '?' + params : ''}`
}
// Inputs have already been identified by model's single matching table.
// Only address construction and legacy frame permissions live here.
const converters = {
  G05: (_u, raw) => raw,
  G06: (u, raw) => u.pathname === '/embed' ? raw : 'https://www.figma.com/embed?embed_host=share&url=' + raw,
  G07: (u, raw) => u.searchParams.has('embed') ? raw : appendQuery(raw, 'embed='),
  G08: (_u, raw) => raw,
  G09: u => 'https://www.val.town/embed/' + u.pathname.split('/').slice(2).join('/'),
  G10: u => 'https://codesandbox.io/embed/' + u.pathname.split('/')[2],
  G11: u => `https://codepen.io/${u.pathname.split('/')[1]}/embed/${u.pathname.split('/')[3]}${u.search}${u.hash}`,
  G12: u => 'https://scratch.mit.edu/projects/embed/' + u.pathname.split('/')[2],
  G13: youtube,
  G14: (u, raw) => u.pathname === '/calendar/embed' ? raw : 'https://calendar.google.com/calendar/embed?src=' + encodeURIComponent(u.searchParams.get('cid')),
  G15: (u, raw) => u.pathname.endsWith('/embed') ? raw : `https://docs.google.com/presentation/d/e/${u.pathname.split('/')[4]}/embed${u.hash}`,
  G16: () => null,
  G17: (_u, raw) => appendQuery(raw, 'embed=true'),
  G18: u => 'https://felt.com/embed/map/' + u.pathname.split('/').at(-1),
  G19: u => 'https://open.spotify.com/embed/album/' + u.pathname.split('/').at(-1),
  G20: (u, raw) => u.hostname === 'player.vimeo.com' ? raw : `https://player.vimeo.com/video/${u.pathname.split('/')[1]}?title=0&byline=0`,
  G21: (u, raw) => u.pathname.startsWith('/embed/') ? raw : `https://observablehq.com/embed/${u.pathname.startsWith('/d/') ? u.pathname.slice(3) : u.pathname.slice(1)}?cell=*`,
  G22: (u, raw) => u.search ? raw : raw + '?embed',
}
const entry = (id, name, size, minimumObserved, extra = {}) => {
  const constraints = getEmbedServiceConstraints(id)
  return Object.freeze({ id, name, size: Object.freeze(size), minimumObserved: minimumObserved && Object.freeze(minimumObserved), canResize: constraints.canResize, lockAspectRatio: constraints.lockAspectRatio, attributes: frame(''), convert: (url, raw) => getEmbedService(raw)?.id === id ? converters[id](url, raw) : null, ...extra })
}

// Independent black-box samples from the running legacy UI (2026-11-25).
// The observed limits describe that probe, not independently inferred minW/minH.
// Permissions preserve legacy behavior per #83 and ADR0013's controlled boundary.
export const EXTERNAL_EMBED_SERVICES = Object.freeze([
  entry('G05', 'tldraw', [720, 500], [300, 300], { attributes: frame('allow-top-navigation') }),
  entry('G06', 'Figma', [720, 500], [200, 200]),
  entry('G07', 'Canva', [720, 500], [200, 200]),
  entry('G08', 'Google Maps', [720, 500], [200, 200], { attributes: frame('allow-presentation') }),
  entry('G09', 'Val Town', [720, 500], [260, 100]),
  entry('G10', 'CodeSandbox', [720, 500], [300, 300]),
  entry('G11', 'CodePen', [520, 400], [300, 300]),
  entry('G12', 'Scratch', [520, 400], null),
  entry('G13', 'YouTube', [800, 450], [355.556, 200], { attributes: frame('allow-popups-to-escape-sandbox allow-presentation') }),
  entry('G14', 'Google Calendar', [720, 500], [460, 360], { attributes: frame('allow-popups-to-escape-sandbox') }),
  entry('G15', 'Google Slides', [720, 500], [460, 360], { attributes: frame('allow-popups-to-escape-sandbox') }),
  entry('G16', 'GitHub Gist', [720, 500], [200, 200], { fallbackIssue: 78, attributes: Object.freeze({ ...frame(''), sandbox: 'allow-popups allow-scripts allow-forms', allowFullScreen: false }) }),
  entry('G17', 'Replit', [720, 500], [200, 200]),
  entry('G18', 'Felt', [720, 500], [200, 200]),
  // #83 preserves observed permissions, including provider-specific capabilities.
  entry('G19', 'Spotify', [720, 500], [200, 500]),
  entry('G20', 'Vimeo', [640, 360], [355.556, 200]),
  entry('G21', 'Observable', [720, 500], [200, 200]),
  entry('G22', 'Desmos', [700, 450], [200, 200]),
])

export function resolveExternalEmbed(value) {
  const source = getEmbedService(value)
  if (!source) return null
  const service = EXTERNAL_EMBED_SERVICES.find(service => service.id === source.id)
  const src = service.convert(new URL(value), value)
  return src ? { service, src, attributes: service.attributes } : null
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
