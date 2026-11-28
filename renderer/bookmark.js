import { createElement as h, useState } from 'react'
import { useValue } from '@tldraw/state-react'

function linkUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url : null } catch { return null }
}

function imageUrl(value) {
  if (typeof value !== 'string') return null
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(value)) return value
  if (/^\/(?!\/)/.test(value)) return value
  const url = linkUrl(value)
  if (url?.hostname === 'cowart.local') return url.pathname + url.search
  return url?.href || null
}

const clamp = lines => ({ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines, overflow: 'hidden', textOverflow: 'ellipsis', overflowWrap: 'anywhere' })
const linkStyle = { display: 'flex', minWidth: 0, color: 'inherit', textDecoration: 'none' }

function LinkIcon() {
  return h('svg', { 'data-bookmark-link-icon': '', width: 15, height: 15, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true, style: { flexShrink: 0 } }, h('path', { d: 'M8 4H4v12h12v-4M11 3h6v6M17 3l-9 9' }))
}

function Favicon({ src }) {
  const [failed, setFailed] = useState(false)
  return src && !failed ? h('img', { 'data-bookmark-favicon': '', src, alt: '', draggable: false, width: 16, height: 16, referrerPolicy: 'no-referrer', onError: () => setFailed(true), style: { flexShrink: 0 } }) : h(LinkIcon)
}

export function Bookmark({ shape, scene }) {
  const asset = useValue('bookmark metadata', () => shape.props.assetId ? scene.store.get(shape.props.assetId) : null, [scene, shape.props.assetId])
  const metadata = asset?.type === 'bookmark' ? asset.props : {}, url = linkUrl(shape.props.url)
  const [failedImage, setFailedImage] = useState(null)
  const title = metadata.title || '', description = metadata.description || '', candidate = imageUrl(metadata.image), image = candidate !== failedImage ? candidate : null, favicon = imageUrl(metadata.favicon)
  const link = { href: url?.href, target: '_blank', rel: 'noopener noreferrer', draggable: false, style: linkStyle }
  // Document card metrics measured from the running legacy UI, not application
  // chrome. Width/height always come from the record, including compact cards.
  return h('div', { 'data-bookmark': shape.id, style: { width: shape.props.w, height: shape.props.h, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid rgba(0,0,0,.08)', borderRadius: 6, background: 'var(--color-surface)', color: 'var(--color-on-surface)', fontFamily: 'var(--font-body-md)', fontSize: 12, boxShadow: '0 2px 4px rgba(0,0,0,.16), 0 3px 6px rgba(0,0,0,.12)' } },
    image ? h('div', { 'data-bookmark-preview': '', style: { position: 'relative', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' } },
      h('img', { 'data-bookmark-image': '', src: image, alt: title, draggable: false, referrerPolicy: 'no-referrer', onError: () => setFailedImage(image), style: { display: 'block', width: '100%', height: '100%', objectFit: 'cover' } }),
      h('a', { ...link, title: shape.props.url, 'aria-label': '打开链接', style: { ...linkStyle, position: 'absolute', right: 6, top: 6, padding: 8, borderRadius: 4, background: 'var(--color-surface)' } }, h(LinkIcon))) : null,
    h('div', { style: { boxSizing: 'border-box', display: 'flex', flexDirection: 'column', flex: image ? '0 0 auto' : '1 1 auto', gap: 4, padding: 12, minHeight: 0 } },
      title ? h('a', link, h('h2', { 'data-bookmark-title': '', style: { ...clamp(2), margin: 0, fontSize: 16, lineHeight: 1.6, fontWeight: 700 } }, title)) : null,
      description ? h('p', { 'data-bookmark-description': '', style: { ...clamp(3), margin: 0, fontSize: 12, lineHeight: '18px' } }, description) : null,
      h('a', { ...link, style: { ...linkStyle, alignItems: 'center', gap: 8, marginTop: image ? 8 : 'auto' } }, h(Favicon, { src: favicon, key: favicon || 'missing' }), h('span', { 'data-bookmark-url': '', style: { overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, url?.hostname.replace(/^www\./, '') || shape.props.url))))
}
