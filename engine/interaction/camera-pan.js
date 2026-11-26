import { clampZoom } from './camera-math.js'

export function createHandTool({ navigation }) {
  return { cancel: () => navigation.cancelPan(), dispatch: input => navigation.pan(input) }
}

export function createCameraPan({ read, change, motion, cancelTool, navigate, reduceMotion }) {
  let drag = null, touches = new Map(), pinch = null, consumingTouch = false, click = null
  const pair = () => {
    const [a, b] = [...touches.values()]
    return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) }
  }
  function cancel() { drag = pinch = null; touches.clear(); consumingTouch = false; click = null; motion.stop(); change({ mode: 'idle' }) }
  function pan(input) {
    if (input.type === 'pointer_down' && !drag && [0, 1].includes(input.button)) {
      motion.stop()
      drag = { id: input.pointerId, start: input.point, camera: read().camera, previous: input.point, time: input.time, velocity: { x: 0, y: 0 }, moved: false }
      change({ mode: 'panning', hoveredId: null }); return true
    }
    if (!drag || input.pointerId !== drag.id) return false
    if (input.type === 'pointer_cancel') { cancel(); return true }
    if (input.type === 'pointer_move' || input.type === 'pointer_up') {
      const dx = input.point.x - drag.start.x, dy = input.point.y - drag.start.y, dt = input.time - drag.time
      const delta = { x: input.point.x - drag.previous.x, y: input.point.y - drag.previous.y }
      if (Math.hypot(dx, dy) > 4) drag.moved = true
      if (dt > 0 && (delta.x || delta.y)) {
        drag.velocity = { x: Math.max(-2, Math.min(2, delta.x / dt / 2)), y: Math.max(-2, Math.min(2, delta.y / dt / 2)) }
        drag.previous = input.point; drag.time = input.time
      }
      change({ camera: { ...drag.camera, x: drag.camera.x + dx / drag.camera.z, y: drag.camera.y + dy / drag.camera.z } })
      if (input.type === 'pointer_up') {
        const previous = drag; drag = null; change({ mode: 'idle' })
        if (previous.moved) { click = null; if (input.time - previous.time < 100) motion.slide(previous.velocity, input.time) }
        else if (input.button === 0 && read().toolId === 'hand') {
          click = click && input.time - click.time < 400 && Math.hypot(click.point.x - input.point.x, click.point.y - input.point.y) < 16 ? { count: click.count + 1, time: input.time, point: input.point } : { count: 1, time: input.time, point: input.point }
          if (click.count === 2) navigate('zoom-in', input.point, input.time)
          if (click.count === 3) navigate('zoom-out', input.point, input.time)
          if (click.count === 4) { navigate(Math.abs(read().camera.z - 1) < .001 ? 'fit-all' : 'reset-zoom', input.point, input.time); click = null }
        }
      }
      return true
    }
    return false
  }
  function touch(input) {
    if (input.pointerType !== 'touch') return false
    if (input.type === 'pointer_down') {
      touches.set(input.pointerId, input.point)
      if (touches.size === 2) { if (read().toolId !== 'hand') cancelTool(); drag = null; motion.stop(); pinch = { ...pair(), camera: read().camera }; consumingTouch = true; change({ mode: 'pinching', hoveredId: null }) }
    } else if (input.type === 'pointer_move' && touches.has(input.pointerId)) touches.set(input.pointerId, input.point)
    if (pinch && touches.size >= 2 && input.type === 'pointer_move') {
      const current = pair(), z = clampZoom(pinch.camera.z * current.distance / pinch.distance)
      change({ camera: { x: current.center.x / z - pinch.center.x / pinch.camera.z + pinch.camera.x, y: current.center.y / z - pinch.center.y / pinch.camera.z + pinch.camera.y, z } })
    }
    const consumed = consumingTouch
    if (['pointer_up', 'pointer_cancel'].includes(input.type)) {
      touches.delete(input.pointerId)
      if (touches.size < 2) pinch = null
      if (!touches.size && consumingTouch) { consumingTouch = false; change({ mode: 'idle' }) }
    }
    return consumed
  }
  return { pan, touch, cancel, active: () => Boolean(drag || consumingTouch), isDragging: () => Boolean(drag), reduceMotion }
}
