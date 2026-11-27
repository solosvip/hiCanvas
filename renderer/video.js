import { createElement as h, useEffect, useRef, useState } from 'react'
import { useValue } from '@tldraw/state-react'
import { videoSource } from './video-source.js'

export function Video({ scene, shape }) {
  const asset = useValue('video asset', () => scene.store.get(shape.props.assetId), [scene, shape.props.assetId])
  const interacting = useValue('video interaction', () => scene.videoState?.get()?.interactingVideoId === shape.id, [scene, shape.id])
  const playback = useValue('video playback', () => scene.videoState?.get()?.videoPlayback?.[shape.id], [scene, shape.id])
  const src = asset?.type === 'video' ? videoSource(asset.props.src) : null
  const [failed, setFailed] = useState(null), ref = useRef(null)
  const current = playback && playback.assetId === shape.props.assetId ? playback : shape.props
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const apply = () => {
      if (Number.isFinite(current.time) && Math.abs(node.currentTime - current.time) > .1) node.currentTime = Math.min(current.time, Number.isFinite(node.duration) ? node.duration : current.time)
      if (current.playing && node.paused) void node.play().catch(() => {})
      else if (!current.playing && !node.paused) node.pause()
    }
    apply(); node.addEventListener('loadedmetadata', apply)
    return () => node.removeEventListener('loadedmetadata', apply)
  }, [src, current.time, current.playing])
  const report = event => scene.onVideoInput?.({ type: 'playback', id: shape.id, assetId: shape.props.assetId, time: event.currentTarget.currentTime, playing: !event.currentTarget.paused })
  const broken = !src || failed === src
  return h('div', { 'data-video-state': broken ? 'missing' : 'ready', ...(interacting && { 'data-canvas-input-owner': 'video' }), style: { position: 'relative', width: shape.props.w, height: shape.props.h, overflow: 'hidden', pointerEvents: interacting ? 'auto' : 'none', background: 'var(--color-minimap-background)', color: 'var(--color-secondary)' } },
    broken ? h('span', { role: 'img', 'aria-label': '视频不可用' }, '视频不可用') : h('video', { key: src, ref, src, muted: true, loop: true, playsInline: true, controls: interacting, preload: 'metadata', disablePictureInPicture: true, disableRemotePlayback: true, 'aria-label': shape.props.altText || asset.props.name || '视频', style: { display: 'block', width: '100%', height: '100%', objectFit: 'cover' }, onError: () => setFailed(src), onPlay: report, onPause: report, onSeeked: report, onTimeUpdate: report }))
}
