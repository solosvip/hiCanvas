import { screenToCanvas } from '../../renderer/geometry.js'
import { CanvasEditError } from '../errors.js'
import { editableImage, imageCrop, imageSourceSize, imageCropZoom } from '../commands/crop-image.js'
import { describeSelection, hitSelectionHandle, selectionHandleCursor } from './selection-handles.js'
import { pointInFrame } from './selection-frame.js'
import { resizedImageCrop } from './crop-resize.js'

export function createImageCrop(context) {
  const { session, selection, targets, read, change, report, handleMetrics } = context
  let gesture = null
  const current = () => session.store.get(read().croppingId)
  function describe(state) {
    const shape = session.store.get(state.croppingId)
    if (shape?.type !== 'image' || !targets.isSelectable(shape.id)) return null
    const overlay = describeSelection(selection, [shape.id]), size = imageSourceSize(shape), crop = imageCrop(shape)
    const asset = session.store.get(shape.props.assetId)
    return { ...overlay, kind: 'crop', handles: overlay.handles.filter(h => h.kind === 'resize'), image: Object.freeze({ src: asset?.props.src || '', w: size.w, h: size.h, x: -crop.topLeft.x * size.w, y: -crop.topLeft.y * size.h, flipX: shape.props.flipX, flipY: shape.props.flipY, isAnimated: Boolean(asset?.props.isAnimated), playing: shape.props.playing }) }
  }
  function cancel() {
    if (!gesture) return
    const temporary = gesture.temporary
    gesture = null
    if (session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
    change({ ...(temporary && { croppingId: null }), mode: !temporary && read().croppingId ? 'cropping' : 'idle' })
  }
  function finish() { cancel(); change({ croppingId: null, mode: 'idle', handleCursor: null }) }
  function begin(id = read().selectedIds.length === 1 ? read().selectedIds[0] : null) {
    if (gesture && !read().croppingId) cancel()
    const shape = editableImage(session.store, id)
    if (session.state.get().isSubmitting || session.state.get().isGestureActive) throw new CanvasEditError('请先结束当前手势。', 'busy')
    change({ croppingId: shape.id, selectedIds: [shape.id], cropAspectRatio: shape.props.crop?.isCircle ? 1 : null, mode: 'cropping', lastError: null })
  }
  function verify() {
    const now = selection.expected([gesture.shape.id])
    if (!session.state.get().isGestureActive || now.size !== gesture.expected.size || [...gesture.expected].some(([id, value]) => now.get(id) !== value)) throw new CanvasEditError('裁剪目标已被其他操作更改。', 'conflict')
  }
  function preview(command) {
    verify()
    session.preview([{ type: 'put', record: gesture.shape }, { type: 'crop_image', id: gesture.shape.id, ...command }])
    gesture.expected = selection.expected([gesture.shape.id])
    change({ mode: gesture.kind === 'zoom' ? 'crop-zooming' : gesture.handle ? 'crop-resizing' : 'crop-moving' })
  }
  function down(input, temporary = false) {
    if (gesture || input.button !== 0) return
    const shape = current(), overlay = describe(read()), point = screenToCanvas(input.point, read().camera)
    const handle = hitSelectionHandle(overlay, point, read().camera.z, handleMetrics)
    const frame = { ...overlay.bounds, rotation: overlay.rotation }, local = pointInFrame(frame, point)
    if (!handle && (local.x < 0 || local.y < 0 || local.x > frame.w || local.y > frame.h)) { finish(); return }
    session.beginGesture()
    gesture = { shape, frame, handle, temporary, pointerId: input.pointerId, start: local, startScreen: input.point, expected: selection.expected([shape.id]) }
  }
  function move(input) {
    const overlay = describe(read()), point = screenToCanvas(input.point, read().camera)
    if (!gesture) {
      const handle = hitSelectionHandle(overlay, point, read().camera.z, handleMetrics)
      change({ handleCursor: selectionHandleCursor(handle, overlay?.rotation || 0) || 'move' }); return
    }
    if (input.pointerId !== gesture.pointerId) return
    if (Math.hypot(input.point.x - gesture.startScreen.x, input.point.y - gesture.startScreen.y) <= 4 && !gesture.changed) return
    const local = pointInFrame(gesture.frame, point), delta = { x: local.x - gesture.start.x, y: local.y - gesture.start.y }
    if (!gesture.handle) preview({ operation: 'move', delta })
    else {
      const shape = gesture.shape, ratio = read().cropAspectRatio || (input.shiftKey ? shape.props.w / shape.props.h : null)
      const crop = resizedImageCrop(shape, gesture.handle.id, delta, ratio)
      preview({ operation: 'set', crop })
    }
    gesture.changed = true
  }
  function up(input) {
    if (!gesture || input.pointerId !== gesture.pointerId) return
    move(input)
    return endGesture()
  }
  function endGesture() {
    if (!gesture) return Promise.resolve()
    const { changed, temporary } = gesture; gesture = null
    change({ mode: temporary ? 'idle' : 'cropping', ...(temporary && { croppingId: null }) })
    if (changed && session.state.get().isGestureActive) return session.commitGesture().catch(error => { report(error); throw error })
    if (session.state.get().isGestureActive) session.cancelGesture()
    return Promise.resolve()
  }
  function actionGesture(kind) {
    if (gesture || !read().croppingId) throw new CanvasEditError('请先进入裁剪并结束当前手势。', 'busy')
    const shape = editableImage(session.store, read().croppingId)
    session.beginGesture()
    gesture = { kind, shape, expected: selection.expected([shape.id]) }
  }
  return { describe, cancel, finish, begin, zoom: id => { const shape = session.store.get(id); return shape?.type === 'image' ? imageCropZoom(shape) : 0 },
    action(action) {
      if (action?.type === 'start') return begin(action.id)
      if (action?.type === 'finish') return finish()
      if (action?.type === 'cancel') return gesture ? cancel() : finish()
      if (action?.type === 'zoom_begin') return actionGesture('zoom')
      if (action?.type === 'zoom') {
        if (gesture?.kind !== 'zoom') throw new CanvasEditError('请先开始缩放取景。')
        preview({ operation: 'zoom', value: action.value }); gesture.changed = true; return
      }
      if (action?.type === 'zoom_end') return endGesture()
      if (action?.type === 'aspect' || action?.type === 'reset') {
        actionGesture('command')
        preview({ operation: action.type, preset: action.preset }); gesture.changed = true
        const ratio = action.type === 'aspect' && action.preset !== 'original' ? current().props.w / current().props.h : null
        return endGesture().then(() => change({ cropAspectRatio: ratio }))
      }
      throw new CanvasEditError('未知裁剪交互。')
    },
    dispatch(input) {
      if (gesture && !read().croppingId) cancel()
      if (!read().croppingId && input.type === 'pointer_down' && input.ctrlKey && input.button === 0 && read().toolId === 'select' && read().selectedIds.length === 1) {
        const id = read().selectedIds[0], point = screenToCanvas(input.point, read().camera)
        const handle = session.store.get(id)?.type === 'image' && hitSelectionHandle(describeSelection(selection, [id]), point, read().camera.z, handleMetrics)
        if (handle?.kind === 'resize') { begin(id); down(input, true); return { handled: true } }
      }
      // 2026-11-26, legacy tldraw 5.1.1, offscreen native down/up pairs:
      // crop entry is false after the second down and true after its up;
      // a cropped width180 stays180 on the second edge down, resets240 on up.
      if (input.type === 'pointer_up' && input.clickCount === 2 && input.button === 0 && read().toolId === 'select') {
        const point = screenToCanvas(input.point, read().camera)
        if (read().croppingId) {
          if (gesture && !gesture.changed && gesture.pointerId === input.pointerId && Math.hypot(input.point.x - gesture.startScreen.x, input.point.y - gesture.startScreen.y) <= 4) {
            const handle = hitSelectionHandle(describe(read()), point, read().camera.z, handleMetrics), temporary = gesture.temporary
            return { handled: true, result: Promise.resolve(up(input)).then(() => handle && !temporary && this.action({ type: 'reset' })) }
          }
        } else if (read().mode === 'pointing') {
          const id = targets.hitTest(point, 0)
          if (session.store.get(id)?.type === 'image') return { handled: false, after: () => {
            // The selection tool must first finish/cancel its click gesture.
            if (!session.state.get().isGestureActive && !session.state.get().isSubmitting && read().mode === 'idle' && read().selectedIds.length === 1 && read().selectedIds[0] === id) begin(id)
          } }
        }
      }
      if (input.type === 'key_down' && input.key === 'Enter' && read().toolId === 'select') {
        if (read().croppingId) { if (gesture) return { handled: true }; finish() }
        else if (read().selectedIds.length === 1 && session.store.get(read().selectedIds[0])?.type === 'image') begin()
        else return { handled: false }
        return { handled: true }
      }
      if (!read().croppingId) return { handled: false }
      if (input.type === 'key_down' && input.key === 'Escape') { if (gesture) cancel(); else finish(); return { handled: true } }
      if (input.type === 'pointer_down') return { handled: true, result: down(input) }
      if (input.type === 'pointer_move') return { handled: true, result: move(input) }
      if (input.type === 'pointer_up') return { handled: true, result: up(input) }
      if (input.type === 'pointer_cancel' && input.pointerId === gesture?.pointerId) return { handled: true, result: cancel() }
      return { handled: false }
    },
  }
}
