import { createElement as h, memo } from 'react'
import { atom } from '@tldraw/state'
import { useValue } from '@tldraw/state-react'
import { normalizeHttpUrl } from '../model/index.js'
import { boxPolygon, clipPolygon } from './polygon-clip.js'

const positioned = Object.freeze({ position: 'absolute', left: 'var(--spacing-none)', top: 'var(--spacing-none)', transformOrigin: '0 0' })
const style = `.hicanvas-shape-link { color: var(--color-shape-link-ink); }
.hicanvas-shape-link[data-selected="true"], .hicanvas-shape-link:hover { color: var(--color-shape-link-selected); }
.hicanvas-shape-link:focus-visible { outline: var(--spacing-overlay-selection-stroke) solid var(--color-primary); border-radius: var(--radius-xs); }`

export function checkedShapeLinks(value) {
  if (!Array.isArray(value)) throw new Error('链接层需要描述数组。')
  const ids = new Set(), point = p => p && [p.x, p.y].every(Number.isFinite)
  return Object.freeze(value.map(item => {
    const b = item?.bounds, url = normalizeHttpUrl(item?.url)
    if (!item || typeof item.id !== 'string' || !item.id.startsWith('shape:') || ids.has(item.id) || !url ||
      !point(item.origin) || !b || ![b.x, b.y, b.w, b.h, item.rotation, item.opacity].every(Number.isFinite) || b.w <= 0 || b.h <= 0 || item.opacity < 0 || item.opacity > 1 ||
      !Array.isArray(item.clips) || item.clips.some(polygon => !Array.isArray(polygon) || polygon.length !== 4 || polygon.some(p => !point(p)))) throw new Error('链接描述需要唯一形状、合法 HTTP(S) 地址及有限几何。')
    ids.add(item.id)
    return Object.freeze({ id: item.id, url, origin: Object.freeze({ ...item.origin }), bounds: Object.freeze({ ...b }), rotation: item.rotation,
      opacity: item.opacity, selected: Boolean(item.selected), clips: Object.freeze(item.clips.map(polygon => Object.freeze(polygon.map(p => Object.freeze({ x: p.x, y: p.y }))))) })
  }))
}

// Read the generated CSS token only when links are first displayed. Read-only
// hosts with no links need no editing stylesheet. No literal dimension fallback.
export function shapeLinkHitSize(element) {
  const value = element.ownerDocument.defaultView.getComputedStyle(element).getPropertyValue('--spacing-shape-link-hit').trim()
  if (!/^\d+(?:\.\d+)?px$/.test(value) || parseFloat(value) <= 0) throw new Error('链接层需要 DESIGN 生成的 shape-link-hit 尺寸令牌。')
  return parseFloat(value)
}

function frozenData(value, seen = new Set()) {
  if (typeof value === 'function') return false
  if (!value || typeof value !== 'object') return true
  if (!Object.isFrozen(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== null && prototype !== Object.prototype && !(Array.isArray(value) && prototype === Array.prototype)) return false
  if (seen.has(value)) return true
  seen.add(value)
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(d => 'value' in d && frozenData(d.value, seen))
}

export function createShapeLinkState(measureHitSize) {
  const state = atom('renderer shape links', { items: Object.freeze([]), hitSize: 0 })
  let source = null, immutable = false
  return { state, set(value) {
    if (value === source && immutable) return
    const items = checkedShapeLinks(value)
    state.set({ items, hitSize: items.length ? measureHitSize() : 0 })
    // A frozen outer array may still contain mutable values or accessors.
    // Only proven immutable data may bypass validation on future pointer frames.
    source = value; immutable = frozenData(value)
  } }
}

const Link = memo(function Link({ item, hitSize }) {
  if (!item.opacity) return null
  const { bounds: b } = item, hit = boxPolygon({ x: b.x + b.w - hitSize, y: b.y, w: hitSize, h: hitSize })
  let clip = null, visible = hit
  for (const polygon of item.clips) { visible = clipPolygon(visible, polygon); clip = clip ? clipPolygon(clip, polygon) : polygon }
  const area = visible.reduce((sum, p, i) => { const next = visible[(i + 1) % visible.length]; return sum + p.x * next.y - next.x * p.y }, 0)
  if (Math.abs(area) < 1e-9) return null
  const stopPointer = event => event.stopPropagation()
  return h('div', { 'data-shape-link-container': item.id, style: { ...positioned, width: b.w, height: b.h, opacity: item.opacity,
    transform: `translate3d(${item.origin.x}px,${item.origin.y}px,0) rotate(${item.rotation}rad)`,
    ...(clip && { clipPath: `polygon(${clip.map(p => `${p.x}px ${p.y}px`).join(',')})` }) } },
  h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer', 'aria-label': '打开链接', title: item.url,
    className: 'hicanvas-shape-link', 'data-shape-link': item.id, 'data-selected': item.selected, draggable: false,
    onPointerDown: stopPointer, onPointerUp: stopPointer, onDoubleClick: stopPointer,
    style: { position: 'absolute', left: `calc(${b.x + b.w}px - var(--spacing-shape-link-hit))`, top: b.y, pointerEvents: 'auto', display: 'grid', placeItems: 'center',
      width: 'var(--spacing-shape-link-hit)', height: 'var(--spacing-shape-link-hit)', cursor: 'pointer' } },
    h('span', { 'aria-hidden': true, style: { position: 'absolute', right: 'var(--spacing-shape-link-inset)', top: 'var(--spacing-shape-link-inset)',
      width: 'var(--spacing-shape-link-tile)', height: 'var(--spacing-shape-link-tile)', backgroundColor: 'var(--color-shape-link-background)', borderRadius: 'var(--radius-xs)', display: 'grid', placeItems: 'center', pointerEvents: 'none' } },
      h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 'var(--spacing-overlay-selection-stroke)', style: { width: 'var(--spacing-shape-link-icon)', height: 'var(--spacing-shape-link-icon)' } },
        h('path', { d: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2', strokeLinecap: 'round', strokeLinejoin: 'round' })))))
})

function LinkWorld({ camera, items, hitSize }) {
  const view = useValue(camera)
  return h('div', { 'data-shape-links': '', role: 'group', 'aria-label': '形状链接', style: { ...positioned, pointerEvents: 'none', transform: `scale(${view.z}) translate3d(${view.x}px,${view.y}px,0)` } },
    h('style', null, style), items.map(item => h(Link, { key: item.id, item, hitSize })))
}

export function ShapeLinks({ camera, links }) {
  const value = useValue(links)
  return value.items.length ? h(LinkWorld, { camera, ...value }) : null
}
