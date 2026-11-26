import { createElement as h } from 'react'
import { useValue } from '@tldraw/state-react'
const overlayStyle = Object.freeze({ position: 'absolute', inset: 'var(--spacing-none)', pointerEvents: 'none', transformOrigin: '0 0' })
const itemStyle = Object.freeze({ position: 'absolute', left: 'var(--spacing-none)', top: 'var(--spacing-none)', transformOrigin: '0 0' })

export function checkedOverlays(value) {
  if (!Array.isArray(value)) throw new Error('覆盖层需要描述数组。')
  return Object.freeze(value.map(item => {
    const b = item?.bounds
    if (!['selection', 'marquee'].includes(item?.kind) || !b || ![b.x, b.y, b.w, b.h].every(Number.isFinite) || b.w < 0 || b.h < 0) throw new Error('覆盖层描述需要有效种类和画布外框。')
    if (item.rotation !== undefined && !Number.isFinite(item.rotation)) throw new Error('覆盖层旋转需要有限弧度。')
    if (item.handles !== undefined && (!Array.isArray(item.handles) || item.handles.some(h => !h || typeof h.id !== 'string' || !['resize', 'rotate'].includes(h.kind) || ![h.x, h.y].every(Number.isFinite)))) throw new Error('手柄需要有效的种类和选择框内坐标。')
    return Object.freeze({ ...(item.rotation !== undefined && { rotation: item.rotation }), ...(item.handles && { handles: Object.freeze(item.handles.map(h => Object.freeze({ ...h }))) }), kind: item.kind, ...(typeof item.id === 'string' && { id: item.id }), bounds: Object.freeze({ x: b.x, y: b.y, w: b.w, h: b.h }) })
  }))
}

export function CanvasOverlays({ camera, overlays }) {
  const view = useValue(camera), items = useValue(overlays)
  // SVG camera transforms invalidate Chromium layout even with no rectangles.
  // Position the HTML layer through compositing, as the scene does. Each edge
  // counter-scales only its thickness. Fractional CSS outlines round to device
  // pixels before the outer scale, so they cannot keep a constant screen width.
  return h('div', { style: { ...overlayStyle, transform: `scale(${view.z}) translate3d(${view.x}px,${view.y}px,0)` }, 'data-canvas-overlays': '', 'aria-hidden': true },
    items.map((item, i) => {
      const brush = item.kind === 'marquee', stroke = `var(--spacing-overlay-${brush ? 'brush' : 'selection'}-stroke)`
      return h('div', { key: `${item.kind}:${item.id || i}`, 'data-overlay-kind': item.kind, 'data-overlay-id': item.id,
        style: { ...itemStyle, width: item.bounds.w, height: item.bounds.h, transform: `translate3d(${item.bounds.x}px,${item.bounds.y}px,0) rotate(${item.rotation || 0}rad)`, backgroundColor: brush ? 'var(--color-overlay-brush-fill)' : undefined } },
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
