import { getShapeBounds } from '../renderer/geometry.js'
import { CanvasEditError } from './errors.js'
import { getEmbedService } from '../model/index.js'

const dimension = value => Math.max(1, value)
const box = (shape, scale, bounds) => ({ ...shape.props, w: dimension(bounds.w * Math.abs(scale.x)), h: dimension(bounds.h * Math.abs(scale.y)) })
// Layout stretching retains its established stored-size semantics, including
// growY and image orientation; it does not use scale_shapes defaults or clamps.
const stretchBox = (shape, scale) => ({ ...shape.props, w: shape.props.w * scale.x, h: shape.props.h * scale.y })
// Legacy resizeShape and native groups, 2026-11-25: (2,1.5) updates only the
// signed axis multipliers; encoded pressures and draw/highlight widths
// (4.5/26.88 for m) stay fixed. Geometry outlines the transformed centerline.
const stroke = { lockAspectRatio: () => false, position: 'origin', resize: (shape, scale) => ({ ...shape.props, scaleX: shape.props.scaleX * scale.x, scaleY: shape.props.scaleY * scale.y }) }
function embedBox(shape, scale, bounds, { locked }) {
  const service = getEmbedService(shape.props.url)
  const minimum = { w: service?.minWidth || 200, h: service?.minHeight || 200 }
  // Legacy explicit-unlock probe, 2026-11-25: a 320x240 YouTube/Vimeo
  // still clamps to 266.667x200. Unlock affects requested dimensions, while
  // the provider's minimum box retains the original aspect ratio.
  const minimumFactor = service?.lockAspectRatio ? Math.max(minimum.w / bounds.w, minimum.h / bounds.h) : null
  const minWidth = minimumFactor === null ? minimum.w : bounds.w * minimumFactor
  const minHeight = minimumFactor === null ? minimum.h : bounds.h * minimumFactor
  const w = bounds.w * Math.abs(scale.x), h = bounds.h * Math.abs(scale.y)
  const factor = locked ? Math.max(1, minWidth / w, minHeight / h) : 1
  return { ...shape.props, w: Math.max(minWidth, w * factor), h: Math.max(minHeight, h * factor) }
}

// Editing semantics live here, independently of how a shape is drawn.
// Box dimensions have a 1-unit minimum; text scale has a 0.01 minimum.
// Frames resize their boundary only: descendants keep their local records.
// New types register their defaults and resize behavior in this single table.
const rules = Object.freeze({
  draw: stroke,
  highlight: stroke,
  // Native mixed selection 560x200, BR +100,+30 (2026-11-25): a 200x200
  // note moves (300,250)->(317.857,265), retaining scale and growY.
  note: { lockAspectRatio: () => false, position: 'center', hideResizeHandles: true, resize: shape => shape.props },
  // Same probe: a 300x155 bookmark is unchanged; in a group it inherits
  // only that group's center displacement, landing at (350,265).
  bookmark: { lockAspectRatio: () => false, position: 'skip', hideResizeHandles: true, resize: shape => shape.props },
  embed: {
    lockAspectRatio: ({ shape }) => getEmbedService(shape.props.url)?.lockAspectRatio || false,
    position: shape => getEmbedService(shape.props.url)?.canResize === false ? 'skip' : 'box',
    resize: embedBox,
  },
  // Legacy resizeShape, 2026-11-25: 320x180 at (2,1.5) -> 640x360;
  // explicit unlock -> 640x270; tiny factors clamp each dimension to 1.
  video: { lockAspectRatio: () => true, resize: box },
  arrow: {
    lockAspectRatio: () => false,
    hideResizeHandles: true,
    position: 'origin',
    // Native groups and public resizeShape (2026-11-25): bend 50 -> 100
    // for (2,1.5), -> -100 for (-2,1.5); two reflected axes keep its sign.
    resize: (shape, scale, _bounds, { bindings = [] }) => ({ ...shape.props,
      ...Object.fromEntries(['start', 'end'].map(terminal => [terminal, bindings.some(b => b.props.terminal === terminal) ? shape.props[terminal]
        : { ...shape.props[terminal], x: shape.props[terminal].x * scale.x, y: shape.props[terminal].y * scale.y }])),
      bend: shape.props.bend * Math.max(Math.abs(scale.x), Math.abs(scale.y)) * Math.sign(scale.x * scale.y)
    })
  },
  line: {
    lockAspectRatio: () => false,
    hideResizeHandles: true,
    position: 'origin',
    // 2026-11-25 isolated legacy public resizeShape, both modes: factors
    // (2,1.5) map control (90,100) to (180,150); scale and point IDs stay put.
    resize: (shape, scale) => ({ ...shape.props, points: Object.fromEntries(Object.entries(shape.props.points).map(([id, point]) => [id, { ...point, x: point.x * scale.x, y: point.y * scale.y }])) })
  },
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
  // Native custom image/draft/slides frame placeholders, 2026-11-25:
  // top-right (+100,-30) maps 320x240 -> 420x270, minimum 1x1.
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
  const skip = canScale && (typeof rule.position === 'function' ? rule.position(shape) : rule.position) === 'skip'
  return Object.freeze({ canScale, lockAspectRatio: canScale && rule.lockAspectRatio({ ...options, shape }), hideResizeHandles: Boolean(rule?.hideResizeHandles || skip) })
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
