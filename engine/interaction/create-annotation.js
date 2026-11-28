import { screenToCanvas } from '../../renderer/geometry.js'
import { CanvasEditError } from '../errors.js'
import { captureCreationParent } from './creation-parent.js'

// .scratch/annotation-observation/runs/observe-1795815293496 O03/O04:
// minimum 8 CSS px; scale-1 bend clamp(length*.12,16,48), signed by
// the dominant component (vertical always positive). These are document data.
function bendFor({ x, y }) {
  const bend = Math.min(48, Math.max(16, Math.hypot(x, y) * .12))
  return Math.abs(x) >= Math.abs(y) && x >= 0 ? -bend : bend
}

export function createAnnotationTool(context) {
  const { session, index, read, change } = context
  let gesture = null, source = context.creation.takeSource('annotation')
  function cancel() {
    const current = gesture; gesture = null
    if (current) {
      if (session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
      change({ mode: 'idle', selectedIds: current.before })
    }
    source = 'canvas'; context.creation.endToolbar()
  }
  function preview(input, complete = false) {
    const g = gesture
    if (!g || input.pointerId !== g.pointerId) return
    if (!session.state.get().isGestureActive || !g.parent.matches() || g.expected && JSON.stringify(index.getRecord(g.id)) !== g.expected) throw new CanvasEditError('标注草稿或父级已被其他编辑改变。', 'conflict')
    const point = screenToCanvas(input.point, read().camera), end = { x: point.x - g.point.x, y: point.y - g.point.y }
    g.length = Math.hypot(input.point.x - g.screen.x, input.point.y - g.screen.y)
    const props = { end, bend: complete ? bendFor(end) : 0 }
    session.preview(g.expected ? [{ type: 'update', id: g.id, changes: { props } }] : [{ type: 'create_shape', id: g.id, shapeType: 'arrow', ...g.parent.pose(g.point), meta: { cowartAnnotationArrow: true }, props: {
      ...props, start: { x: 0, y: 0 }, kind: 'arc', dash: 'draw', size: 'm', fill: 'none', color: g.color, labelColor: g.color,
      arrowheadStart: 'none', arrowheadEnd: 'arrow', labelPosition: 0, font: 'draw', scale: 1,
    } }])
    g.expected = JSON.stringify(index.getRecord(g.id))
    change({ selectedIds: [g.id], mode: g.length >= 8 ? 'dragging' : 'pointing' })
  }
  return { cancel, dispatch(input) {
    if (input.type === 'pointer_down' && input.button === 0 && !gesture) {
      const point = screenToCanvas(input.point, read().camera), color = context.creationStyles('arrow').props.color
      session.beginGesture()
      gesture = { id: `shape:${globalThis.crypto.randomUUID()}`, pointerId: input.pointerId, screen: input.point, point, before: [...read().selectedIds], parent: captureCreationParent(context, point), color: color === 'black' ? 'red' : color }
      preview(input)
    } else if (input.type === 'pointer_move') preview(input)
    else if (input.type === 'pointer_up' && input.pointerId === gesture?.pointerId) {
      preview(input, true)
      if (gesture.length < 8 || source === 'toolbar' && (input.point.x < 0 || input.point.y < 0 || input.point.x >= read().viewport.w || input.point.y >= read().viewport.h)) return cancel()
      const id = gesture.id; gesture = null; source = 'canvas'; context.creation.endToolbar()
      // O05/O07/O08: adopt the existing gesture, so Esc SAVES the first
      // label together with its arrow; an empty arrow is still retained.
      context.textEditing.adopt(id)
      context.returnToSelect()
    } else if (input.type === 'pointer_cancel' && input.pointerId === gesture?.pointerId || input.type === 'key_down' && input.key === 'Escape') {
      const idle = !gesture; cancel(); if (idle) context.returnToSelect()
    }
  } }
}
