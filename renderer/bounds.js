import { strokeWidth } from './geo-metrics.js'
import { textLayout } from './text.js'
import { getGeoContour, getGeoSize } from './geo-contours.js'
import { getConnectionGeometry } from './connection-geometry.js'

const stored = shape => ({ w: shape.props.w || 0, h: shape.props.h || 0 })
// One registration per supported type. Text height is an estimate until the
// separate typography work; no browser measurement enters this module.
const box = ({ w, h }) => ({ outline: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], decorations: [], ellipse: null })
const textSize = shape => { const { w, h } = textLayout(shape.props); return { w, h } }
const connection = {
  bounds: (shape, context) => getConnectionGeometry(shape, context).bounds,
  contour: (shape, context) => getConnectionGeometry(shape, context).contour,
  hit: (shape, point, tolerance, context) => getConnectionGeometry(shape, context).hit(point, tolerance),
}
const geometryByType = Object.freeze({
  geo: { hit: legacyHit, bounds: shape => getGeoSize(shape.props), contour: shape => getGeoContour(shape.props) },
  text: { hit: legacyHit, bounds: textSize, contour: shape => box(textSize(shape)) },
  image: { hit: legacyHit, bounds: stored, contour: shape => box(stored(shape)) },
  frame: { hit: legacyHit, bounds: stored, contour: shape => box(stored(shape)) },
  group: { hit: legacyHit, bounds: () => null, contour: () => null },
  line: connection,
  arrow: connection,
  embed: { hit: legacyHit, bounds: stored, contour: shape => box(stored(shape)) },
  bookmark: { hit: legacyHit, bounds: stored, contour: shape => box(stored(shape)) },
})

export function getShapeBounds(shape, context) {
  const size = geometryByType[shape.type]?.bounds(shape, context)
  return size ? { x: 0, y: 0, ...size } : null
}

export function getShapeContour(shape, context) {
  return geometryByType[shape.type]?.contour(shape, context) || null
}

export function hitTestShape(shape, point, tolerance = 0, context) {
  return geometryByType[shape.type]?.hit(shape, point, tolerance, context) || false
}

function legacyHit(shape, point, tolerance = 0) {
  const bounds = getShapeBounds(shape)
  if (!bounds) return false
  const { w, h } = bounds
  if (w <= 0 || h <= 0) return false
  const contour = getShapeContour(shape)
  if (!contour) return false
  const margin = shape.type === 'geo' ? Math.max(strokeWidth(shape.props) / 2, tolerance) : 0
  const edgeHit = (points, closed) => points.some((end, i) => (i || closed) && segmentDistance(point, points[(i + points.length - 1) % points.length], end) <= margin)
  return ((shape.type !== 'geo' || shape.props.fill !== 'none') && pointInPolygon(point, contour.outline))
    || edgeHit(contour.outline, true) || contour.decorations.some(line => edgeHit(line, false))
}

function segmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}

function pointInPolygon(point, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
