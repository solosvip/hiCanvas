import { getShapeBounds } from '../renderer/geometry.js'
import { CanvasEditError } from './errors.js'

const dimension = value => Math.max(1, value)
const box = (shape, scale, bounds) => ({ ...shape.props, w: dimension(bounds.w * Math.abs(scale.x)), h: dimension(bounds.h * Math.abs(scale.y)) })
// Layout stretching retains its established stored-size semantics, including
// growY and image orientation; it does not use scale_shapes defaults or clamps.
const stretchBox = (shape, scale) => ({ ...shape.props, w: shape.props.w * scale.x, h: shape.props.h * scale.y })

// Editing semantics live here, independently of how a shape is drawn.
// Box dimensions have a 1-unit minimum; text scale has a 0.01 minimum.
// Frames resize their boundary only: descendants keep their local records.
// New types register their defaults and resize behavior in this single table.
const rules = Object.freeze({
  geo: {
    lockAspectRatio: () => false,
    stretch: stretchBox,
    resize: (shape, scale, bounds) => ({ ...box(shape, scale, bounds), growY: 0 })
  },
  image: {
    lockAspectRatio: () => true,
    stretch: stretchBox,
    resize: (shape, scale, bounds) => ({ ...box(shape, scale, bounds), flipX: shape.props.flipX !== (scale.x < 0), flipY: shape.props.flipY !== (scale.y < 0) })
  },
  frame: { lockAspectRatio: () => false, stretch: stretchBox, resize: box },
  text: {
    lockAspectRatio: ({ mode, handle }) => !(mode === 'resize_bounds' && ['left', 'right'].includes(handle)),
    resize: (shape, scale, _bounds, { mode, handle }) => mode === 'resize_bounds' && ['left', 'right'].includes(handle)
      ? { ...shape.props, w: dimension(shape.props.w * Math.abs(scale.x)), autoSize: false }
      : { ...shape.props, scale: Math.max(0.01, shape.props.scale * Math.max(Math.abs(scale.x), Math.abs(scale.y))) }
  }
})

export const canStretchShape = shape => Object.hasOwn(rules, shape.type) && typeof rules[shape.type].stretch === 'function'

export function stretchShapeProps(shape, scale) {
  if (!canStretchShape(shape)) throw new CanvasEditError(`这种形状尚未登记拉伸规则：${shape.type}`)
  return rules[shape.type].stretch(shape, scale)
}

// Read-only editing capability: consumers do not receive the mutable rule table.
export function getShapeScalingCapabilities(shape, options = {}) {
  const rule = shape && Object.hasOwn(rules, shape.type) && rules[shape.type]
  const canScale = Boolean(rule && getShapeBounds(shape))
  return Object.freeze({ canScale, lockAspectRatio: canScale && rule.lockAspectRatio(options) })
}

export function getShapeScalingRule(shape) {
  const rule = Object.hasOwn(rules, shape.type) && rules[shape.type]
  if (!rule || !getShapeBounds(shape)) throw new CanvasEditError(`这种形状尚未登记缩放规则：${shape.type}`)
  return rule
}

export function resizeShapeProps(shape, scale, options = {}) {
  const rule = getShapeScalingRule(shape)
  return rule.resize(shape, scale, getShapeBounds(shape), options)
}
