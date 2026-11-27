import { getIndexAbove } from '@tldraw/utils'
import { b64Vecs } from '@tldraw/tlschema'
import { screenToCanvas } from '../../renderer/geometry.js'
import { CanvasEditError } from '../errors.js'
import { createStrokeInput, strokePressure } from './stroke-input.js'

const toLocal = (point, r) => {
  const x = point.x - r.x, y = point.y - r.y, c = Math.cos(r.rotation), s = Math.sin(r.rotation)
  return { x: x * c + y * s, y: -x * s + y * c }
}

export const createDrawTool = context => createStrokeTool(context, 'draw')
export const createHighlightTool = context => createStrokeTool(context, 'highlight')

function createStrokeTool({ session, index, targets, read, change, report, creationStyles }, type) {
  let gesture = null, continuation = null, generation = 0
  function releaseKey(key) { if (key === 'Shift') { continuation = null; generation++ } }
  function cancel() {
    continuation = null; generation++
    if (!gesture) return
    gesture = null
    if (session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
    change({ mode: 'idle' })
  }
  function localPoint(input, shape) {
    const page = screenToCanvas(input.point, read().camera)
    const local = targets.lineage(shape.parentId).reverse().reduce(toLocal, page)
    return { x: local.x - shape.x, y: local.y - shape.y, z: strokePressure(input) }
  }
  function check() {
    if (!session.state.get().isGestureActive || gesture.parents.some(([id, value]) => JSON.stringify(index.getRecord(id)) !== value)) throw new CanvasEditError('笔画所属画框或分组已改变，本次笔画已取消。', 'conflict')
  }
  function preview(complete = false) {
    check()
    const shape = gesture.shape
    shape.props = { ...shape.props, segments: gesture.path.encode(), isComplete: complete, ...(type === 'draw' && { isClosed: gesture.path.closed(read().camera.z) }) }
    session.preview([{ type: 'put', record: shape }])
    // Group reconciliation can move the local origin while preserving page
    // positions. Keep its adjusted record/parent basis, not our pre-frame pose.
    gesture.shape = structuredClone(index.getRecord(shape.id))
    gesture.parents = targets.lineage(gesture.shape.parentId).map(r => [r.id, JSON.stringify(r)])
  }
  function down(input) {
    if (gesture || input.button !== 0 || read().isPenMode && input.pointerType !== 'pen') return
    const state = read(), page = screenToCanvas(input.point, state.camera)
    let shape = continuation && input.shiftKey && index.getRecord(continuation.id)
    if (!shape || JSON.stringify(shape) !== continuation.record || shape.props.isPen !== (input.pointerType === 'pen')) shape = null
    let first, existing = []
    if (shape) {
      shape = structuredClone(shape); existing = shape.props.segments
      first = b64Vecs.decodePoints(existing.at(-1).path).at(-1)
    } else {
      // Legacy frame-start→outside stays in that frame; outside→inside stays
      // on page. Choose once in paint order, then retain local coordinates.
      const parentId = index.hitsAtPoint(page, 0).map(id => index.getRecord(id)).find(r => r.type === 'frame' && targets.isSelectable(r.id))?.id || state.focusedGroupId
      const origin = targets.lineage(parentId).reverse().reduce(toLocal, page)
      const siblings = targets.records.childIds(parentId).map(id => index.getRecord(id)?.index).filter(Boolean).sort()
      const styles = creationStyles(type)
      shape = { id: `shape:${globalThis.crypto.randomUUID()}`, typeName: 'shape', type, parentId, x: origin.x, y: origin.y, rotation: 0, index: getIndexAbove(siblings.at(-1) || 'a0'), isLocked: false, opacity: styles.opacity, meta: {},
        props: { ...styles.props, segments: [], isComplete: false, isPen: input.pointerType === 'pen', scale: 1, scaleX: 1, scaleY: 1, ...(type === 'draw' && { isClosed: false }) } }
      first = { x: 0, y: 0, z: strokePressure(input) }
    }
    session.beginGesture()
    gesture = { shape, pointerId: input.pointerId, path: createStrokeInput(first, input.shiftKey, existing), last: input, parents: targets.lineage(shape.parentId).map(r => [r.id, JSON.stringify(r)]) }
    continuation = null
    if (existing.length) gesture.path.move(localPoint(input, shape), true)
    change({ mode: 'drawing', selectedIds: [], hoveredId: null, handleCursor: null, lastError: null, ...(input.pointerType === 'pen' && { isPenMode: true }) })
    preview()
  }
  function move(input) {
    if (!gesture || input.pointerId !== gesture.pointerId) return
    gesture.last = input; gesture.path.move(localPoint(input, gesture.shape), input.shiftKey); preview()
  }
  function up(input) {
    if (!gesture || input.pointerId !== gesture.pointerId) return
    // Native pointerup force is zero. Retain held force, including a release
    // position received without a final move, without making a zero-width tip.
    move({ ...input, pressure: gesture.last.pressure, pointerType: gesture.last.pointerType })
    preview(true)
    const finished = gesture.shape, token = generation; gesture = null; change({ mode: 'idle' })
    // Legacy isComplete appeared ~6–15ms after native release, unchanged at
    // 350ms. That is observation delay, not a timer: commit immediately.
    return session.commitGesture().then(result => {
      if (token === generation && input.shiftKey && index.getRecord(finished.id)) continuation = { id: finished.id, record: JSON.stringify(index.getRecord(finished.id)) }
      return result
    }).catch(error => { continuation = null; report(error); throw error })
  }
  return { cancel, releaseKey, dispatch(input) {
    if (input.type === 'pointer_down') return down(input)
    if (input.type === 'pointer_move') return move(input)
    if (input.type === 'pointer_up') return up(input)
    if (input.type === 'pointer_cancel' && input.pointerId === gesture?.pointerId) return cancel()
    if (input.type === 'key_down' && input.key === 'Escape') return cancel()
    if (input.type.startsWith('key_') && input.key === 'Shift') {
      if (!gesture) return
      gesture.path.mode(input.type === 'key_down'); preview(); return true
    }
  } }
}
