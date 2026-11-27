import { screenToCanvas } from '../../renderer/geometry.js'
import { CanvasEditError } from '../errors.js'
import { draggedCreationBounds } from './creation-bounds.js'
import { captureCreationParent } from './creation-parent.js'
import { styledCreation } from './style-definitions.js'

// All creation previews use the runtime's local gesture; the host receives a
// single transaction on pointer-up. No tool/session fields enter the document.
export function createCreationTool(context, definition) {
  const { session, read, change, report } = context
  const id = (typeof definition === 'function' ? definition() : definition).id
  let gesture = null, source = context.creation.takeSource(id)
  function assertGesture() {
    if (!session.state.get().isGestureActive || !gesture.parent.matches() || gesture.created && JSON.stringify(session.store.get(gesture.id)) !== gesture.expected) throw new CanvasEditError('创建预览或其父级已被其他编辑改变。', 'conflict')
  }
  function cancel() {
    if (gesture) {
      const previous = gesture.selectedIds; gesture = null
      if (session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
      change({ mode: 'idle', selectedIds: previous })
    }
    source = 'canvas'
    context.creation.endToolbar()
  }
  function start(screenPoint, pointerId, forceSelect = false) {
    const preset = typeof definition === 'function' ? definition() : definition
    const scale = read().creation.dynamicSize ? 1 / read().camera.z : 1
    const sized = { ...preset, w: preset.w * scale, h: preset.h * scale, props: { ...preset.props, ...(preset.shapeType === 'geo' && { scale }) } }
    const point = screenToCanvas(screenPoint, read().camera), parent = captureCreationParent(context, source === 'toolbar' ? null : point)
    session.beginGesture()
    gesture = { pointerId, screenPoint, point, parent, definition: sized, styles: context.creationStyles(preset.shapeType), selectedIds: [...read().selectedIds], id: `shape:${globalThis.crypto.randomUUID()}`, created: false, generation: context.creation.generation(), forceSelect }
    change({ mode: 'pointing', selectedIds: [], lastError: null })
  }
  function down(input) { if (input.button === 0 && !gesture) start(input.point, input.pointerId, source === 'toolbar') }
  function defaultBounds(point) {
    const { w, h } = gesture.definition
    return { x: point.x - w / 2, y: point.y - h / 2, w, h }
  }
  function preview(bounds) {
    assertGesture()
    const { props, shapeType, meta } = gesture.definition
    const { x, y, w, h } = bounds
    if (source === 'toolbar') gesture.parent = captureCreationParent(context, { x: x + w / 2, y: y + h / 2 }, gesture.id)
    const pose = gesture.parent.pose(bounds)
    session.preview(gesture.created
      ? [{ type: 'update', id: gesture.id, changes: { ...pose, props: { w, h } } }]
      : styledCreation({ type: 'create_shape', id: gesture.id, shapeType, ...pose, props: { ...props, w, h }, meta }, gesture.styles))
    gesture.created = true
    gesture.expected = JSON.stringify(session.store.get(gesture.id))
    change({ selectedIds: [gesture.id] })
  }
  function move(input) {
    if (!gesture || input.pointerId !== gesture.pointerId) return
    gesture.lastInput = input
    if (!gesture.created && Math.hypot(input.point.x - gesture.screenPoint.x, input.point.y - gesture.screenPoint.y) <= 4) return
    const point = screenToCanvas(input.point, read().camera)
    preview(source === 'toolbar' ? defaultBounds(point) : draggedCreationBounds(gesture.point, point, input, gesture.definition.shapeType === 'frame'))
    change({ mode: 'dragging' })
  }
  function up(input) {
    if (!gesture || input.pointerId !== gesture.pointerId) return
    if (source === 'toolbar') {
      if (!gesture.created) {
        const immediate = gesture.definition.immediateAtCenter
        cancel(); source = 'canvas'
        return immediate ? activateAtCenter() : undefined
      }
      const { x, y } = input.point, { w, h } = read().viewport
      if (x < 0 || y < 0 || x >= w || y >= h) { cancel(); source = 'canvas'; context.returnToSelect(); return }
    }
    if (gesture.created) move(input)
    else preview(defaultBounds(gesture.point))
    return finish()
  }
  function finish() {
    // ADR 0009 replays disjoint records after a revision conflict. Once the
    // pointer is released, a remotely moved frame carries its new child at
    // the saved local position; moving the parent does not cancel that save.
    const current = gesture
    gesture = null; source = 'canvas'
    context.creation.endToolbar()
    change({ mode: 'idle', selectedIds: [current.id] })
    return session.commitGesture().then(result => {
      if (current.generation === context.creation.generation() && (current.forceSelect || !read().creation.toolLocked)) context.returnToSelect()
      return result
    }).catch(error => {
      if (current.generation === context.creation.generation()) change({ selectedIds: current.selectedIds })
      report(error); throw error
    })
  }
  function activateAtCenter() {
    cancel()
    const { w, h } = read().viewport
    start({ x: w / 2, y: h / 2 }, null, true)
    preview(defaultBounds(gesture.point))
    return finish()
  }
  return {
    cancel,
    activateAtCenter,
    dispatch(input) {
      if (input.type === 'pointer_down') return down(input)
      if (input.type === 'pointer_move') return move(input)
      if (input.type === 'pointer_up') return up(input)
      if (input.type === 'pointer_cancel' && input.pointerId === gesture?.pointerId || input.type === 'key_down' && input.key === 'Escape') {
        const leave = source === 'toolbar' || !gesture
        cancel(); source = 'canvas'
        if (leave) context.returnToSelect()
      }
      else if (input.type.startsWith('key_') && gesture?.created && gesture.lastInput) move({ ...gesture.lastInput, shiftKey: input.shiftKey, altKey: input.altKey })
    },
  }
}
