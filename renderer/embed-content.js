// #70 保持继承权限；独立来源与消息通道的隔离迁移由 #78 负责。
export const EMBED_FRAME_ATTRIBUTES = Object.freeze({ sandbox: 'allow-forms allow-popups allow-same-origin allow-scripts', referrerPolicy: 'no-referrer', tabIndex: -1, draggable: false, frameBorder: '0' })
const virtualOrigin = 'https://cowart.local'

const frame = extra => Object.freeze({ sandbox: `allow-popups ${extra ? extra + ' ' : ''}allow-scripts allow-same-origin allow-forms`, referrerPolicy: 'strict-origin-when-cross-origin', allowFullScreen: true, tabIndex: -1, draggable: false, frameBorder: '0' })
const at = (url, host, path) => url.hostname === host && url.pathname.match(path)
function appendQuery(raw, field) {
  const [base, ...hash] = raw.split('#')
  return base + (base.includes('?') ? '&' : '?') + field + (hash.length ? '#' + hash.join('#') : '')
}
function figma(url, raw) {
  const file = value => at(value, 'www.figma.com', /^\/(?:file|design|proto)\/[A-Za-z0-9]{22}\/[^/]+\/?$/)
  if (file(url)) return 'https://www.figma.com/embed?embed_host=share&url=' + raw
  if (at(url, 'www.figma.com', /^\/embed$/)) {
    try { if (file(new URL(url.searchParams.get('url')))) return raw } catch { /* Invalid nested URL falls back to a bookmark. */ }
  }
  return null
}
function youtube(url, raw) {
  if (at(url, 'www.youtube.com', /^\/embed\/[A-Za-z0-9_-]+$/)) return raw
  const short = at(url, 'youtu.be', /^\/([A-Za-z0-9_-]+)$/)
  const id = short?.[1] || (at(url, 'www.youtube.com', /^\/watch$/) && url.searchParams.get('v'))
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null
  const params = new URLSearchParams()
  for (const [key, value] of url.searchParams) if (key !== 'v') params.append(key === 't' ? 'start' : key, value)
  return `https://www.youtube.com/embed/${id}${params.size ? '?' + params : ''}`
}
const entry = (id, name, size, minimumObserved, convert, extra = {}) => Object.freeze({ id, name, size: Object.freeze(size), minimumObserved: minimumObserved && Object.freeze(minimumObserved), canResize: true, lockAspectRatio: false, attributes: frame(''), convert, ...extra })

