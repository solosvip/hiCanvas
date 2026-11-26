import { createElement as h, useEffect, useRef, useState } from 'react'
import { useValue } from '@tldraw/state-react'

export function StaticFrame({ src, alt, width, height, style }) {
  const ref = useRef(null)
  const [failed, setFailed] = useState(null)
  useEffect(() => {
    const canvas = ref.current, image = canvas.ownerDocument.createElement('img')
    setFailed(null)
    // Clear immediately on a new source, including while it loads or fails.
    canvas.width = canvas.height = 0
    canvas.dataset.imageStatic = 'loading'
    image.onload = () => {
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      // HTML canvas drawImage uses an animation's default/first frame, even
      // when the source element is already playing. This also works for a
      // cross-origin image: painting is allowed; reading/exporting is not used.
      // https://html.spec.whatwg.org/multipage/canvas.html#image-sources-for-2d-rendering-contexts
      canvas.getContext('2d').drawImage(image, 0, 0)
      canvas.dataset.imageStatic = 'ready'
    }
    image.onerror = () => { setFailed({ src }) }
    image.src = src
    return () => { image.onload = image.onerror = null; image.removeAttribute('src') }
  }, [src])
  if (failed && failed.src === src) return h('div', { role:'img', 'aria-label': `图片加载失败${alt ? `：${alt}` : ''}`, 'data-image-error':'', style:{width,height,color:'var(--color-secondary)',background:'var(--color-surface)',...style} }, '图片加载失败')
  return h('canvas', { ref, role: 'img', 'aria-label': alt, 'data-image-static': 'loading', style: { width, height, ...style } })
}

// 2026-11-26, offscreen native input in tldraw 5.1.1 with a synthetic
// 240×180 colour grid: Shift-H/V preserve the box and reflect its pixels.
// Cropping the left edge by 60 stores .25..1 even after a horizontal flip:
// crop coordinates address the already reflected full image, not the bitmap.
export function ImageShape({ scene, props }) {
  const asset = useValue('image asset', () => props.assetId ? scene.store.get(props.assetId) : undefined, [scene, props.assetId])
  const reduceMotion = useValue('image motion', () => scene.reduceMotion?.get() || false, [scene])
  const crop = props.crop, a = crop?.topLeft || { x: 0, y: 0 }, b = crop?.bottomRight || { x: 1, y: 1 }
  const width = props.w / (b.x - a.x), height = props.h / (b.y - a.y)
  const reflected = props.flipX || props.flipY
  const style = { ...(crop && { position: 'absolute', left: -a.x * width, top: -a.y * height }), ...(reflected && { transform: `scale(${props.flipX ? -1 : 1},${props.flipY ? -1 : 1})` }) }
  const source = asset?.props.src, alt = props.altText || ''
  const image = asset?.props.isAnimated && (reduceMotion || !props.playing)
    ? h(StaticFrame, { src: source, alt, width, height, style })
    : h('img', { src: source || undefined, alt, width, height, draggable: false, decoding: 'async', ...((crop || reflected) && { style }) })
  // The ordinary-image path retains the old element and attributes byte for
  // byte, so enabling crop support does not change its baseline/border pixels.
  // This is document geometry: each radius is half its own viewport axis.
  // A fixed decorative radius would turn non-square legacy crops into pills.
  return crop ? h('div', { 'data-image-crop': '', style: { position: 'relative', width: props.w, height: props.h, overflow: 'hidden', ...(crop.isCircle && { borderRadius: `${props.w / 2}px / ${props.h / 2}px` }) } }, image) : image
}
