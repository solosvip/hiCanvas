import { shapeToPagePoint } from '../../renderer/geometry.js'
import { CanvasEditError } from '../errors.js'
import { pageRotation } from '../layout-resize.js'
import { checkedPoint, fullTurn, normalizeAngle, placeShapeAtPagePoint, putTransformedShapes, transformTargets } from '../shape-transform.js'

// angle is a delta in radians. Alternatively step > 0 (at most one turn),
// direction = ±1 advances to the next tick, even when already on a tick.
// Single selection uses its page angle, multi-selection uses zero; callers
// can supply referenceAngle for a selection box with a different orientation.
export function rotateShapes(store, { ids, origin, angle, step, direction = 1, referenceAngle }) {
  checkedPoint(origin)
  if ((angle === undefined) === (step === undefined)) throw new CanvasEditError('旋转需要角度或刻度，两者只能选一个。')
  if (angle !== undefined && !Number.isFinite(angle)) throw new CanvasEditError('旋转角度需要有限数值。')
  if (step !== undefined && (!Number.isFinite(step) || step <= 0 || step > fullTurn || ![1, -1].includes(direction))) throw new CanvasEditError('旋转刻度需大于零且不超过一圈，方向为 1 或 -1。')
  if (referenceAngle !== undefined && !Number.isFinite(referenceAngle)) throw new CanvasEditError('参考角度需要有限数值。')
  const { snapshot, shapes } = transformTargets(store, ids)
  if (!shapes.length) return { shapeIds: [] }
  if (step !== undefined) {
    const reference = referenceAngle ?? (shapes.length === 1 ? pageRotation(snapshot.store, shapes[0]) : 0)
    const quotient = reference / step
    const tick = Math.abs(quotient - Math.round(quotient)) < 1e-10 ? Math.round(quotient) : direction === 1 ? Math.floor(quotient) : Math.ceil(quotient)
    angle = (tick + direction) * step - reference
    if (!Number.isFinite(angle) || angle === 0) throw new CanvasEditError('旋转刻度超出可计算精度。')
  }
  angle %= fullTurn
  if (angle === 0) return { shapeIds: [] }
  const cos = Math.cos(angle), sin = Math.sin(angle)
  return putTransformedShapes(store, shapes.map(shape => {
    const previous = shapeToPagePoint(snapshot, shape.id, { x: 0, y: 0 })
    const dx = previous.x - origin.x, dy = previous.y - origin.y
    const next = placeShapeAtPagePoint(snapshot, shape, { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos })
    return { ...next, rotation: normalizeAngle(shape.rotation + angle) }
  }))
}
