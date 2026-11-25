import { createElement as h, useId } from 'react'
import { getShapeBounds, getShapeContour } from './bounds.js'
import { dashArray, strokeWidth, PATTERN_METRICS } from './geo-metrics.js'
import { colorPaint } from './palette.js'

const pathOf = (points, close = false) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + (close ? ' Z' : '')

function Pattern({ id, props, paint }) {
  const lined = props.fill === 'lined-fill', scale = props.scale || 1
  const cell = (lined ? PATTERN_METRICS.linedCell : PATTERN_METRICS.cell) * scale
  const d = lined ? `M0,${cell / 2} H${cell}` : `M${-cell / 2},${cell / 2} L${cell / 2},${-cell / 2} M0,${cell} L${cell},0 M${cell / 2},${cell * 1.5} L${cell * 1.5},${cell / 2}`
  return h('defs', null, h('pattern', { id, patternUnits: 'userSpaceOnUse', width: cell, height: cell },
    h('rect', { width: cell, height: cell, fill: lined ? paint.lined : paint.semi }),
    h('path', { d, stroke: paint.pattern, strokeWidth: PATTERN_METRICS.lineWidth * scale, fill: 'none' })))
}

export function Geometry({ shape }) {
  const id = useId(), contour = getShapeContour(shape), bounds = getShapeBounds(shape)
  if (!contour || !bounds) return null
  const props = shape.props, paint = colorPaint(props), patterned = ['pattern', 'lined-fill'].includes(props.fill)
  const fill = props.fill === 'none' ? 'none' : patterned ? `url(#${id})` : paint[props.fill] || paint.solid
  const stroke = { stroke: paint.stroke, strokeWidth: strokeWidth(props), strokeDasharray: dashArray(props)?.join(' '), strokeLinecap: 'round', strokeLinejoin: 'round' }
  return h('svg', { width: bounds.w, height: bounds.h, overflow: 'visible' },
    patterned ? h(Pattern, { id, props, paint }) : null,
    h('path', { 'data-geo-outline': '', d: pathOf(contour.outline, true), fill, ...stroke }),
    contour.decorations.map((line, i) => h('path', { key: i, 'data-geo-decoration': '', d: pathOf(line), fill: 'none', ...stroke })))
}
