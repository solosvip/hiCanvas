import { anchoredZoom, centerOf, checkedViewport, fitCamera, stepZoom } from './camera-math.js'
import { createCameraMotion } from './camera-motion.js'
import { createCameraPan } from './camera-pan.js'
import { createZoomTool } from './camera-zoom-tool.js'

export function createCameraNavigation({ session, read, change, content, cancelTool, setTool, inputDevice, invertZoom, reduceMotion }) {
  if (![null, 'mouse', 'trackpad'].includes(inputDevice)) throw new Error('输入设备须为 null、mouse 或 trackpad。')
  const motion = createCameraMotion({ read, change, reduceMotion })
  let space = false, point = null, edgePointer = null, lastFrame = null
  const viewport = () => read().viewport
  function navigate(action, anchor = null, time = 0) {
    const camera = read().camera, at = anchor?.atPointer ? point || centerOf(viewport()) : anchor || centerOf(viewport())
    let target
    if (action === 'zoom-in' || action === 'zoom-out') target = anchoredZoom(camera, stepZoom(camera.z, action === 'zoom-in' ? 1 : -1), at)
    else if (action === 'reset-zoom') target = anchoredZoom(camera, 1, at)
    else if (action === 'fit-all') target = fitCamera(content.bounds(), viewport())
    else if (action === 'fit-selection') target = fitCamera(content.bounds(read().selectedIds), viewport())
    else if (action === 'return-content') target = fitCamera(content.bounds(read().selectedIds.length ? read().selectedIds : undefined), viewport(), Math.min(1, camera.z))
    else throw new Error('未知视角操作。')
    motion.animate(target, time)
  }
  const pan = createCameraPan({ read, change, motion, cancelTool, navigate, reduceMotion })
  const zoom = createZoomTool({ read, change, motion, navigate, viewport, content })
  function cancel() { space = false; edgePointer = null; pan.cancel(); zoom.leave(lastFrame || 0, true); motion.stop(); change({ needsFrame: false, temporaryTool: null }) }
  function edgeActive() { return read().edgeScrolling && edgePointer && ['dragging', 'marquee'].includes(read().mode) }
  function edgeTick(input) {
    if (!edgeActive()) return false
    const { w, h } = viewport(), p = edgePointer.point, margin = 32
    const speed = (v, size) => v < margin ? Math.max(-1, (v - margin) / margin) : v > size - margin ? Math.min(1, (v - size + margin) / margin) : 0
    const x = speed(p.x, w), y = speed(p.y, h)
    if (!x && !y) return false
    const dt = Math.min(32, Math.max(0, input.time - (lastFrame ?? input.time - 16))), camera = read().camera
    change({ camera: { ...camera, x: camera.x - x * dt / camera.z, y: camera.y - y * dt / camera.z } })
    // Re-feed the held pointer after moving the camera: previews stay attached
    // to its canvas position and still belong to the same runtime gesture.
    return { ...edgePointer, time: input.time }
  }
  function handle(input) {
    if (input.point) point = input.point
    if (input.type === 'frame') {
      motion.tick(input.time)
      const replay = edgeTick(input); lastFrame = input.time
      return { handled: true, replay }
    }
    if (input.type === 'wheel') {
      motion.stop()
      // Legacy #85: fresh automatic sessions pan for native integer scrolls
      // of 1/10/40/100/120px, as well as after a pinch. Magnitude alone is
      // not evidence of a mouse; explicit mouse mode selects wheel zoom.
      const device = inputDevice || 'trackpad', pinch = input.ctrlKey || input.metaKey
      if (device === 'mouse' || pinch) {
        const delta = Math.max(-10, Math.min(10, input.delta.y)) * .01 * (device === 'mouse' && invertZoom && !pinch ? -1 : 1)
        change({ camera: anchoredZoom(read().camera, read().camera.z * (1 - delta), input.point) })
      } else {
        const camera = read().camera
        const x = input.shiftKey && !input.delta.x ? input.delta.y : input.delta.x, y = input.shiftKey && !input.delta.x ? 0 : input.delta.y
        change({ camera: { ...camera, x: camera.x - x / camera.z, y: camera.y - y / camera.z } })
      }
      return { handled: true }
    }
    if (session.state.get().isGestureActive && input.type.startsWith('key_') && input.key.toLowerCase() === 'z') return { handled: false }
    if (input.type === 'pointer_down') motion.stop()
    if (zoom.handle(input)) return { handled: true }
    if (input.type.startsWith('key_')) {
      const down = input.type === 'key_down', key = input.key.toLowerCase(), mod = input.ctrlKey || input.metaKey
      if (key === 'escape') { if (down) cancel(); return { handled: false } }
      if (key === ' ' || input.code === 'Space') { if (!session.state.get().isGestureActive) space = down; change({ temporaryTool: space ? 'hand' : null }); return { handled: true } }
      if (!down || input.repeat) return { handled: false }
      if (!mod && !input.altKey && (key === 'h' || key === 'v')) { return { handled: setTool(key === 'h' ? 'hand' : 'select') } }
      if (['=', '+', '-'].includes(key)) { navigate(key === '-' ? 'zoom-out' : 'zoom-in', input.shiftKey ? point : null, input.time); return { handled: true } }
      if (input.shiftKey && ['0', '1', '2'].includes(key)) { navigate({ 0: 'reset-zoom', 1: 'fit-all', 2: 'fit-selection' }[key], null, input.time); return { handled: true } }
      return { handled: false }
    }
    if (pan.touch(input)) return { handled: true }
    if (pan.isDragging() || input.type === 'pointer_down' && (input.button === 1 || space) && !session.state.get().isGestureActive) return { handled: pan.pan(input) }
    if (input.type === 'pointer_move') edgePointer = input
    if (['pointer_up', 'pointer_cancel'].includes(input.type)) edgePointer = null
    return { handled: false }
  }
  return { handle, navigate, cancel, pan: pan.pan, cancelPan: pan.cancel,
    centerOn(point, time) { const camera = read().camera, v = viewport(); motion.animate({ ...camera, x: v.w / (2 * camera.z) - point.x, y: v.h / (2 * camera.z) - point.y }, time) },
    reset: () => { cancel(); lastFrame = null },
    finishFrame() {
      const edge = edgeActive() && (() => { const p = edgePointer.point, v = viewport(); return p.x < 32 || p.y < 32 || p.x > v.w - 32 || p.y > v.h - 32 })()
      change({ needsFrame: Boolean(motion.active() || edge) })
    },
    setViewport: value => change({ viewport: checkedViewport(value) }),
  }
}
