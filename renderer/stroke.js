import { createElement as h, useId } from 'react'
import { getStrokeGeometry } from './stroke-geometry.js'
import { colorPaint } from './palette.js'
import { PATTERN_METRICS } from './geo-metrics.js'
import { strokePath } from './stroke-path.js'
export { strokePath } from './stroke-path.js'

// 2026-11-25 对照运行中的旧版画面测量：13 色合成荧光笔；黑色回退黄色。
// Background alpha .82 and foreground alpha .35 form two ordered page layers.
const highlights = Object.freeze({ black: '#fddd00', grey: '#cbe7f1', 'light-violet': '#ff88ff', violet: '#c77cff', blue: '#10acff', 'light-blue': '#00f4ff', yellow: '#fddd00', orange: '#ffa500', green: '#00ffc8', 'light-green': '#65f641', 'light-red': '#ff7fa3', red: '#ff636e', white: '#ffffff' })

function Pattern({ id, scale, paint }) {
  // Same observed document-unit tile as geometry fills. Kept local to the new
  // stroke renderer so this task does not change existing shape drawing.
  const cell = PATTERN_METRICS.cell * scale, half = PATTERN_METRICS.dashLength * scale / (2 * Math.SQRT2)
  const d = Array.from({ length: PATTERN_METRICS.strokesPerCell }, (_, i) => {
    const center = cell * (i + 0.5) / PATTERN_METRICS.strokesPerCell
    return `M${center - half},${center + half} L${center + half},${center - half}`
  }).join(' ')
  return h('defs', null, h('pattern', { id, patternUnits: 'userSpaceOnUse', width: cell, height: cell },
    h('rect', { width: cell, height: cell, fill: paint.semi }),
    h('path', { d, stroke: paint.pattern, strokeWidth: PATTERN_METRICS.lineWidth * scale, strokeLinecap: 'round', fill: 'none' })))
}

export function Stroke({ shape, background = false }) {
  const id = useId(), geometry = getStrokeGeometry(shape)
  if (!geometry) return null
  const props = shape.props, highlight = shape.type === 'highlight', paint = colorPaint(props)
  const color = highlight ? highlights[props.color] || highlights.yellow : paint.stroke
  const patterned = geometry.fill.length > 0 && props.fill === 'pattern'
  const fill = patterned ? `url(#${id})` : props.fill === 'lined-fill' ? paint.lined : paint[props.fill] || paint.solid
  return h('svg', { 'data-stroke-layer': highlight ? background ? 'background' : 'foreground' : 'ink', width: geometry.bounds.w, height: geometry.bounds.h, overflow: 'visible', style: { display: 'block' } },
    patterned ? h(Pattern, { id, scale: Math.abs(props.scale || 1), paint }) : null,
    geometry.fill.length ? h('path', { 'data-stroke-fill': '', d: strokePath(geometry.fill), fill }) : null,
    h('g', { fill: color, opacity: highlight ? background ? 0.82 : 0.35 : 1 },
      geometry.outlines.map((points, i) => h('path', { key: i, 'data-stroke-outline': '', d: strokePath(points), fillRule: 'nonzero' }))))
}
