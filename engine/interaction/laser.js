import { screenToCanvas } from '../../renderer/geometry.js'
import { appendTrailPoint, describeTrail } from './pointer-trail.js'

// Session overlays only: this tool deliberately has no editing-session port.
export function createLaserTool({ read, change }) {
  let strokes = [], active = null, sequence = 0, deadline = null
  function publish() {
    change({ ...(read().toolId === 'laser' && { mode: active ? 'lasering' : 'idle' }), laserTrails: strokes.map(s => ({ kind: 'laser', id: s.id, ...describeTrail(s.points) })) })
  }
  function move(input) {
    if (!active || input.pointerId !== active.pointerId) return
    const point = screenToCanvas(input.point, read().camera), last = active.points.at(-1)
    if (point.x !== last.x || point.y !== last.y) appendTrailPoint(active.points, point, 1024, 'decimate')
    publish()
  }
  function age(time) {
    if (deadline !== null && time >= deadline) {
      const waiting = strokes.filter(s => s.phase === 'waiting'), total = waiting.reduce((n, s) => n + s.points.length, 0)
      const batch = { start: deadline, step: Math.min(16.7, 500 / Math.max(1, total)), consumed: 0 }
      for (const stroke of waiting) { stroke.phase = 'shrinking'; stroke.batch = batch }
      deadline = null
    }
    for (const batch of new Set(strokes.filter(s => s.batch).map(s => s.batch))) {
      const target = Math.floor((time - batch.start) / batch.step) + 1
      let budget = Math.max(0, target - batch.consumed)
      batch.consumed = Math.max(batch.consumed, target)
      for (const stroke of strokes.filter(s => s.batch === batch)) {
        const count = Math.min(budget, stroke.points.length)
        stroke.points.splice(0, count); budget -= count
      }
    }
    strokes = strokes.filter(s => s.points.length)
  }
  function cancel() { strokes = []; active = null; deadline = null; publish() }
  function leave(time) {
    if (!active) return
    active.phase = 'waiting'; active = null; deadline = time + 1200; publish()
  }
  return { cancel, leave, get needsFrame() { return deadline !== null || strokes.some(s => s.phase === 'shrinking') },
    frame(time) { age(time); publish() },
    dispatch(input) {
      if (input.type === 'pointer_down' && input.button === 0 && !active) {
        age(input.time)
        deadline = null
        // A second pointer cannot start while active; every existing stroke
        // here is complete, so the oldest is the capacity eviction candidate.
        if (strokes.length === 32) strokes.shift()
        active = { id: `laser:${++sequence}`, phase: 'active', pointerId: input.pointerId, points: [screenToCanvas(input.point, read().camera)] }
        strokes.push(active); publish()
      }
      if (input.type === 'pointer_move') move(input)
      if (input.type === 'pointer_up' && input.pointerId === active?.pointerId) { move(input); leave(input.time) }
      if (input.type === 'pointer_cancel' && input.pointerId === active?.pointerId || input.type === 'key_down' && input.key === 'Escape' && active) cancel()
    },
  }
}
