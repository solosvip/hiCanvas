export const MAX_HTTP_URL_BYTES = 8192

// A link is data, never permission to fetch. Public-address/DNS checks belong
// to the later server metadata boundary; bookmarks may also describe local URLs.
export function normalizeHttpUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f\\]/u.test(value) || new TextEncoder().encode(value).length > MAX_HTTP_URL_BYTES) return null
  const text = value.trim()
  if (!/^https?:\/\//i.test(text) || /\s/u.test(text)) return null
  try {
    const url = new URL(text)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.port) return null
    return url.href
  } catch { return null }
}
