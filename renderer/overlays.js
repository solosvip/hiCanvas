import { createElement as h } from 'react'
import { useValue } from '@tldraw/state-react'
import { StaticFrame } from './image.js'
import { checkedScribble, ScribbleOverlay } from './scribble-overlay.js'
import { checkedConnectionOverlay, ConnectionOverlay } from './connection-overlay.js'
import { checkedSnapGuides, SnapGuides } from './snap-guides.js'
import { checkedGrid } from './grid.js'
import { checkedEraser, EraserOverlay } from './eraser-overlay.js'
import { checkedLaser, LaserOverlay } from './laser-overlay.js'
const overlayStyle = Object.freeze({ position: 'absolute', inset: 'var(--spacing-none)', pointerEvents: 'none', transformOrigin: '0 0' })
const itemStyle = Object.freeze({ position: 'absolute', left: 'var(--spacing-none)', top: 'var(--spacing-none)', transformOrigin: '0 0' })

export function checkedOverlays(value) {
  if (!Array.isArray(value)) throw new Error('覆盖层需要描述数组。')
  const laserIds = new Set()
  return Object.freeze(value.map(item => {
    if (item?.kind === 'scribble') return checkedScribble(item)
    if (item?.kind === 'eraser') return checkedEraser(item)
    if (item?.kind === 'laser') {
      const checked = checkedLaser(item)
      if (laserIds.has(checked.id)) throw new Error('激光轨迹ID不能重复。')
      if (laserIds.size === 32) throw new Error('激光覆盖层最多32段。')
      laserIds.add(checked.id)
      return checked
    }
    if (item?.kind === 'snap-guides') return checkedSnapGuides(item)
    if (item?.kind === 'grid') return checkedGrid(item)
    if (['connection', 'snap', 'note'].includes(item?.kind)) return checkedConnectionOverlay(item)
    const b = item?.bounds
    if (!['selection', 'marquee', 'crop'].includes(item?.kind) || !b || ![b.x, b.y, b.w, b.h].every(Number.isFinite) || b.w < 0 || b.h < 0) throw new Error('覆盖层描述需要有效种类和画布外框。')
    const image = item.image
    if (item.kind === 'crop' && (!image || typeof image.src !== 'string' || ![image.x, image.y, image.w, image.h].every(Number.isFinite) || image.w <= 0 || image.h <= 0)) throw new Error('裁剪覆盖层需要有效的原图描述。')
    if (item.rotation !== undefined && !Number.isFinite(item.rotation)) throw new Error('覆盖层旋转需要有限弧度。')
    if (item.handles !== undefined && (!Array.isArray(item.handles) || item.handles.some(h => !h || typeof h.id !== 'string' || !['resize', 'rotate'].includes(h.kind) || ![h.x, h.y].every(Number.isFinite)))) throw new Error('手柄需要有效的种类和选择框内坐标。')
    return Object.freeze({ ...(item.kind === 'crop' && { image: Object.freeze({ src: image.src, x: image.x, y: image.y, w: image.w, h: image.h, flipX: Boolean(image.flipX), flipY: Boolean(image.flipY), isAnimated: Boolean(image.isAnimated), playing: image.playing !== false }) }), ...(item.rotation !== undefined && { rotation: item.rotation }), ...(item.handles && { handles: Object.freeze(item.handles.map(h => Object.freeze({ ...h }))) }), kind: item.kind, ...(typeof item.id === 'string' && { id: item.id }), bounds: Object.freeze({ x: b.x, y: b.y, w: b.w, h: b.h }) })
  }))
}

function CropSource({ image, reduceMotion }) {
  if (!image?.src) return null
  const style = { position: 'absolute', left: image.x, top: image.y, maskImage: 'linear-gradient(var(--color-overlay-crop-ghost),var(--color-overlay-crop-ghost))', transform: `scale(${image.flipX ? -1 : 1},${image.flipY ? -1 : 1})` }
  return image.isAnimated && (reduceMotion || !image.playing) ? h(StaticFrame, { src: image.src, alt: '', width: image.w, height: image.h, style }) : h('img', { src: image.src, alt: '', draggable: false, width: image.w, height: image.h, style })
}

