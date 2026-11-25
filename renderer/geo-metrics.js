// 2026-11-25 对照运行中的旧版画面测量，未参照任何源码。
// Document units; 402% screenshot at DPR 2, calibrated by a 100 × 40 rectangle.
export const STROKE_WIDTHS = Object.freeze({ s: 2, m: 3.5, l: 5, xl: 10 })
// 40 / 100 unit edges: 402%; 50 unit caps: 760%; ellipse: 460% (DPR 2).
// 240 unit edges were also cross-checked at 134%.
// Reserve cap space before fitting whole periods; closed curves use even counts.
export const DASH_METRICS = Object.freeze({ dashPeriod: 4, dotPeriod: 2, minimumPeriods: 1, closedMinimumPeriods: 2, singlePeriodDashFraction: 7 / 12 })
// Pattern cell/line widths are local document units, shared by every shape.
export const PATTERN_METRICS = Object.freeze({ cell: 8, lineWidth: 1.25, dashLength: 2, strokesPerCell: 3 })
// Elliptical arc sagitta <= max(0.1 units, longest side / 8192).
// Independently designed cloud and heart use 256 uniformly spaced samples.
export const CURVE_METRICS = Object.freeze({ minimumTolerance: 0.1, relativeTolerance: 1 / 8192, minimumArcSegments: 32, silhouetteSamples: 256 })

export function strokeWidth(props) {
  return (STROKE_WIDTHS[props.size] || STROKE_WIDTHS.m) * (props.scale || 1)
}

export function dashLayout(props, length, closed = false) {
  if (!['dashed', 'dotted'].includes(props.dash)) return null
  const width = strokeWidth(props)
  const dotted = props.dash === 'dotted'
  const desiredPeriod = width * (dotted ? DASH_METRICS.dotPeriod : DASH_METRICS.dashPeriod)
  const periods = closed
    ? Math.max(DASH_METRICS.closedMinimumPeriods, Math.floor((length / desiredPeriod - 1) / 2) * 2)
    : Math.max(DASH_METRICS.minimumPeriods, dotted ? Math.floor(length / desiredPeriod) - 1 : Math.floor((length - width) / desiredPeriod))
  const period = length / periods
  // 40 / 50 unit short edges retain longer end marks when only one period fits.
  const dash = dotted ? 0 : closed ? period / 2 : periods === 1 ? length * DASH_METRICS.singlePeriodDashFraction : length / (periods * 2 + 1)
  return { array: [dash, period - dash], offset: dash / 2 }
}
