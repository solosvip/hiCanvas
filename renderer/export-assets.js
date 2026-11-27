import { canvasFontFaces } from './fonts/manifest.js'
import { plainText } from './text.js'
import { CANVAS_EXPORT_LIMITS, exportSize } from './export-bounds.js'

// Check container-declared dimensions before handing bytes to an image decoder.
// This bounds normal source bitmaps, not the codec's private working memory.
function preflightImage(bytes, type, doc) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end))
  const check = (w, h) => exportSize({ x: 0, y: 0, w, h }, { scale: 1 })
  const invalid = () => { throw new Error('输出图片缺少可预检的有效尺寸。') }
  if (/^image\/(?:png|apng)$/.test(type) && bytes.length >= 24 && ascii(12, 16) === 'IHDR') return check(view.getUint32(16), view.getUint32(20))
  if (type === 'image/gif' && bytes.length >= 10 && /^GIF8[79]a$/.test(ascii(0, 6))) return check(view.getUint16(6, true), view.getUint16(8, true))
  if (/^image\/jpe?g$/.test(type) && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 7) return check(view.getUint16(offset + 5), view.getUint16(offset + 3))
      offset += length
    }
  }
  if (type === 'image/webp' && bytes.length >= 25 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const kind = ascii(12, 16), u24 = p => bytes[p] + bytes[p + 1] * 256 + bytes[p + 2] * 65536
    if (kind === 'VP8X' && bytes.length >= 30) return check(u24(24) + 1, u24(27) + 1)
    if (kind === 'VP8 ' && bytes.length >= 30) return check(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
    if (kind === 'VP8L') { const bits = view.getUint32(21, true); return check((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1) }
  }
  if (type === 'image/avif') {
    let count = 0, found = false
    function boxes(start, end, depth = 0) {
      if (depth > 12) invalid()
      while (start < end) {
        if (start + 8 > end || ++count > 2048) invalid()
        let length = view.getUint32(start), header = 8
        if (length === 1) { if (start + 16 > end) invalid(); length = Number(view.getBigUint64(start + 8)); header = 16 }
        if (length === 0) length = end - start
        if (!Number.isSafeInteger(length) || length < header || start + length > end) invalid()
        const kind = ascii(start + 4, start + 8), data = start + header, finish = start + length
        if (kind === 'ispe') { if (length !== header + 12) invalid(); check(view.getUint32(data + 4), view.getUint32(data + 8)); found = true }
        if (kind === 'meta') boxes(data + 4, finish, depth + 1)
        if (kind === 'iprp' || kind === 'ipco') boxes(data, finish, depth + 1)
        start = finish
      }
    }
    boxes(0, bytes.length)
    if (found) return
  }
  if (type === 'image/svg+xml') {
    const Parser = doc?.defaultView?.DOMParser || globalThis.DOMParser
    if (!Parser) invalid()
    const root = new Parser().parseFromString(new TextDecoder().decode(bytes), 'image/svg+xml').documentElement
    if (root?.localName !== 'svg' || root.querySelector('parsererror')) invalid()
    const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
    const dimension = (name, fallback) => {
      const value = root.getAttribute(name)
      if (value === null || /^\d+(?:\.\d+)?%$/.test(value)) return fallback
      if (!/^\s*(?:\d+(?:\.\d*)?|\.\d+)(?:px)?\s*$/.test(value)) invalid()
      return parseFloat(value)
    }
    return check(dimension('width', box?.length === 4 ? box[2] : 300), dimension('height', box?.length === 4 ? box[3] : 150))
  }
  invalid()
}

export const toDataUrl = (bytes, type) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return `data:${type};base64,${btoa(binary)}`
}
export const exportImagePlaceholder = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path fill="#f9fafb" stroke="#9fa8b2" d="M1 1H63V63H1Z"/><path fill="none" stroke="#9fa8b2" stroke-width="3" d="M12 48L26 32L36 42L46 26L56 48ZM12 12L52 52"/><circle cx="22" cy="20" r="5" fill="#9fa8b2"/></svg>')