export function CanvasOverlays({ camera, overlays, reduceMotion }) {
  const view = useValue(camera), items = useValue(overlays)
  const still = useValue('crop image motion', () => reduceMotion?.get() || false, [reduceMotion])
  // SVG camera transforms invalidate Chromium layout even with no rectangles.
  // Position the HTML layer through compositing, as the scene does. Each edge
  // counter-scales only its thickness. Fractional CSS outlines round to device
  // pixels before the outer scale, so they cannot keep a constant screen width.
  return h('div', { style: { ...overlayStyle, transform: `scale(${view.z}) translate3d(${view.x}px,${view.y}px,0)` }, 'data-canvas-overlays': '', 'aria-hidden': true },
    items.map((item, i) => {
      if (item.kind === 'grid') return null // Grid lives below the shape world.
      if (item.kind === 'scribble') return h(ScribbleOverlay, { key: `scribble:${i}`, item, zoom: view.z })
      if (item.kind === 'eraser') return h(EraserOverlay, { key: `eraser:${i}`, item, zoom: view.z })
      if (item.kind === 'laser') return h(LaserOverlay, { key: `laser:${item.id}`, item, zoom: view.z })
      if (item.kind === 'snap-guides') return h(SnapGuides, { key: `snap-guides:${i}`, item, zoom: view.z })
      if (['connection', 'snap', 'note'].includes(item.kind)) return h(ConnectionOverlay, { key: `${item.kind}:${item.id || i}`, item, zoom: view.z })
      const brush = item.kind === 'marquee', stroke = `var(--spacing-overlay-${brush ? 'brush' : 'selection'}-stroke)`
      return h('div', { key: `${item.kind}:${item.id || i}`, 'data-overlay-kind': item.kind, 'data-overlay-id': item.id,
        style: { ...itemStyle, width: item.bounds.w, height: item.bounds.h, transform: `translate3d(${item.bounds.x}px,${item.bounds.y}px,0) rotate(${item.rotation || 0}rad)`, backgroundColor: brush ? 'var(--color-overlay-brush-fill)' : undefined } },
        item.kind === 'crop' && h(CropSource, { image: item.image, reduceMotion: still }),
        item.kind === 'crop' && (item.handles || []).filter(handle => handle.kind === 'resize' && !handle.corner).map(handle => h('div', { key: `crop-edge:${handle.id}`, 'data-crop-handle': handle.id, style: { ...itemStyle,
          width: `var(--spacing-overlay-handle-${['top', 'bottom'].includes(handle.id) ? 'size' : 'stroke'})`, height: `var(--spacing-overlay-handle-${['top', 'bottom'].includes(handle.id) ? 'stroke' : 'size'})`, backgroundColor: 'var(--color-primary)',
          transform: `translate3d(${handle.x}px,${handle.y}px,0) scale(${1 / view.z}) translate(-50%,-50%)` } })),
        ['top', 'bottom', 'left', 'right'].map(edge => {
          const horizontal = edge === 'top' || edge === 'bottom'
          return h('div', { key: edge, 'data-overlay-stroke': edge, style: { ...itemStyle,
            left: edge === 'right' ? '100%' : 'var(--spacing-none)', top: edge === 'bottom' ? '100%' : 'var(--spacing-none)',
            width: horizontal ? '100%' : stroke, height: horizontal ? stroke : '100%',
            backgroundColor: brush ? 'var(--color-overlay-brush-stroke)' : 'var(--color-primary)',
            transform: horizontal ? `scaleY(${1 / view.z}) translateY(-50%)` : `scaleX(${1 / view.z}) translateX(-50%)` } })
        }),
        (item.handles || []).filter(handle => handle.kind === 'resize' && handle.corner).map(handle => h('div', { key: `handle:${handle.id}`, 'data-selection-handle': handle.id, style: {
          ...itemStyle, width: 'var(--spacing-overlay-handle-size)', height: 'var(--spacing-overlay-handle-size)',
          boxSizing: 'border-box', border: 'var(--spacing-overlay-handle-stroke) solid var(--color-primary)', backgroundColor: 'var(--color-surface)',
          transform: `translate3d(${handle.x}px,${handle.y}px,0) scale(${1 / view.z}) translate(-50%,-50%)` } })))
    }))
}
