import { screenToCanvas } from '../../renderer/geometry.js'
import { CanvasEditError } from '../errors.js'
import { captureCreationParent } from './creation-parent.js'
import { styledCreation } from './style-definitions.js'

// Text reuses the existing canvas pointer slop, not a guessed legacy text
// threshold. The confirmed legacy long drag (200,300)->(900,300) yields w700.
// Unlike the six shape tools, pointer-up hands its transaction to editing.
export function createTextTool(context) {
  const { session, index, read, change } = context
  let gesture = null, source = context.creation.takeSource('text')
  function cancel() {
    if (gesture) {
      const previous = gesture.before; gesture = null
      if (session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
      change({ mode: 'idle', selectedIds: previous })
    }
    source = 'canvas'; context.creation.endToolbar()
  }
  function preview(input) {
    if (!gesture || input.pointerId !== gesture.pointerId) return
    if (!gesture.parent.matches() || !session.state.get().isGestureActive || gesture.expected && JSON.stringify(index.getRecord(gesture.id)) !== gesture.expected) throw new CanvasEditError('文字创建目标或父级已改变。', 'conflict')
    const moved = Math.hypot(input.point.x - gesture.screen.x, input.point.y - gesture.screen.y) > 4
    gesture.moved ||= moved
    const point = screenToCanvas(input.point, read().camera), fixed = source !== 'toolbar' && gesture.moved
    const bounds = { x: source === 'toolbar' ? point.x : Math.min(gesture.point.x, fixed ? point.x : gesture.point.x), y: source === 'toolbar' ? point.y : gesture.point.y, w: fixed ? Math.max(1, Math.abs(point.x - gesture.point.x)) : 1 }
    if (source === 'toolbar') gesture.parent = captureCreationParent(context, point, gesture.id)
    const pose = gesture.parent.pose(bounds), props = { w: bounds.w, autoSize: !fixed }
    session.preview(gesture.expected ? [{ type: 'update', id: gesture.id, changes: { ...pose, props } }] : styledCreation({ type: 'create_shape', id: gesture.id, shapeType: 'text', ...pose, props }, gesture.styles))
    gesture.expected = JSON.stringify(index.getRecord(gesture.id))
    change({ mode: gesture.moved ? 'dragging' : 'pointing', selectedIds: [gesture.id] })
  }
  return { cancel, dispatch(input) {
    if (input.type === 'pointer_down' && input.button === 0 && !gesture) {
      const point = screenToCanvas(input.point, read().camera)
      session.beginGesture()
      gesture = { pointerId: input.pointerId, point, screen: input.point, styles: context.creationStyles('text'), before: [...read().selectedIds], id: `shape:${globalThis.crypto.randomUUID()}`, parent: captureCreationParent(context, source === 'toolbar' ? null : point) }
      preview(input)
    } else if (input.type === 'pointer_move') preview(input)
    else if (input.type === 'pointer_up' && gesture?.pointerId === input.pointerId) {
      preview(input)
      if (source === 'toolbar' && (!gesture.moved || input.point.x < 0 || input.point.y < 0 || input.point.x >= read().viewport.w || input.point.y >= read().viewport.h)) return cancel()
      const id = gesture.id; gesture = null; source = 'canvas'; context.creation.endToolbar()
      context.textEditing.adopt(id)
      context.returnToSelect()
    } else if (input.type === 'pointer_cancel' && input.pointerId === gesture?.pointerId || input.type === 'key_down' && input.key === 'Escape') {
      const idle = !gesture; cancel(); if (idle) context.returnToSelect()
    }
  } }
}
