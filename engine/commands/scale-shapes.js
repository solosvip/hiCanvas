import { createConnectionContext, getShapeBounds, getShapePageBounds, shapeToPagePoint } from '../../renderer/geometry.js'
import { CanvasEditError } from '../errors.js'
import { getShapeScalingRule, resizeShapeProps } from '../shape-scaling.js'
import { pageRotation } from '../layout-resize.js'
import { checkedPoint, normalizeAngle, placeShapeAtPagePoint, putTransformedShapes, transformTargets } from '../shape-transform.js'

const handles = ['left', 'right', 'top', 'bottom', 'top_left', 'top_right', 'bottom_left', 'bottom_right']

// Native nested-group observation (2026-11-25): two group center shifts
// (50,15)+(35,15) add to the fixed-size note's own (12.5,15).
// Keep the established leaf-only command contract: groups are virtual poses.
function groupDisplacement(snapshot, roots, origin, scale) {
  const selected = new Set(roots.filter(r => r.type === 'group').map(r => r.id)), cache = new Map()
  function offset(id) {
    const group = snapshot.store[id]
    if (group?.type !== 'group') return { x: 0, y: 0 }
    if (cache.has(id)) return cache.get(id)
    const parent = selected.has(id) ? { x: 0, y: 0 } : offset(group.parentId)
    // Only descendants of selected group roots inherit a virtual pose.
    if (!selected.has(id) && !cache.has(group.parentId)) return parent
    const b = getShapePageBounds(snapshot, id)
    const value = { x: parent.x + (b.x + b.w / 2 - origin.x) * (scale.x - 1), y: parent.y + (b.y + b.h / 2 - origin.y) * (scale.y - 1) }
    cache.set(id, value)
    return value
  }
  return shape => offset(shape.parentId)
}

// scale is along page axes around origin. Images and text default to uniform
// scaling (largest absolute factor); lockAspectRatio can override that default.
// Text side handles in resize_bounds mode change wrapping width instead.
export function scaleShapes(store, { ids, origin, scale, lockAspectRatio, mode = 'scale_shape', handle = 'bottom_right' }) {
  checkedPoint(origin)
  if (!scale || ![scale.x, scale.y].every(value => Number.isFinite(value) && value !== 0)) throw new CanvasEditError('横纵缩放倍率需要有限非零数值。')
  if (lockAspectRatio !== undefined && typeof lockAspectRatio !== 'boolean') throw new CanvasEditError('锁定比例需要布尔值。')
  if (!['scale_shape', 'resize_bounds'].includes(mode) || !handles.includes(handle)) throw new CanvasEditError('缩放模式或边框手柄无效。')
  const { snapshot, shapes, roots } = transformTargets(store, ids, { expandGroups: true, allowDegenerateConnections: true })
  const groupFactor = Math.max(Math.abs(scale.x), Math.abs(scale.y))
  const groupScale = lockAspectRatio === true ? { x: Math.sign(scale.x) * groupFactor, y: Math.sign(scale.y) * groupFactor } : scale
  const displacement = groupDisplacement(snapshot, roots, origin, groupScale)
  const connections = createConnectionContext(snapshot)
  return putTransformedShapes(store, shapes.map(shape => {
    const rule = getShapeScalingRule(shape)
    const position = typeof rule.position === 'function' ? rule.position(shape) : rule.position
    if (scale.x === 1 && scale.y === 1 && mode === 'scale_shape') return shape
    if (position === 'skip') {
      const point = shapeToPagePoint(snapshot, shape.id, { x: 0, y: 0 }), shift = displacement(shape)
      return placeShapeAtPagePoint(snapshot, shape, { x: point.x + shift.x, y: point.y + shift.y })
    }
    const locked = lockAspectRatio ?? rule.lockAspectRatio({ mode, handle, shape })
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
    const reflected = !orthogonal && Math.sign(factors.x) !== Math.sign(factors.y) ? -angle : angle
    const rotation = reflected === angle ? shape.rotation : normalizeAngle(shape.rotation - 2 * angle)
    // Signed point coordinates carry their own reflection. Repositioning their
    // record as an absolute-width box would reflect the origin a second time.
    if (position === 'origin') {
      const point = shapeToPagePoint(snapshot, shape.id, { x: 0, y: 0 })
      const next = placeShapeAtPagePoint(snapshot, shape, { x: origin.x + (point.x - origin.x) * factors.x, y: origin.y + (point.y - origin.y) * factors.y })
      return { ...next, props: resizeShapeProps(shape, local, { mode, handle, bindings: connections.bindingsFrom(shape.id) }), rotation }
    }
    const bounds = getShapeBounds(shape)
    const center = shapeToPagePoint(snapshot, shape.id, { x: bounds.w / 2, y: bounds.h / 2 })
    const shift = position === 'center' ? displacement(shape) : { x: 0, y: 0 }
    const nextCenter = { x: origin.x + (center.x - origin.x) * factors.x + shift.x, y: origin.y + (center.y - origin.y) * factors.y + shift.y }
    const props = resizeShapeProps(shape, local, { mode, handle, locked })
    // Position follows the requested geometry. Text reflow and minimum-size
    // clamps must not drag the opposite corner away from its requested point.
    const nextBounds = position === 'center' ? bounds : { w: bounds.w * Math.abs(local.x), h: bounds.h * Math.abs(local.y) }
    // For right angles, the exchanged local axes already account for a
    // reflection. Reversing the angle as well would mirror image pixels twice.
    const cos = Math.cos(reflected), sin = Math.sin(reflected)
    const next = placeShapeAtPagePoint(snapshot, shape, { x: nextCenter.x - nextBounds.w / 2 * cos + nextBounds.h / 2 * sin, y: nextCenter.y - nextBounds.w / 2 * sin - nextBounds.h / 2 * cos })
    return { ...next, props, rotation }
  }))
}
