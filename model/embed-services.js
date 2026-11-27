import { normalizeHttpUrl } from './http-url.js'

// Model owns source recognition, canonical URLs, default sizes and constraints.
// Renderer alone grants provider frame permissions (ADR0013).
const at = (u, host, path) => u.hostname === host && path.test(u.pathname)
const figmaFile = u => at(u, 'www.figma.com', /^\/(?:file|design|proto)\/[A-Za-z0-9]{22}\/[^/]+\/?$/)
function figma(u) {
  if (figmaFile(u)) return true
  if (!at(u, 'www.figma.com', /^\/embed$/)) return false
  const inner = normalizeHttpUrl(u.searchParams.get('url'))
  return !!inner && new URL(inner).protocol === 'https:' && figmaFile(new URL(inner))
}
function append(u, name, value, always = false) {
  const copy = new URL(u.href)
  if (always || !copy.searchParams.has(name)) copy.searchParams.append(name, value)
  return copy.href
}
function youtube(u) {
  if (u.hostname === 'www.youtube.com' && u.pathname.startsWith('/embed/')) return u.href
  const id = u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v')
  const query = new URLSearchParams(u.search)
  query.delete('v')
  // 2026-11-27 isolated native observation: controls/autoplay survive and t
  // becomes start at the end of the query. Existing embed queries survive.
  const time = query.get('t')
  if (time !== null) { query.delete('t'); query.set('start', time) }
  return `https://www.youtube.com/embed/${id}${query.size ? '?' + query : ''}`
}
function figmaSource(u) {
  if (u.pathname === '/embed') return u.href
  const target = new URL('https://www.figma.com/embed')
  target.searchParams.set('embed_host', 'share'); target.searchParams.set('url', u.href)
  return target.href
}
const entry = (id, name, size, matches, convert, constraints = {}) => Object.freeze({
  id, name, size: Object.freeze(size), matches, convert,
  value: Object.freeze({ id, minWidth: 200, minHeight: 200, canResize: true, lockAspectRatio: false, ...constraints }),
})
// Sizes were read from opaque legacy runtime records in the 52-group native
// observation on 2026-11-27. Gist remains a bookmark until the #206 wrapper.
const services = [
  entry('G05', 'tldraw', [720, 500], u => at(u, 'www.tldraw.com', /^\/r\/[A-Za-z0-9_-]+\/?$/), u => u.href, { minWidth: 300, minHeight: 300 }),
  entry('G06', 'Figma', [720, 500], figma, figmaSource),
  entry('G07', 'Canva', [720, 500], u => at(u, 'www.canva.com', /^\/design\/[^/]+\/(?:[^/]+\/)?view\/?$/), u => append(u, 'embed', '')),
  entry('G08', 'Google Maps', [720, 500], u => at(u, 'www.google.com', /^\/maps\/embed$/) && !!u.searchParams.get('pb'), u => u.href),
  entry('G09', 'Val Town', [720, 500], u => at(u, 'www.val.town', /^\/(?:v|embed)\/([^/]+(?:\/[^/]+)?)$/), u => 'https://www.val.town/embed/' + u.pathname.split('/').slice(2).join('/'), { minWidth: 260, minHeight: 100 }),
  entry('G10', 'CodeSandbox', [720, 500], u => at(u, 'codesandbox.io', /^\/(?:s|embed)\/[^/]+$/), u => 'https://codesandbox.io/embed/' + u.pathname.split('/')[2], { minWidth: 300, minHeight: 300 }),
  entry('G11', 'CodePen', [520, 400], u => at(u, 'codepen.io', /^\/[^/]+\/(?:pen|embed)\/[^/]+$/), u => `https://codepen.io/${u.pathname.split('/')[1]}/embed/${u.pathname.split('/')[3]}${u.search}${u.hash}`, { minWidth: 300, minHeight: 300 }),
  entry('G12', 'Scratch', [520, 400], u => at(u, 'scratch.mit.edu', /^\/projects\/[A-Za-z0-9_-]+(?:\/[^/]+)?\/?$/), u => 'https://scratch.mit.edu/projects/embed/' + u.pathname.split('/')[2], { canResize: false }),
  entry('G13', 'YouTube', [800, 450], u => at(u, 'www.youtube.com', /^\/embed\/[A-Za-z0-9_-]+$/) || at(u, 'youtu.be', /^\/[A-Za-z0-9_-]+$/) || at(u, 'www.youtube.com', /^\/watch$/) && /^[A-Za-z0-9_-]+$/.test(u.searchParams.get('v') || ''), youtube, { lockAspectRatio: true }),
  entry('G14', 'Google Calendar', [720, 500], u => at(u, 'calendar.google.com', /^\/calendar\/embed$/) && !!u.searchParams.get('src') || at(u, 'calendar.google.com', /^\/calendar\/u\/0\/r$/) && !!u.searchParams.get('cid'), u => u.pathname === '/calendar/embed' ? u.href : 'https://calendar.google.com/calendar/embed?src=' + encodeURIComponent(u.searchParams.get('cid')), { minWidth: 460, minHeight: 360 }),
  entry('G15', 'Google Slides', [720, 500], u => at(u, 'docs.google.com', /^\/presentation\/d\/e\/[^/]+\/(pub|embed)$/), u => u.pathname.endsWith('/embed') ? u.href : `https://docs.google.com/presentation/d/e/${u.pathname.split('/')[4]}/embed${u.hash}`, { minWidth: 460, minHeight: 360 }),
  entry('G16', 'GitHub Gist', [720, 500], () => false, () => null),
  entry('G17', 'Replit', [720, 500], u => at(u, 'replit.com', /^\/@[^/]+\/[^/]+$/), u => append(u, 'embed', 'true', true)),
  entry('G18', 'Felt', [720, 500], u => at(u, 'felt.com', /^\/(?:embed\/)?map\/[^/]+$/), u => 'https://felt.com/embed/map/' + u.pathname.split('/').at(-1)),
  entry('G19', 'Spotify', [720, 500], u => at(u, 'open.spotify.com', /^\/(?:embed\/)?album\/[A-Za-z0-9]{22}$/), u => 'https://open.spotify.com/embed/album/' + u.pathname.split('/').at(-1), { minHeight: 500 }),
  entry('G20', 'Vimeo', [640, 360], u => at(u, 'player.vimeo.com', /^\/video\/\d+$/) || at(u, 'vimeo.com', /^\/\d+(?:\/[^/]+)?$/), u => u.hostname === 'player.vimeo.com' ? u.href : `https://player.vimeo.com/video/${u.pathname.split('/')[1]}?title=0&byline=0`, { lockAspectRatio: true }),
  entry('G21', 'Observable', [720, 500], u => at(u, 'observablehq.com', /^\/embed\/(?:@[^/]+\/[^/]+|[^/]+)$/) || at(u, 'observablehq.com', /^\/(?:d\/[^/]+|@[^/]+\/[^/]+)$/), u => u.pathname.startsWith('/embed/') ? u.href : `https://observablehq.com/embed/${u.pathname.startsWith('/d/') ? u.pathname.slice(3) : u.pathname.slice(1)}?cell=*`),
  entry('G22', 'Desmos', [700, 450], u => at(u, 'www.desmos.com', /^\/calculator\/[a-z0-9]{10}$/) && !u.hash && ['', '?embed'].includes(u.search), u => u.search ? u.href : u.href + '?embed'),
]
export const EMBED_SERVICES = Object.freeze(services.map(({ id, name, size }) => Object.freeze({ id, name, size, available: id !== 'G16' })))
export const getEmbedServiceConstraints = id => services.find(s => s.id === id)?.value || null

