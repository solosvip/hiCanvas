import { screenToCanvas } from '../../renderer/geometry.js'
import { CanvasEditError } from '../errors.js'

// Screen CSS pixels, independent of zoom. 2026-11-25 对照运行中的旧版逐帧观察。
const threshold = 4
const boxBetween = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })

export function createSelectionTool({ session, index, targets, read, change, report }) {
  let gesture = null
  function cancel() {
    if (!gesture) return
    const previous = gesture; gesture = null
    if (session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
    change({ mode: 'idle', marquee: null, ...(previous.kind === 'marquee' && { selectedIds: previous.before }) })
  }
  function captureRecords(starts) {
    const expected = new Map()
    for (const start of starts) for (let r = index.getRecord(start.id); r?.typeName === 'shape'; r = index.getRecord(r.parentId)) expected.set(r.id, JSON.stringify(r))
    return expected
  }
  function down(input) {
    if (gesture || session.state.get().isSubmitting || input.button !== 0) return
    const state = read(), start = screenToCanvas(input.point, state.camera)
    const hit = targets.hitTest(start, 4 / state.camera.z), before = state.selectedIds
    session.beginGesture()
    gesture = { kind: 'pointing', pointerId: input.pointerId, startScreen: input.point, start, before, hit, toggle: input.shiftKey && before.includes(hit), additive: input.shiftKey }
    let selectedIds = before
    if (hit && !before.includes(hit)) selectedIds = input.shiftKey ? [...before, hit] : [hit]
    if (!hit && !input.shiftKey) selectedIds = []
    change({ mode: 'pointing', selectedIds, hoveredId: hit, lastError: null })
    // Parent-space start positions are captured once. Every preview is an
    // absolute update, avoiding accumulated drift and full-document nudge reads.
    const selected = new Set(selectedIds)
    gesture.starts = selectedIds.filter(id => {
      for (let r = index.getRecord(index.getRecord(id)?.parentId); r?.typeName === 'shape'; r = index.getRecord(r.parentId)) if (selected.has(r.id)) return false
      return targets.isSelectable(id)
    }).map(id => { const r = index.getRecord(id); return { id, x: r.x, y: r.y } })
    gesture.expected = captureRecords(gesture.starts)
  }
  function move(input) {
    const state = read(), point = screenToCanvas(input.point, state.camera)
    if (!gesture) { change({ hoveredId: targets.hitTest(point, 4 / state.camera.z) }); return }
    if (input.pointerId !== gesture.pointerId) return
    if (gesture.kind === 'pointing' && Math.hypot(input.point.x - gesture.startScreen.x, input.point.y - gesture.startScreen.y) <= threshold) return
    if (!gesture.hit) {
      gesture.kind = 'marquee'
      const marquee = boxBetween(gesture.start, point), ids = targets.query(marquee)
      change({ mode: 'marquee', marquee, selectedIds: [...new Set([...(gesture.additive ? gesture.before : []), ...ids])] }); return
    }
    // A refresh before the first preview has no runtime diff to conflict with.
    // Verify only captured targets/ancestors before using their old start poses;
    // unrelated remote records may change without cancelling this gesture.
    if (!session.state.get().isGestureActive || [...gesture.expected].some(([id, value]) => JSON.stringify(index.getRecord(id)) !== value)) throw new CanvasEditError('拖动目标已被其他操作更改，本次拖动已取消。', 'conflict')
    gesture.kind = 'dragging'
    const delta = { x: point.x - gesture.start.x, y: point.y - gesture.start.y }
    const commands = gesture.starts.map(start => {
      const local = index.parentDelta(start.id, delta)
      return { type: 'update', id: start.id, changes: { x: start.x + local.x, y: start.y + local.y } }
    })
    if (commands.length) session.preview(commands)
    gesture.expected = captureRecords(gesture.starts)
    change({ mode: 'dragging' })
  }
  function up(input) {
    if (!gesture || input.pointerId !== gesture.pointerId) return
    const previous = gesture
    // Pointerup can carry the last coalesced position even without a move frame.
    if (input.point) move(input)
    gesture = null
    if (previous.kind === 'pointing' && previous.hit) {
      if (!previous.additive) change({ selectedIds: [previous.hit] })
      else if (previous.toggle) change({ selectedIds: read().selectedIds.filter(id => id !== previous.hit) })
    }
    change({ mode: 'idle', marquee: null })
    if (previous.kind === 'dragging' && session.state.get().isGestureActive) return session.commitGesture().catch(error => { report(error); throw error })
    if (session.state.get().isGestureActive) session.cancelGesture()
  }
  return { cancel, dispatch(input) {
    if (input.type === 'pointer_down') return down(input)
    if (input.type === 'pointer_move') return move(input)
    if (input.type === 'pointer_up') return up(input)
    if (input.type === 'pointer_cancel' && (input.pointerId === gesture?.pointerId || !gesture)) return cancel()
    if (input.type === 'key_down' && input.key === 'Escape') return cancel()
  } }
}
