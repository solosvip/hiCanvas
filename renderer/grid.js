import { createElement as h, useId } from 'react'
import { useValue } from '@tldraw/state-react'

const style = Object.freeze({ position: 'absolute', inset: 'var(--spacing-none)', width: '100%', height: '100%', pointerEvents: 'none' })
export function checkedGrid(item) {
  const b = item.bounds
  if (!b || ![b.x, b.y, b.w, b.h].every(Number.isFinite) || b.w < 0 || b.h < 0 || !Number.isFinite(item.spacing * 64) || typeof item.spacing !== 'number' || item.spacing <= 0) throw new Error('网格描述需要有限外框和正数格距。')
  return Object.freeze({ kind: 'grid', bounds: Object.freeze({ x: b.x, y: b.y, w: b.w, h: b.h }), spacing: item.spacing })
}

// A constant number of SVG patterns covers the viewport. Camera movement never
// enumerates dots or board records; modulo before scaling keeps large pans safe.
export function CanvasGrid({ camera, overlays }) {
  const view = useValue(camera), items = useValue(overlays), id = useId().replaceAll(':', '')
  const grid = items.find(item => item.kind === 'grid')
  if (!grid) return null
  const layers = [64, 16, 4, 1].map(factor => {
    const spacing = grid.spacing * factor, step = spacing * view.z
    return { factor, step, x: (view.x % spacing) * view.z, y: (view.y % spacing) * view.z, id: `${id}-grid-${factor}` }
  }).filter(layer => Number.isFinite(layer.step) && layer.step > 0 && Number.isFinite(layer.x) && Number.isFinite(layer.y))
  return h('svg', { style, 'data-overlay-kind': 'grid', 'aria-hidden': true },
    h('defs', null, layers.map(layer => h('pattern', { key: layer.id, id: layer.id, width: layer.step, height: layer.step, x: layer.x, y: layer.y, patternUnits: 'userSpaceOnUse', 'data-grid-factor': layer.factor },
      h('circle', { 'data-grid-dot': '', style: {
        '--grid-step': `${layer.step}px`,
        cx: 'var(--spacing-grid-dot-offset)', cy: 'var(--spacing-grid-dot-offset)', r: 'var(--spacing-grid-dot-radius)', fill: 'var(--color-grid-dot)',
        opacity: `clamp(0, calc((var(--grid-step) - var(--spacing-grid-l${layer.factor}-fade-start)) / var(--spacing-grid-l${layer.factor}-fade-range)), 1)`,
      } })))),
    layers.map(layer => h('rect', { key: layer.id, width: '100%', height: '100%', fill: `url(#${layer.id})` })))
}
