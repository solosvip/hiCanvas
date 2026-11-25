// Document units: widths are deliberately independent of the old editor.
export const STROKE_WIDTHS = Object.freeze({ s: 1.5, m: 2.5, l: 4, xl: 6 })
export const DASH_METRICS = Object.freeze({ dashLength: 3, dashGap: 2, dotGap: 2 })
// Pattern cell/line widths are local document units, shared by every shape.
export const PATTERN_METRICS = Object.freeze({ cell: 8, lineWidth: 1, linedCell: 6 })
// Elliptical arc sagitta <= max(0.1 units, longest side / 8192).
// Independently designed cloud and heart use 256 uniformly spaced samples.
export const CURVE_METRICS = Object.freeze({ minimumTolerance: 0.1, relativeTolerance: 1 / 8192, minimumArcSegments: 32, silhouetteSamples: 256 })

export function strokeWidth(props) {
  return (STROKE_WIDTHS[props.size] || STROKE_WIDTHS.m) * (props.scale || 1)
}

export function dashArray(props) {
  const width = strokeWidth(props)
  if (props.dash === 'dashed') return [DASH_METRICS.dashLength * width, DASH_METRICS.dashGap * width]
  if (props.dash === 'dotted') return [0, DASH_METRICS.dotGap * width]
  return undefined // draw intentionally uses the solid path in this ticket.
}
