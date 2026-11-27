import { screenToCanvas } from '../../renderer/geometry.js'
import { CanvasEditError } from '../errors.js'
import { createScribble } from './scribble.js'
import { createHandleGesture } from './handle-gesture.js'
import { hitSelectionHandle, selectionHandleCursor } from './selection-handles.js'
import { connectionCoordinates } from './connection-coordinates.js'
import { matchesCanvasShortcut } from './shortcuts.js'
import { createFrameDrag } from './frame-interaction.js'

// Screen CSS pixels, independent of zoom. 2026-11-25 对照运行中的旧版逐帧观察。
const threshold = 4
const boxBetween = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })

export function createSelectionTool(context) {
  const { session, index, targets, handleMetrics, read, change, report } = context
  const handles = createHandleGesture(context)
  let gesture = null
  function cancel() {
    context.snapping.clear()
    handles.cancel()
    if (!gesture) return
    const previous = gesture; gesture = null
    if (session.state.get().isGestureActive && !session.state.get().isSubmitting) session.cancelGesture()
    if (previous.cloned) previous.restoreDuplicate()
    change({ mode: 'idle', marquee: null, scribble: null, needsFrame: false, ...(previous.cloned && { selectedIds: previous.selectedIds }), ...(['marquee', 'scribble'].includes(previous.kind) && { selectedIds: previous.before, focusedGroupId: previous.scope }) })
  }
  function captureRecords(starts) {
    const expected = new Map()
    for (const start of starts) for (let r = index.getRecord(start.id); r?.typeName === 'shape'; r = index.getRecord(r.parentId)) expected.set(r.id, JSON.stringify(r))
    return expected
  }
  function down(input) {
    if (gesture || handles.active || session.state.get().isSubmitting || input.button !== 0) return
    const state = read(), start = screenToCanvas(input.point, state.camera)
    const overlay = state.overlays.find(o => o.kind === 'selection'), handle = hitSelectionHandle(overlay, start, state.camera.z, handleMetrics)
    if (handle) return handles.begin(input, handle, { ...overlay.bounds, rotation: overlay.rotation })
    const picked = targets.hit(start, 4 / state.camera.z, state.focusedGroupId), hit = picked.id, before = state.selectedIds
    session.beginGesture()
    gesture = { scope: picked.focusedGroupId, lastInput: input, alt: input.altKey, kind: 'pointing', pointerId: input.pointerId, startScreen: input.point, start, before, hit, toggle: input.shiftKey && before.includes(hit), additive: input.shiftKey }
    let selectedIds = before
    if (hit && !before.includes(hit)) selectedIds = input.shiftKey ? [...before, hit] : [hit]
    if (!hit && !input.shiftKey) selectedIds = []
    change({ mode: 'pointing', focusedGroupId: picked.focusedGroupId, selectedIds, hoveredId: hit, lastError: null })
    // Keep local origins for ordinary drags and page origins across containers.
    const selected = new Set(selectedIds)
    gesture.starts = selectedIds.filter(id => {
      for (let r = index.getRecord(index.getRecord(id)?.parentId); r?.typeName === 'shape'; r = index.getRecord(r.parentId)) if (selected.has(r.id)) return false
      return targets.isSelectable(id)
    }).map(id => { const r = index.getRecord(id); return { id, parentId: r.parentId, x: r.x, y: r.y, bounds: index.getBounds(id), page: connectionCoordinates(index, id).page({ x: 0, y: 0 }) } })
    gesture.frames = createFrameDrag(context, gesture.starts)
    gesture.expected = captureRecords(gesture.starts)
    gesture.selectedIds = [...selectedIds]
    gesture.restoreDuplicate = context.duplicates.checkpoint()
  }
  function move(input) {
    const state = read(), point = screenToCanvas(input.point, state.camera)
    if (!gesture) {
      const overlay = state.overlays.find(o => o.kind === 'selection'), handle = hitSelectionHandle(overlay, point, state.camera.z, handleMetrics)
      change({ hoveredId: handle ? null : targets.hitTest(point, 4 / state.camera.z, state.focusedGroupId), handleCursor: selectionHandleCursor(handle, overlay?.rotation || 0) }); return
    }
    if (input.pointerId !== gesture.pointerId) return
    if (gesture.kind === 'pointing' && Math.hypot(input.point.x - gesture.startScreen.x, input.point.y - gesture.startScreen.y) <= threshold) return
    if (!gesture.hit) {
      gesture.lastInput = input
      let ids, marquee = null, scribble = null
      if (gesture.alt) {
        gesture.kind = 'scribble'
        gesture.stroke ||= createScribble(targets, gesture.scope, gesture.start, input.time)
        const result = gesture.stroke.move(point, input.time); ids = result.ids; scribble = result.overlay
      } else {
        gesture.kind = 'marquee'; marquee = boxBetween(gesture.start, point)
        ids = targets.query(marquee, gesture.scope, state.isWrapMode !== input.ctrlKey)
      }
      change({ mode: gesture.kind, marquee, scribble, selectedIds: [...new Set([...(gesture.additive ? gesture.before : []), ...ids])] }); return
    }
    // A refresh before the first preview has no runtime diff to conflict with.
    // Verify only captured targets/ancestors before using their old start poses;
    // unrelated remote records may change without cancelling this gesture.
    if (!session.state.get().isGestureActive || [...gesture.expected].some(([id, value]) => JSON.stringify(index.getRecord(id)) !== value)) throw new CanvasEditError('拖动目标已被其他操作更改，本次拖动已取消。', 'conflict')
    gesture.kind = 'dragging'
    let delta = { x: point.x - gesture.start.x, y: point.y - gesture.start.y }
    // Legacy native Shift toggles live and can change dominant axis mid-drag.
    if (input.shiftKey) delta[Math.abs(delta.x) > Math.abs(delta.y) ? 'y' : 'x'] = 0
    delta = context.snapping.move(gesture.starts, delta, input)
    gesture.lastInput = input
    // 2026-11-26 isolated legacy native drag: (50,30), Alt down restores the
    // originals and selects copies at that delta; release returns to moving
    // originals. Retoggling allocates new IDs, Escape removes all previews,
    // one undo reverses the whole gesture. Alt-copy (70,40) seeds Mod+D too.
    const updates = (starts, offset) => starts.map(start => {
      if (index.getRecord(start.id).parentId === start.parentId) {
        const local = index.parentDelta(start.id, offset)
        return { type: 'update', id: start.id, changes: { x: start.x + local.x, y: start.y + local.y } }
      }
      const local = connectionCoordinates(index, index.getRecord(start.id).parentId).local({ x: start.page.x + offset.x, y: start.page.y + offset.y })
      return { type: 'update', id: start.id, changes: local }
    })
    if (input.altKey && !gesture.copy) {
      gesture.frames.reset()
      const preview = gesture.frames.preview([{ type: 'duplicate_shapes', ids: gesture.selectedIds, offset: delta }])
      const idMap = preview.results.at(-1).idMap
      gesture.copy = { idMap, starts: gesture.starts.map(start => ({ ...start, id: idMap[start.id] })) }
      gesture.cloned = true
      change({ selectedIds: gesture.selectedIds.map(id => idMap[id]) })
    } else if (!input.altKey && gesture.copy) {
      gesture.frames.reset()
      gesture.frames.preview(updates(gesture.starts, delta))
      gesture.copy = null
      gesture.restoreDuplicate()
      change({ selectedIds: gesture.selectedIds })
    } else {
      const commands = updates(gesture.copy?.starts || gesture.starts, delta)
      if (commands.length) gesture.frames.preview(commands)
    }
    gesture.frames.contain(gesture.copy?.starts || gesture.starts, point)
    gesture.delta = delta
    gesture.expected = captureRecords([...gesture.starts, ...(gesture.copy?.starts || [])])
    change({ mode: 'dragging' })
  }
  function up(input) {
    if (!gesture || input.pointerId !== gesture.pointerId) return
    const previous = gesture
    // Pointerup can carry the last coalesced position even without a move frame.
    if (input.point) move(input)
    gesture = null
    context.snapping.clear()
    if (previous.kind === 'pointing' && previous.hit) {
      if (!previous.additive) change({ selectedIds: [previous.hit] })
      else if (previous.toggle) change({ selectedIds: read().selectedIds.filter(id => id !== previous.hit) })
    }
    change({ mode: 'idle', marquee: null, scribble: null, needsFrame: false, ...(previous.kind === 'pointing' && !previous.hit && { focusedGroupId: targets.pageId }) })
    if (previous.kind === 'dragging' && session.state.get().isGestureActive) return previous.frames.commit(previous.copy?.starts || previous.starts).then(reply => {
      if (previous.copy) context.duplicates.remember(previous.selectedIds, previous.copy.idMap, previous.delta)
      return reply
    }).catch(error => { if (previous.cloned) { previous.restoreDuplicate(); change({ selectedIds: previous.selectedIds }) }; report(error); throw error })
    if (session.state.get().isGestureActive) session.cancelGesture()
    if (previous.kind === 'pointing' && previous.hit && input.clickCount === 2 && index.getRecord(previous.hit)?.type === 'group') {
      context.select('enter')
      const state = read(), hit = targets.hitTest(screenToCanvas(input.point, state.camera), 4 / state.camera.z, state.focusedGroupId)
      if (hit) change({ selectedIds: [hit] })
    }
  }
  return { cancel, refreshSnapping() { if(handles.active)handles.refreshSnapping();else if(gesture?.kind==='dragging')move(gesture.lastInput) }, get needsFrame() { return Boolean(gesture?.stroke?.needsFrame) }, frame(time) { if (gesture?.stroke) { const scribble = gesture.stroke.age(time); change({ scribble, needsFrame: gesture.stroke.needsFrame }) } }, dispatch(input) {
    if (handles.active) return handles.dispatch(input)
    if (gesture?.lastInput && matchesCanvasShortcut('selection-modifiers', input)) return move({ ...gesture.lastInput, ...input, type: 'pointer_move', point: gesture.lastInput.point, pointerId: gesture.pointerId })
    if (input.type === 'pointer_down') return down(input)
    if (input.type === 'pointer_move') return move(input)
    if (input.type === 'pointer_up') return up(input)
    if (input.type === 'pointer_cancel' && (input.pointerId === gesture?.pointerId || !gesture)) return cancel()
    if (input.type === 'key_down' && input.key === 'Escape') return cancel()
  } }
}
