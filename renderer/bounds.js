import { textLayout } from './text.js'

const stored = shape => ({ w: shape.props.w || 0, h: shape.props.h || 0 })
// One registration per supported type. Text height is an estimate until the
// separate typography work; no browser measurement enters this module.
const boundsByType = Object.freeze({
  geo: shape => ['rectangle', 'ellipse'].includes(shape.props.geo) ? stored(shape) : null,
  text: shape => { const { w, h } = textLayout(shape.props); return { w, h } },
  image: stored,
  frame: stored
})

export function getShapeBounds(shape) {
  const size = boundsByType[shape.type]?.(shape)
  return size ? { x: 0, y: 0, ...size } : null
}