function decoded(value) {
  for (let i = 0; i < 4; i++) {
    try { const next = decodeURIComponent(value); if (next === value) break; value = next } catch { break }
  }
  return value
}
function checked(value) {
  const normalized = normalizeHttpUrl(value)
  if (!normalized) return null
  const u = new URL(normalized)
  if (u.protocol !== 'https:' || /[\\\u0000-\u001f\u007f]/u.test(decoded(u.pathname)) || /%(?:2f|5c)/i.test(u.pathname)) return null
  // A decoded slash inside an originally escaped segment changes the provider
  // path grammar; no second decoder may reinterpret it as a service/ID boundary.
  if (u.pathname.split('/').some(part => decoded(part).includes('/'))) return null
  return u
}
export function getEmbedService(value) {
  const u = checked(value)
  return u ? services.find(s => s.matches(u))?.value || null : null
}
const redirectField = /^(?:redirect(?:_?(?:uri|url))?|return(?:_?(?:to|url))?|next|target|callback|continue)$/i
const nestedAddress = value => /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(decoded(value).trim()) || /[\u0000-\u001f\u007f]/u.test(decoded(value))
function safeParameters(u, id) {
  if (id === 'G06' && u.pathname === '/embed') {
    const inner = resolveEmbedUrl(u.searchParams.get('url'))
    if (inner?.id !== 'G06' || new URL(inner.url).pathname === '/embed') return null
    u.searchParams.set('url', inner.url)
  }
  for (const [name, value] of [...u.searchParams]) {
    if (id === 'G06' && u.pathname === '/embed' && name === 'url') continue
    if (redirectField.test(name) || /[\u0000-\u001f\u007f]/u.test(decoded(name)) || nestedAddress(value)) u.searchParams.delete(name)
  }
  if (nestedAddress(u.hash.slice(1))) u.hash = ''
  return u
}
export function resolveEmbedUrl(value) {
  const u = checked(value)
  if (!u) return null
  const service = services.find(s => s.matches(u))
  if (!service || !safeParameters(u, service.id) || !service.matches(u)) return null
  const src = service.convert(u)
  return src ? Object.freeze({ id: service.id, name: service.name, url: u.href, src, size: service.size }) : null
}
