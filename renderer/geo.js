import { createElement as h, useId } from 'react'
import { getShapeBounds, getShapeContour } from './bounds.js'
import { dashLayout, strokeWidth, PATTERN_METRICS } from './geo-metrics.js'
import { getHandDrawnContour } from './hand-drawn.js'
import { colorPaint } from './palette.js'

const pathOf = (points, close = false) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + (close ? ' Z' : '')

function Pattern({ id, props, paint }) {
  const scale = props.scale || 1, cell = PATTERN_METRICS.cell * scale
  const half = PATTERN_METRICS.dashLength * scale / (2 * Math.SQRT2)
  // 2026-11-25 对照运行中的旧版画面测量，未参照任何源码。
  // Three isolated diagonal marks per tile; their round caps stay inside it.
  const d = Array.from({ length: PATTERN_METRICS.strokesPerCell }, (_, i) => {
    const center = cell * (i + 0.5) / PATTERN_METRICS.strokesPerCell
    return `M${center - half},${center + half} L${center + half},${center - half}`
  }).join(' ')
  return h('defs', null, h('pattern', { id, patternUnits: 'userSpaceOnUse', width: cell, height: cell },
    h('rect', { width: cell, height: cell, fill: paint.semi }),
    h('path', { d, stroke: paint.pattern, strokeWidth: PATTERN_METRICS.lineWidth * scale, strokeLinecap: 'round', fill: 'none' })))
}

const pathLength = (points, closed) => points.reduce((sum, point, i) => {
  const next = points[(i + 1) % points.length]
  return !closed && i === points.length - 1 ? sum : sum + Math.hypot(next.x - point.x, next.y - point.y)
}, 0)

function DashedStroke({ points, closed, props, stroke }) {
  const layout = dashLayout(props, pathLength(points, closed), closed)
  return h('path', { 'data-geo-stroke': '', d: pathOf(points, closed), fill: 'none', ...stroke,
    strokeDasharray: layout.array.join(' '), strokeDashoffset: layout.offset })
}

export function Geometry({ shape }) {
  const id = useId(), contour = getShapeContour(shape), bounds = getShapeBounds(shape)
  if (!contour || !bounds) return null
  const props = shape.props, paint = colorPaint(props), patterned = props.fill === 'pattern'
  const fill = props.fill === 'none' ? 'none' : patterned ? `url(#${id})` : props.fill === 'lined-fill' ? paint.lined : paint[props.fill] || paint.solid
  const stroke = { stroke: paint.stroke, strokeWidth: strokeWidth(props), strokeLinecap: 'round', strokeLinejoin: 'round' }
  const hand = getHandDrawnContour(shape)
  const dashed = ['dashed', 'dotted'].includes(props.dash)
  const edges = !dashed ? [] : contour.continuous ? [contour.outline] : contour.outline.map((point, i) => [point, contour.outline[(i + 1) % contour.outline.length]])
  return h('svg', { width: bounds.w, height: bounds.h, overflow: 'visible' },
    patterned ? h(Pattern, { id, props, paint }) : null,
    h('path', { 'data-geo-outline': '', d: hand?.fillPath || pathOf(contour.outline, true), fill, ...stroke, stroke: hand || dashed ? 'none' : stroke.stroke }),
    hand ? h('path', { 'data-geo-hand-ink': '', d: hand.strokePath, fill: paint.stroke, fillRule: 'nonzero' }) : null,
    dashed ? edges.map((points, i) => h(DashedStroke, { key: `edge-${i}`, points, closed: !!contour.continuous, props, stroke })) : null,
    hand ? hand.decorationPaths.map((d, i) => h('path', { key: i, 'data-geo-decoration': '', d, fill: paint.stroke, fillRule: 'nonzero' })) : contour.decorations.map((line, i) => dashed
      ? h(DashedStroke, { key: i, points: line, closed: false, props, stroke })
      : h('path', { key: i, 'data-geo-decoration': '', d: pathOf(line), fill: 'none', ...stroke })))
}
