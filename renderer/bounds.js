import { textLayout } from './text.js'
import { getGeoContour, getGeoSize } from './geo-contours.js'

const stored = shape => ({ w: shape.props.w || 0, h: shape.props.h || 0 })
// One registration per supported type. Text height is an estimate until the
// separate typography work; no browser measurement enters this module.
const box = ({ w, h }) => ({ outline: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], decorations: [], ellipse: null })
const textSize = shape => { const { w, h } = textLayout(shape.props); return { w, h } }
const geometryByType = Object.freeze({
  geo: { bounds: shape => getGeoSize(shape.props), contour: shape => getGeoContour(shape.props) },
  text: { bounds: textSize, contour: shape => box(textSize(shape)) },
  image: { bounds: stored, contour: shape => box(stored(shape)) },
  frame: { bounds: stored, contour: shape => box(stored(shape)) },
  group: { bounds: () => null, contour: () => null }
})

export function getShapeBounds(shape) {
  const size = geometryByType[shape.type]?.bounds(shape)
  return size ? { x: 0, y: 0, ...size } : null
}

export function getShapeContour(shape) {
  return geometryByType[shape.type]?.contour(shape) || null
}
