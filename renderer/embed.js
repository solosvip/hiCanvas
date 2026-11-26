import { createElement as h, useEffect, useState } from 'react'
import { describeEmbed, loadEmbedHtml, resolveExternalEmbed, EMBED_FRAME_ATTRIBUTES } from './embed-content.js'
import { Bookmark } from './bookmark.js'

export function ContentPlaceholder({ shape, title, message }) {
  return h('div', { 'data-content-placeholder': '', role: 'status', style: { width: shape.props.w, height: shape.props.h, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 'var(--spacing-sm)', padding: 'var(--spacing-md)', overflow: 'hidden', overflowWrap: 'anywhere', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-on-surface)', fontFamily: 'var(--font-body-md)', fontSize: 'var(--text-body-md)' } },
    h('strong', null, title), h('span', null, message))
}

export function Embed({ shape, scene }) {
  const { kind, source, draft } = describeEmbed(shape)
  const duration=Number(shape.meta?.cowartFilmDuration)
  const filmDuration=Number.isFinite(duration)&&duration>0?Math.min(120,Math.max(1,duration)):15
  const external = !source && !draft ? resolveExternalEmbed(shape.props.url) : null
  const [loaded, setLoaded] = useState(null)
  const revision = shape.meta?.cowartHtmlDraftContentHash
  useEffect(() => {
    if (!source) return undefined
    const controller = new AbortController()
    let frame
    loadEmbedHtml(source, { signal: controller.signal })
      .then(async html => {
        frame = scene.loadGeneratedFrame ? await scene.loadGeneratedFrame(html, { sourceUrl: source.startsWith('/') ? source : undefined, signal: controller.signal }) : { attributes: { srcDoc: html }, dispose() {} }
        if (controller.signal.aborted) { frame.dispose(); return }
        setLoaded({ source, revision, html, frame })
      })
      .catch(error => { if (!controller.signal.aborted) setLoaded({ source, revision, error: error.message }) })
    return () => { controller.abort(); frame?.dispose() }
  }, [source, revision])
  const current = loaded?.source === source && loaded?.revision === revision ? loaded : null
  if (!source && !draft) return external
    ? h('iframe', { ...external.attributes, 'data-embed-content': shape.id, 'data-external-service': external.service.id, title: external.service.name, src: external.src, width: shape.props.w, height: shape.props.h, style: { display: 'block', pointerEvents: 'none', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' } })
    : h(Bookmark, { shape, scene })
  if (current?.html) return h('iframe', { ...EMBED_FRAME_ATTRIBUTES, 'data-embed-content': shape.id, title: kind, ...current.frame.attributes, onLoad:event=>current.frame.bind?.(event.currentTarget,{film:kind==='影片',duration:filmDuration,muted:shape.meta?.cowartFilmMuted===true}), allow: kind === '影片' ? 'autoplay' : undefined, width: shape.props.w, height: shape.props.h, style: { display: 'block', pointerEvents: 'none', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' } })
  return h(ContentPlaceholder, { shape, title: kind, message: current?.error || (source ? '内容加载中' : draft ? '内容暂不可用' : '外部内容占位') })
}
