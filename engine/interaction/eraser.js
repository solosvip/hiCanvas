import { screenToCanvas } from '../../renderer/geometry.js'
import { createEraserTargets } from './eraser-targets.js'
import { CanvasEditError } from '../errors.js'

// Legacy native: documents stay intact while held; one release deletes all
// preview roots in one existing command/transaction. Cancellation has no undo.
export function createEraserTool({ session, index, targets, read, change, report }) {
  const hits = createEraserTargets(index, targets)
  // 123 isolated native cases: hit padding 8 screen px; 4 px is still a
  // click, 5 px begins dragging. Tail lifetime/easing is an intentional 100ms
  // approximation; native size=12 and taper/shrink were read independently.
  const lifetime = 100, maxPoints = 128
  let gesture = null, tail = null
  function describe(ids) {
    const points = tail?.points.map(({ x, y }) => ({ x, y })) || []
    const x = points.length ? Math.min(...points.map(p => p.x)) : 0, y = points.length ? Math.min(...points.map(p => p.y)) : 0
    return { kind: 'eraser', ids, points, tailScale: tail?.scale ?? 1,
      bounds: { x, y, w: points.length ? Math.max(...points.map(p => p.x)) - x : 0, h: points.length ? Math.max(...points.map(p => p.y)) - y : 0 } }
  }
  function age(time) {
    if (!tail) return
    while (tail.points.length > 1 && tail.points[0].time < time - lifetime) tail.points.shift()
    if (tail.ended !== null) {
      tail.scale = Math.max(0, 1 - (time - tail.ended) / lifetime)
      if (!tail.scale) tail = null
    }
  }
  function publish(ids = read().erasingIds, mode = read().mode) {
    if (gesture) hits.capture(ids, gesture.basis)
    change({ mode, erasingIds: ids, eraser: gesture || tail ? describe(ids) : null })
  }
  function cancel() {
    if (gesture && session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
    gesture = tail = null; publish([], 'idle')
  }
  function down(input) {
    if (gesture || input.button !== 0) return
    session.beginGesture()
    tail = null
    const state = read(), point = screenToCanvas(input.point, state.camera)
    gesture = { pointerId: input.pointerId, start: input.point, last: point, dragging: false, invalid: null, basis: { roots: new Set(), deleted: new Set(), expected: new Map() } }
    publish(hits.point(point, 8 / state.camera.z, state.focusedGroupId, input.metaKey || input.ctrlKey), 'pointing')
  }
  function move(input) {
    if (!gesture || gesture.invalid || input.pointerId !== gesture.pointerId) return
    if (!gesture.dragging && Math.hypot(input.point.x - gesture.start.x, input.point.y - gesture.start.y) <= 4) return
    gesture.dragging = true
    const state = read(), point = screenToCanvas(input.point, state.camera)
    const ids = hits.segment(gesture.last, point, 8 / state.camera.z, state.focusedGroupId)
    if (!tail) tail = { points: [], ended: null, scale: 1 }
    if (!tail.points.length || point.x !== gesture.last.x || point.y !== gesture.last.y) tail.points.push({ ...point, time: input.time })
    if (tail.points.length > maxPoints) tail.points.splice(0, tail.points.length - maxPoints)
    age(input.time)
    gesture.last = point
    publish(targets.roots([...new Set([...state.erasingIds, ...ids])]).sort(), 'erasing')
  }
  function up(input) {
    if (!gesture || input.pointerId !== gesture.pointerId) return
    if (gesture.invalid) throw gesture.invalid
    move(input)
    const ids = read().erasingIds.filter(hits.allowed)
    gesture = null
    if (tail) tail.ended = input.time
    if (!ids.length) { session.cancelGesture(); publish([], 'idle'); return }
    session.preview([{ type: 'delete', ids }])
    publish([], 'idle')
    return session.commitGesture().catch(error => { tail = null; publish([], 'idle'); report(error); throw error })
  }
  return { cancel, get needsFrame() { return Boolean(tail && (tail.points.length > 1 || tail.ended !== null)) },
    frame(time) { age(time); publish() },
    applyChanges(changes) {
      if (!gesture) return
      // No document preview exists until release, so runtime cannot detect a
      // held target changing yet. Retain its first-hit basis without scans.
      // Never cancel runtime from a Store interceptor: receive is still active.
      if (hits.changed(changes, gesture.basis)) {
        gesture.invalid = new CanvasEditError('擦除目标、后代或绑定已改变，本次擦除取消。', 'conflict')
        tail = null; publish([]); report(gesture.invalid)
      } else publish(read().erasingIds.filter(hits.allowed))
    },
    dispatch(input) {
    if (input.type === 'pointer_down') return down(input)
    if (input.type === 'pointer_move') return move(input)
    if (input.type === 'pointer_up') return up(input)
    if (input.type === 'pointer_cancel' && input.pointerId === gesture?.pointerId || input.type === 'key_down' && input.key === 'Escape') return cancel()
  } }
}