// Independent black-box samples from the running legacy UI (2026-11-25).
// The observed limits describe that probe, not independently inferred minW/minH.
// Permissions preserve legacy behavior per #83's ruling; tightening belongs to #78.
export const EXTERNAL_EMBED_SERVICES = Object.freeze([
  entry('G05', 'tldraw', [720, 500], [300, 300], (u, raw) => at(u, 'www.tldraw.com', /^\/r\/[A-Za-z0-9_-]+\/?$/) ? raw : null, { attributes: frame('allow-top-navigation') }),
  entry('G06', 'Figma', [720, 500], [200, 200], figma),
  entry('G07', 'Canva', [720, 500], [200, 200], (u, raw) => at(u, 'www.canva.com', /^\/design\/[^/]+\/(?:[^/]+\/)?view\/?$/) ? u.searchParams.has('embed') ? raw : appendQuery(raw, 'embed=') : null),
  entry('G08', 'Google Maps', [720, 500], [200, 200], (u, raw) => at(u, 'www.google.com', /^\/maps\/embed$/) && u.searchParams.get('pb') ? raw : null, { attributes: frame('allow-presentation') }),
  entry('G09', 'Val Town', [720, 500], [260, 100], u => { const m = at(u, 'www.val.town', /^\/(?:v|embed)\/([^/]+(?:\/[^/]+)?)$/); return m ? 'https://www.val.town/embed/' + m[1] : null }),
  entry('G10', 'CodeSandbox', [720, 500], [300, 300], u => { const m = at(u, 'codesandbox.io', /^\/(?:s|embed)\/([^/]+)$/); return m ? 'https://codesandbox.io/embed/' + m[1] : null }),
  entry('G11', 'CodePen', [520, 400], [300, 300], u => { const m = at(u, 'codepen.io', /^\/([^/]+)\/(?:pen|embed)\/([^/]+)$/); return m ? `https://codepen.io/${m[1]}/embed/${m[2]}${u.search}${u.hash}` : null }),
  entry('G12', 'Scratch', [520, 400], null, u => { const m = at(u, 'scratch.mit.edu', /^\/projects\/([A-Za-z0-9_-]+)(?:\/[^/]+)?\/?$/); return m ? 'https://scratch.mit.edu/projects/embed/' + m[1] : null }, { canResize: false }),
  entry('G13', 'YouTube', [800, 450], [355.556, 200], youtube, { lockAspectRatio: true, attributes: frame('allow-popups-to-escape-sandbox allow-presentation') }),
  entry('G14', 'Google Calendar', [720, 500], [460, 360], (u, raw) => at(u, 'calendar.google.com', /^\/calendar\/embed$/) && u.searchParams.get('src') ? raw : at(u, 'calendar.google.com', /^\/calendar\/u\/0\/r$/) && u.searchParams.get('cid') ? 'https://calendar.google.com/calendar/embed?src=' + encodeURIComponent(u.searchParams.get('cid')) : null, { attributes: frame('allow-popups-to-escape-sandbox') }),
  entry('G15', 'Google Slides', [720, 500], [460, 360], (u, raw) => { const m = at(u, 'docs.google.com', /^\/presentation\/d\/e\/([^/]+)\/(pub|embed)$/); return m ? m[2] === 'embed' ? raw : `https://docs.google.com/presentation/d/e/${m[1]}/embed${u.hash}` : null }, { attributes: frame('allow-popups-to-escape-sandbox') }),
  entry('G16', 'GitHub Gist', [720, 500], [200, 200], () => null, { fallbackIssue: 78, attributes: Object.freeze({ ...frame(''), sandbox: 'allow-popups allow-scripts allow-forms', allowFullScreen: false }) }),
  entry('G17', 'Replit', [720, 500], [200, 200], (u, raw) => at(u, 'replit.com', /^\/@[^/]+\/[^/]+$/) ? appendQuery(raw, 'embed=true') : null),
  entry('G18', 'Felt', [720, 500], [200, 200], u => { const m = at(u, 'felt.com', /^\/(?:embed\/)?map\/([^/]+)$/); return m ? 'https://felt.com/embed/map/' + m[1] : null }),
  // Official full-audio guidance requires encrypted-media. The observed legacy
  // frame has no allow attribute; #83 preserves it rather than claiming minimum permissions.
  entry('G19', 'Spotify', [720, 500], [200, 500], u => { const m = at(u, 'open.spotify.com', /^\/(?:embed\/)?album\/([A-Za-z0-9]{22})$/); return m ? 'https://open.spotify.com/embed/album/' + m[1] : null }),
  entry('G20', 'Vimeo', [640, 360], [355.556, 200], (u, raw) => { if (at(u, 'player.vimeo.com', /^\/video\/\d+$/)) return raw; const m = at(u, 'vimeo.com', /^\/(\d+)(?:\/[^/]+)?$/); return m ? `https://player.vimeo.com/video/${m[1]}?title=0&byline=0` : null }, { lockAspectRatio: true }),
  entry('G21', 'Observable', [720, 500], [200, 200], (u, raw) => { if (at(u, 'observablehq.com', /^\/embed\/(?:@[^/]+\/[^/]+|[^/]+)$/)) return raw; const m = at(u, 'observablehq.com', /^\/(?:d\/([^/]+)|(@[^/]+\/[^/]+))$/); return m ? `https://observablehq.com/embed/${m[1] || m[2]}?cell=*` : null }),
  entry('G22', 'Desmos', [700, 450], [200, 200], (u, raw) => at(u, 'www.desmos.com', /^\/calculator\/[a-z0-9]{10}$/) && !u.hash && ['', '?embed'].includes(u.search) ? u.search ? raw : raw + '?embed' : null)
])

export function resolveExternalEmbed(value) {
  if (typeof value !== 'string') return null
  let url
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null
  for (const service of EXTERNAL_EMBED_SERVICES) {
    const src = service.convert(url, value)
    if (src) return { service, src, attributes: service.attributes }
  }
  return null
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
