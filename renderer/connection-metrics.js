// Measured from running legacy synthetic SVG/label output, 2026-11-25.
// Four straight-arrow widths: 2/3.5/5/10; cap ray length=3 widths,
// half-angle=30deg; square=.85 rays, dot diameter=.9 rays. No source read.
export { STROKE_WIDTHS as CONNECTION_WIDTHS, strokeWidth as connectionWidth } from './geo-metrics.js'
// Bound top-edge samples measured from the running legacy renderer: distances
// outside the target's page-aligned box, for s/m/l/xl respectively.
export const ELBOW_ESCAPE = Object.freeze({ s: 28, m: 36, l: 44, xl: 66 })
export const CONNECTION_METRICS = Object.freeze({ headFactor: 3, headHalfAngle: Math.PI / 6, squareFactor: .85, dotFactor: .45, diamondFactor: .75 / Math.SQRT2, bindingGap: 10, elbowClearance: 4.5, labelLineHeight: 1.35 })
