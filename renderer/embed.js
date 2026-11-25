import { createElement as h, useEffect, useState } from 'react'
import { useValue } from '@tldraw/state-react'
import { describeEmbed, loadEmbedHtml, EMBED_FRAME_ATTRIBUTES } from './embed-content.js'

export function ContentPlaceholder({ shape, title, message }) {
  return h('div', { 'data-content-placeholder': '', role: 'status', style: { width: shape.props.w, height: shape.props.h, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 'var(--spacing-sm)', padding: 'var(--spacing-md)', overflow: 'hidden', overflowWrap: 'anywhere', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-on-surface)', fontFamily: 'var(--font-body-md)', fontSize: 'var(--text-body-md)' } },
    h('strong', null, title), h('span', null, message))
}

export function Embed({ shape, scene }) {
  const { kind, source, draft } = describeEmbed(shape)
  const asset = useValue('bookmark metadata', () => shape.type === 'bookmark' && shape.props.assetId ? scene.store.get(shape.props.assetId) : null, [scene, shape.type, shape.props.assetId])
  const [loaded, setLoaded] = useState(null)
  const revision = shape.meta?.cowartHtmlDraftContentHash
  useEffect(() => {
    if (!source) return undefined
    const controller = new AbortController()
    loadEmbedHtml(source, { signal: controller.signal })
      .then(html => { if (!controller.signal.aborted) setLoaded({ source, revision, html }) })
      .catch(error => { if (!controller.signal.aborted) setLoaded({ source, revision, error: error.message }) })
    return () => controller.abort()
  }, [source, revision])
  const current = loaded?.source === source && loaded?.revision === revision ? loaded : null
  if (current?.html) return h('iframe', { ...EMBED_FRAME_ATTRIBUTES, 'data-embed-content': shape.id, title: kind, srcDoc: current.html, allow: kind === '影片' ? 'autoplay' : undefined, width: shape.props.w, height: shape.props.h, style: { display: 'block', pointerEvents: 'none', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' } })
  return h(ContentPlaceholder, { shape, title: asset?.props.title || kind, message: current?.error || (source ? '内容加载中' : draft ? '内容暂不可用' : asset?.props.description || '外部内容占位') })
}
