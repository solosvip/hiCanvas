import { getShapeBounds, shapeToPagePoint } from '../../renderer/geometry.js'
import { CanvasEditError } from '../errors.js'
import { getShapeScalingRule, resizeShapeProps } from '../shape-scaling.js'
import { pageRotation } from '../layout-resize.js'
import { checkedPoint, normalizeAngle, placeShapeAtPagePoint, putTransformedShapes, transformTargets } from '../shape-transform.js'

const handles = ['left', 'right', 'top', 'bottom', 'top_left', 'top_right', 'bottom_left', 'bottom_right']

// scale is along page axes around origin. Images and text default to uniform
// scaling (largest absolute factor); lockAspectRatio can override that default.
// Text side handles in resize_bounds mode change wrapping width instead.
export function scaleShapes(store, { ids, origin, scale, lockAspectRatio, mode = 'scale_shape', handle = 'bottom_right' }) {
  checkedPoint(origin)
  if (!scale || ![scale.x, scale.y].every(value => Number.isFinite(value) && value !== 0)) throw new CanvasEditError('横纵缩放倍率需要有限非零数值。')
  if (lockAspectRatio !== undefined && typeof lockAspectRatio !== 'boolean') throw new CanvasEditError('锁定比例需要布尔值。')
  if (!['scale_shape', 'resize_bounds'].includes(mode) || !handles.includes(handle)) throw new CanvasEditError('缩放模式或边框手柄无效。')
  const { snapshot, shapes } = transformTargets(store, ids, { expandGroups: true })
  return putTransformedShapes(store, shapes.map(shape => {
    const rule = getShapeScalingRule(shape)
    if (scale.x === 1 && scale.y === 1 && mode === 'scale_shape') return shape
    const locked = lockAspectRatio ?? rule.lockAspectRatio({ mode, handle })
    const factor = Math.max(Math.abs(scale.x), Math.abs(scale.y))
    const factors = locked ? { x: Math.sign(scale.x) * factor, y: Math.sign(scale.y) * factor } : scale
    const angle = pageRotation(snapshot.store, shape)
    const quarter = Math.round(angle / (Math.PI / 2))
    const orthogonal = Math.abs(angle - quarter * Math.PI / 2) < 1e-10
    // A rotated box cannot encode shear. Match the old editor: scale its
    // dimensions uniformly by the smaller factor, but transform its center
    // by the requested page factors. Right angles swap the local axes.
    const uniform = Math.min(Math.abs(factors.x), Math.abs(factors.y))
    const local = orthogonal && Math.abs(quarter % 2) === 1
      ? { x: factors.y, y: factors.x }
      : { x: Math.sign(factors.x) * (orthogonal ? Math.abs(factors.x) : uniform), y: Math.sign(factors.y) * (orthogonal ? Math.abs(factors.y) : uniform) }
    const bounds = getShapeBounds(shape)
    const center = shapeToPagePoint(snapshot, shape.id, { x: bounds.w / 2, y: bounds.h / 2 })
    const nextCenter = { x: origin.x + (center.x - origin.x) * factors.x, y: origin.y + (center.y - origin.y) * factors.y }
    const props = resizeShapeProps(shape, local, { mode, handle })
    // Position follows the requested geometry. Text reflow and minimum-size
    // clamps must not drag the opposite corner away from its requested point.
    const nextBounds = { w: bounds.w * Math.abs(local.x), h: bounds.h * Math.abs(local.y) }
    // For right angles, the exchanged local axes already account for a
    // reflection. Reversing the angle as well would mirror image pixels twice.
    const reflected = !orthogonal && Math.sign(factors.x) !== Math.sign(factors.y) ? -angle : angle
    const cos = Math.cos(reflected), sin = Math.sin(reflected)
    const next = placeShapeAtPagePoint(snapshot, shape, { x: nextCenter.x - nextBounds.w / 2 * cos + nextBounds.h / 2 * sin, y: nextCenter.y - nextBounds.w / 2 * sin - nextBounds.h / 2 * cos })
    return { ...next, props, rotation: reflected === angle ? shape.rotation : normalizeAngle(shape.rotation - 2 * angle) }
  }))
}
