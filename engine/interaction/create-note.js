import { screenToCanvas } from '../../renderer/geometry.js'
import { captureCreationParent } from './creation-parent.js'
import { CanvasEditError } from '../errors.js'
import { styledCreation } from './style-definitions.js'

// Native N click(400,350) -> paper(300,250). Drag to(600,450) ->(500,350),
// unchanged 200-square paper, then shared text editing. Pointerup adopts the
// creation transaction, so first text and creation have one undo entry.
export function createNoteTool(context) {
  const { session, index, read, change } = context
  let gesture = null, source = context.creation.takeSource('note')
  function cancel() {
    if (gesture) {
      const before = gesture.before; gesture = null
      if (session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
      change({ mode: 'idle', selectedIds: before })
    }
    source = 'canvas'; context.creation.endToolbar()
  }
  function preview(input) {
    if (!gesture || gesture.pointerId !== input.pointerId) return
    if (!gesture.parent.matches() || !session.state.get().isGestureActive || gesture.expected && JSON.stringify(index.getRecord(gesture.id)) !== gesture.expected) throw new CanvasEditError('便签或父级已改变。', 'conflict')
    gesture.moved ||= Math.hypot(input.point.x - gesture.screen.x, input.point.y - gesture.screen.y) > 4
    const point = screenToCanvas(input.point, read().camera)
    gesture.parent = captureCreationParent(context, point, gesture.id)
    session.preview(gesture.expected ? [{ type: 'update', id: gesture.id, changes: gesture.parent.pose({ x: point.x - 100, y: point.y - 100 }) }] : styledCreation({ type: 'create_shape', id: gesture.id, shapeType: 'note', ...gesture.parent.pose({ x: point.x - 100, y: point.y - 100 }) }, gesture.styles))
    gesture.expected = JSON.stringify(index.getRecord(gesture.id))
    change({ mode: gesture.moved ? 'dragging' : 'pointing', selectedIds: [gesture.id] })
  }
  return { cancel, dispatch(input) {
    if (input.type === 'pointer_down' && input.button === 0 && !gesture) {
      const point = screenToCanvas(input.point, read().camera)
      session.beginGesture()
      gesture = { id: `shape:${globalThis.crypto.randomUUID()}`, pointerId: input.pointerId, screen: input.point, styles: context.creationStyles('note'), before: [...read().selectedIds], parent: captureCreationParent(context, point) }
      preview(input)
    } else if (input.type === 'pointer_move') preview(input)
    else if (input.type === 'pointer_up' && gesture?.pointerId === input.pointerId) {
      preview(input)
      if (source === 'toolbar' && (!gesture.moved || input.point.x < 0 || input.point.y < 0 || input.point.x >= read().viewport.w || input.point.y >= read().viewport.h)) return cancel()
      const id = gesture.id; gesture = null; source = 'canvas'; context.creation.endToolbar()
      context.textEditing.adopt(id); context.returnToSelect()
    } else if (input.type === 'pointer_cancel' && input.pointerId === gesture?.pointerId || input.type === 'key_down' && input.key === 'Escape') {
      const idle = !gesture; cancel(); if (idle) context.returnToSelect()
    }
  } }
}
