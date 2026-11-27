// Legacy data URLs remain readable. New files use only board-local paths;
// rejected URLs are never assigned to a media element (no external fetch).
export function videoSource(src) {
  if (typeof src !== 'string') return null
  if (/^data:video\/(?:mp4|webm|quicktime);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) return src
  if (!/^\/(?:assets\/[^/]+|page-assets\/[^/]+\/[^/]+|c\/[^/]+\/(?:assets\/[^/]+|page-assets\/[^/]+\/[^/]+))$/.test(src)) return null
  try {
    if (src.split('/').slice(1).some(p => { const v = decodeURIComponent(p); return !v || v === '.' || v === '..' || /[\\/\u0000?#]/.test(v) })) return null
  } catch { return null }
  return src
}
