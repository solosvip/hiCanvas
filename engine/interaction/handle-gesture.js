import { screenToCanvas } from '../../renderer/geometry.js'
import { CanvasEditError } from '../errors.js'
import { resizeTransform, rotationTransform } from './selection-transform.js'
import { captureFrameResize, frameFitCommand } from './frame-interaction.js'

// One runtime transaction for the entire drag. Each frame restores only this
// gesture's captured targets before issuing an absolute transform; unrelated
// records stay live. The runtime coalesces intermediate writes into a net diff.
export function createHandleGesture(context) {
  const { session, index, selection, snapping, read, change, report } = context
  let gesture = null
  function cancel() {
    if (!gesture) return
    const rotation = gesture.beforeRotation
    gesture = null
    snapping.clear()
    if (session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
    change({ mode: 'idle', selectionRotation: rotation })
  }
  function begin(input, handle, frame) {
    if (gesture || session.state.get().isSubmitting) return
    const ids = selection.roots(read().selectedIds)
    session.beginGesture()
    const fit = input.clickCount === 2 && frameFitCommand(index, ids, handle)
    gesture = { beforeRotation: read().selectionRotation, ids, handle, frame, fit, pointerId: input.pointerId, startScreen: input.point, start: screenToCanvas(input.point, read().camera), originals: selection.capture(ids), expected: selection.expected(ids), contents: handle.kind === 'resize' && !fit ? captureFrameResize(context, ids) : null, point: input.point, changed: false }
    // A recognized fit owns the second click through pointer_up, including
    // when a child label overlaps the handle and could otherwise start editing.
    change({ mode: fit ? 'resizing' : 'pointing', lastError: null })
  }
  function preview(input) {
    if (!gesture || input.pointerId !== gesture.pointerId) return
    gesture.point = input.point
    const distance = Math.hypot(input.point.x - gesture.startScreen.x, input.point.y - gesture.startScreen.y)
    if (!gesture.fit && !gesture.changed && distance <= 4) return
    const current = selection.expected(gesture.ids)
    if (!session.state.get().isGestureActive || current.size !== gesture.expected.size || [...gesture.expected].some(([id, value]) => current.get(id) !== value)) throw new CanvasEditError('手柄目标已被其他操作更改，本次拖动已取消。', 'conflict')
    if (gesture.fit) {
      if (distance <= 4) return
      // A second press may become an ordinary handle drag instead of a click.
      gesture.fit = null
      gesture.contents = captureFrameResize(context, gesture.ids)
    }
    const { ids, handle, frame } = gesture
    gesture.lastInput=input
    let point = screenToCanvas(input.point, read().camera)
    let selectionRotation = read().selectionRotation
    const commands = [...gesture.originals.map(record => ({ type: 'put', record })), ...(gesture.contents?.restore(input) || [])]
    if (handle.kind === 'rotate') {
      const transform = rotationTransform(frame, gesture.start, point, input.shiftKey)
      selectionRotation = frame.rotation + transform.angle
      commands.push({ type: 'rotate_shapes', ids, ...transform })
    } else {
      const options = { mode: ids.length === 1 && index.getRecord(ids[0]).type !== 'group' ? 'resize_bounds' : 'scale_shape', handle: handle.id }
      const uniform = input.shiftKey || selection.capability(ids, options).lockAspectRatio
      point=snapping.resize(ids,frame,handle.id,gesture.start,point,{center:input.altKey,uniform},input)
      const transform = resizeTransform(frame, handle.id, gesture.start, point, { center: input.altKey, uniform })
      // Commands operate on page axes. Rotate the selected roots into their
      // selection frame, scale, and rotate them back around the same anchor.
      // This also preserves local coordinates inside a rotated parent frame.
      // Identity must restore the original props too: resize_bounds can
      // otherwise turn geo growY into stored h, or disable text autoSize.
      if (transform.scale.x !== 1 || transform.scale.y !== 1) {
        if (frame.rotation) commands.push({ type: 'rotate_shapes', ids, origin: transform.origin, angle: -frame.rotation })
        commands.push({ type: 'scale_shapes', ids, ...transform, ...options, lockAspectRatio: uniform })
        if (frame.rotation) commands.push({ type: 'rotate_shapes', ids, origin: transform.origin, angle: frame.rotation })
      }
    }
    session.preview(commands)
    const compensation = gesture.contents?.compensate(input) || []
    if (compensation.length) session.preview(compensation)
    gesture.contents?.accept()
    gesture.expected = selection.expected(ids); gesture.changed = true
    change({ mode: handle.kind === 'rotate' ? 'rotating' : 'resizing', selectionRotation })
  }
  function up(input) {
    if (!gesture || input.pointerId !== gesture.pointerId) return
    preview(input)
    if (gesture.fit) { session.preview([gesture.fit]); gesture.changed = true }
    const changed = gesture.changed; gesture = null; snapping.clear()
    change({ mode: 'idle' })
    if (changed && session.state.get().isGestureActive) return session.commitGesture().catch(error => { report(error); throw error })
    if (session.state.get().isGestureActive) session.cancelGesture()
  }
  return {
    begin, cancel, refreshSnapping(){if(gesture?.lastInput)preview(gesture.lastInput)}, get active() { return gesture !== null },
    dispatch(input) {
      if (input.type === 'pointer_move') return preview(input)
      if (input.type === 'pointer_up') return up(input)
      if (input.type === 'pointer_cancel' && input.pointerId === gesture?.pointerId || input.type === 'key_down' && input.key === 'Escape') return cancel()
      if (gesture && ['key_down', 'key_up'].includes(input.type) && ['Shift', 'Alt', 'Meta', 'Control'].includes(input.key)) return preview({ ...input, pointerId: gesture.pointerId, point: gesture.point })
    },
  }
}
