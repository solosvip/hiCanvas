import { createElement as h, useCallback, useId, useSyncExternalStore } from 'react'
import { connectionView } from './connection-view.js'
import { colorPaint } from './palette.js'
import { PATTERN_METRICS, dashLayout } from './geo-metrics.js'

// Existing geo drawing is outside #71's edit scope. Keep this private painter
// on the shared metrics; extraction across shape painters belongs to that seam.
function Pattern({ id, props, paint }) {
  const scale = props.scale || 1, cell = PATTERN_METRICS.cell * scale
  const half = PATTERN_METRICS.dashLength * scale / (2 * Math.SQRT2)
  const d = Array.from({ length: PATTERN_METRICS.strokesPerCell }, (_, i) => {
    const center = cell * (i + .5) / PATTERN_METRICS.strokesPerCell
    return `M${center - half},${center + half} L${center + half},${center - half}`
  }).join(' ')
  return h('pattern', { id, patternUnits: 'userSpaceOnUse', width: cell, height: cell },
    h('rect', { width: cell, height: cell, fill: paint.semi }),
    h('path', { d, stroke: paint.pattern, strokeWidth: PATTERN_METRICS.lineWidth * scale, strokeLinecap: 'round', fill: 'none' }))
}

export function Connection({ scene, shape }) {
  const view = connectionView(scene.store), id = shape.id, maskId = useId(), patternId = useId()
  const subscribe = useCallback(notify => view.subscribe(id, notify), [view, id])
  const read = useCallback(() => view.get(id), [view, id])
  const geometry = useSyncExternalStore(subscribe, read, read)
  if (!geometry) return null
  const props = shape.props, { path, heads, label, bounds: b, width } = geometry
  const paint = colorPaint(props), patterned = props.fill === 'pattern'
  const fill = props.fill === 'none' ? 'none' : patterned ? `url(#${patternId})` : props.fill === 'lined-fill' ? paint.lined : paint[props.fill] || paint.solid
  const stroke = { stroke: paint.stroke, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round' }
  // Dash geometry follows the shared renderer contract; draw's irregular stroke
  // remains the separate hand-drawn line work. Heads are always solid.
  const dash = dashLayout(props, path.length)
  const padding = width * 4 + 1, gap = (props.scale || 1) * 4
  // An inline SVG shorter than the text strut is shifted by baseline layout.
  // Anchor it explicitly so drawing and pure geometry share the same origin.
  return h('svg', { width: Math.max(1, b.w), height: Math.max(1, b.h), overflow: 'visible', style: { position: 'absolute', left: 0, top: 0 }, 'data-connection': shape.type },
    h('defs', null,
      patterned ? h(Pattern, { id: patternId, props, paint }) : null,
      h('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: b.x - padding, y: b.y - padding, width: b.w + padding * 2, height: b.h + padding * 2 },
        h('rect', { x: b.x - padding, y: b.y - padding, width: b.w + padding * 2, height: b.h + padding * 2, fill: 'white' }),
        heads.filter(head => head.closed).map((head, key) => h('path', { key, d: head.d, fill: 'black' })),
        label ? h('rect', { x: label.bounds.x - gap, y: label.bounds.y - gap, width: label.bounds.w + gap * 2, height: label.bounds.h + gap * 2, rx: width, fill: 'black' }) : null)),
    h('path', { 'data-connection-body': '', d: path.d, fill: 'none', ...stroke, strokeDasharray: dash?.array.join(' '), strokeDashoffset: dash?.offset, mask: `url(#${maskId})` }),
    heads.map((head, i) => h('path', { key: i, 'data-connection-head': head.kind, d: head.d, fill: head.closed ? fill : 'none', ...stroke })),
    label ? h('g', { 'data-connection-label': '', fill: colorPaint({ color: props.labelColor }).text, fontFamily: label.font, fontSize: label.size, textAnchor: 'middle' },
      label.lines.map((text, i) => h('text', { key: i, x: label.center.x, y: label.bounds.y + (i + .5) * label.lineHeight, dominantBaseline: 'central', textLength: label.widths[i] || undefined, lengthAdjust: 'spacingAndGlyphs' }, text))) : null)
}