function localAsset(value, origin) {
  if (typeof value !== 'string') return null
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|apng|svg\+xml)[;,]/i.test(value)) return value
  try {
    const url = new URL(value, origin || 'http://cowart.local')
    if (![origin, 'http://cowart.local', 'https://cowart.local'].includes(url.origin) || url.username || url.password || url.search || url.hash) return null
    if (!/^\/(?:c\/[^/]+\/)?(?:assets\/[^/]+|page-assets\/[^/]+\/[^/]+)$/.test(url.pathname)) return null
    if (url.pathname.split('/').slice(1).some(p => !p || ['.', '..'].includes(decodeURIComponent(p)) || /[\\/\0]/.test(decodeURIComponent(p)))) return null
    return url.pathname
  } catch { return null }
}

export async function waitExport(promise, signal) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { clean(); reject(signal.reason || new Error('输出已取消。')) }
    const clean = () => signal?.removeEventListener('abort', abort)
    signal?.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(value => { clean(); resolve(value) }, error => { clean(); reject(error) })
  })
}

async function readResponse(url, { signal }) {
  const response = await fetch(url, { signal, mode: 'same-origin', credentials: 'same-origin', redirect: 'error' })
  if (!response.ok) throw new Error(`输出素材加载失败：${response.status}`)
  const type = (response.headers.get('content-type') || '').split(';')[0]
  if (Number(response.headers.get('content-length')) > CANVAS_EXPORT_LIMITS.bytes) { void response.body?.cancel().catch(() => {}); throw new Error('输出素材超过64MB上限。') }
  const reader = response.body?.getReader(), chunks = []
  let length = 0
  if (!reader) throw new Error('输出素材没有可读取的数据。')
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > CANVAS_EXPORT_LIMITS.bytes) throw new Error('输出素材超过64MB上限。')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return { bytes, type }
}

export function createExportAssets({ document: doc, signal, readAsset = readResponse }) {
  let total = 0
  const stats = { blockedResources: 0, failedResources: 0 }, cache = new Map(), omitted = new Set()
  async function load(source, font = false) {
    signal.throwIfAborted()
    const url = font ? source : localAsset(source, doc?.location?.origin)
    if (!url) { stats.blockedResources++; throw new Error('输出素材不属于当前文档的本机资源。') }
    const key = String(url)
    if (!cache.has(key)) cache.set(key, (async () => {
      try {
        const data = await waitExport(readAsset(url, { signal }), signal)
        signal.throwIfAborted()
        if (!(data.bytes instanceof Uint8Array) || !data.bytes.length || !(font ? /^(?:font\/woff2|application\/(?:octet-stream|font-woff2))$/i : /^image\/(?:png|jpe?g|gif|webp|avif|apng|svg\+xml)$/i).test(data.type)) throw new Error('输出素材类型或数据无效。')
        total += data.bytes.length
        if (total > CANVAS_EXPORT_LIMITS.bytes) throw new Error('输出素材总量超过64MB上限。')
        if (!font) preflightImage(data.bytes, data.type.toLowerCase(), doc)
        return toDataUrl(data.bytes, font ? 'font/woff2' : data.type)
      } catch (error) { if (!signal.aborted) stats.failedResources++; throw error }
    })())
    return cache.get(key)
  }
  return { stats,
    warnings: () => omitted.size ? [`有${omitted.size}份外部图片未读取，已改为占位。`] : [],
    image(source) {
      signal.throwIfAborted()
      if (!localAsset(source, doc?.location?.origin) && typeof source === 'string') {
        let url
        try { url = new URL(source, doc?.location?.origin || 'http://cowart.local') } catch {}
        if (url && ['http:', 'https:', 'file:', 'ftp:'].includes(url.protocol)) {
          if (!omitted.has(source)) { omitted.add(source); stats.blockedResources++ }
          return Promise.resolve(null)
        }
      }
      return load(source)
    },
    async fonts(shapes) {
      const families = new Set(shapes.filter(s => ['text', 'geo', 'note', 'arrow'].includes(s.type) && plainText(s.props.richText).trim()).map(s => s.props.font || (s.type === 'note' ? 'draw' : 'sans')))
      const rules = []
      for (const face of canvasFontFaces) if (families.has(face.key)) {
        const url = await load(face.url, true)
        rules.push(`@font-face{font-family:"${face.family}";font-weight:${face.weight};font-style:${face.style};src:url("${url}") format("woff2");}`)
      }
      return rules.join('\n')
    },
  }
}
