// Source identification and sizing only; URL construction belongs to renderer.
// Constraints measured through the isolated legacy UI, 2026-11-25. The locked
// video-provider minimum follows the current aspect ratio at height 200.
const at = (url, host, path) => url.hostname === host && path.test(url.pathname)
const figmaFile = url => at(url, 'www.figma.com', /^\/(?:file|design|proto)\/[A-Za-z0-9]{22}\/[^/]+\/?$/)
function figma(url) {
  if (figmaFile(url)) return true
  if (!at(url, 'www.figma.com', /^\/embed$/)) return false
  try { return figmaFile(new URL(url.searchParams.get('url'))) } catch { return false }
}
const entry = (id, matches, minWidth = 200, minHeight = 200, extra = {}) => ({ matches, value: Object.freeze({ id, minWidth, minHeight, canResize: true, lockAspectRatio: false, ...extra }) })
const services = [
  entry('G05', u => at(u, 'www.tldraw.com', /^\/r\/[A-Za-z0-9_-]+\/?$/), 300, 300),
  entry('G06', figma),
  entry('G07', u => at(u, 'www.canva.com', /^\/design\/[^/]+\/(?:[^/]+\/)?view\/?$/)),
  entry('G08', u => at(u, 'www.google.com', /^\/maps\/embed$/) && !!u.searchParams.get('pb')),
  entry('G09', u => at(u, 'www.val.town', /^\/(?:v|embed)\/([^/]+(?:\/[^/]+)?)$/), 260, 100),
  entry('G10', u => at(u, 'codesandbox.io', /^\/(?:s|embed)\/[^/]+$/), 300, 300),
  entry('G11', u => at(u, 'codepen.io', /^\/[^/]+\/(?:pen|embed)\/[^/]+$/), 300, 300),
  entry('G12', u => at(u, 'scratch.mit.edu', /^\/projects\/[A-Za-z0-9_-]+(?:\/[^/]+)?\/?$/), 200, 200, { canResize: false }),
  entry('G13', u => at(u, 'www.youtube.com', /^\/embed\/[A-Za-z0-9_-]+$/) || at(u, 'youtu.be', /^\/[A-Za-z0-9_-]+$/) || at(u, 'www.youtube.com', /^\/watch$/) && /^[A-Za-z0-9_-]+$/.test(u.searchParams.get('v') || ''), 200, 200, { lockAspectRatio: true }),
  entry('G14', u => at(u, 'calendar.google.com', /^\/calendar\/embed$/) && !!u.searchParams.get('src') || at(u, 'calendar.google.com', /^\/calendar\/u\/0\/r$/) && !!u.searchParams.get('cid'), 460, 360),
  entry('G15', u => at(u, 'docs.google.com', /^\/presentation\/d\/e\/[^/]+\/(pub|embed)$/), 460, 360),
  // Gist remains a bookmark fallback, so it has no recognized embed URL.
  entry('G16', () => false),
  entry('G17', u => at(u, 'replit.com', /^\/@[^/]+\/[^/]+$/)),
  entry('G18', u => at(u, 'felt.com', /^\/(?:embed\/)?map\/[^/]+$/)),
  entry('G19', u => at(u, 'open.spotify.com', /^\/(?:embed\/)?album\/[A-Za-z0-9]{22}$/), 200, 500),
  entry('G20', u => at(u, 'player.vimeo.com', /^\/video\/\d+$/) || at(u, 'vimeo.com', /^\/\d+(?:\/[^/]+)?$/), 200, 200, { lockAspectRatio: true }),
  entry('G21', u => at(u, 'observablehq.com', /^\/embed\/(?:@[^/]+\/[^/]+|[^/]+)$/) || at(u, 'observablehq.com', /^\/(?:d\/[^/]+|@[^/]+\/[^/]+)$/)),
  entry('G22', u => at(u, 'www.desmos.com', /^\/calculator\/[a-z0-9]{10}$/) && !u.hash && ['', '?embed'].includes(u.search)),
]

export const getEmbedServiceConstraints = id => services.find(service => service.value.id === id)?.value || null

export function getEmbedService(value) {
  if (typeof value !== 'string') return null
  let url
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null
  return services.find(service => service.matches(url))?.value || null
}
