import { matchesCanvasShortcut } from './shortcuts.js'
import { screenToCanvas } from '../../renderer/geometry.js'
import { boxBetween, fitCamera, stepZoom } from './camera-math.js'

// H10 was not observable in the legacy 5000-shape corner view (#85).
// Shift does not invent a temporary overview; see the inventory annotation.
export function createZoomTool({ read, change, motion, navigate, viewport }) {
  let active = false, rectangle = null
  function enter(now) { if (active) return; active = true; motion.stop(); change({ temporaryTool: 'zoom', hoveredId: null }); return now }
  function leave() {
    if (!active) return false
    active = false; rectangle = null; change({ temporaryTool: null, marquee: null, mode: 'idle' }); return true
  }
  function handle(input) {
    if (matchesCanvasShortcut('zoom-hold', input)) {
      enter(input.time); return true
    }
    if (!active) return false
    if (input.type === 'key_down' && matchesCanvasShortcut('escape', input)) return leave()
    if (matchesCanvasShortcut('zoom-release', input)) return leave()
    if (input.type === 'pointer_down' && input.button === 0) {
      motion.stop(); rectangle = { id: input.pointerId, start: input.point, camera: read().camera }; change({ mode: 'zooming' }); return true
    }
    if (rectangle && input.pointerId === rectangle.id) {
      if (input.type === 'pointer_cancel') { rectangle = null; change({ mode: 'idle', marquee: null }); return true }
      if (input.type === 'pointer_move') { change({ marquee: boxBetween(screenToCanvas(rectangle.start, rectangle.camera), screenToCanvas(input.point, rectangle.camera)) }); return true }
      if (input.type === 'pointer_up') {
        const screenBox = boxBetween(rectangle.start, input.point), bounds = boxBetween(screenToCanvas(rectangle.start, rectangle.camera), screenToCanvas(input.point, rectangle.camera))
        if (screenBox.w > 4 && screenBox.h > 4) {
          const fitted = fitCamera(bounds, viewport())
          // Black-box #85: Alt rectangles of both 500×370 and 1150×700
          // always take one zoom-out step, centered on the rectangle. At 5%
          // they leave the camera unchanged (2026-11-25 native input).
          if (input.altKey) fitted.z = stepZoom(rectangle.camera.z, -1)
          // Re-center after reversing a rectangular zoom.
          fitted.x = viewport().w / (2 * fitted.z) - bounds.x - bounds.w / 2
          fitted.y = viewport().h / (2 * fitted.z) - bounds.y - bounds.h / 2
          if (!input.altKey || fitted.z !== rectangle.camera.z) motion.animate(fitted, input.time)
        } else navigate(input.altKey ? 'zoom-out' : 'zoom-in', input.point, input.time)
        rectangle = null; change({ marquee: null, mode: 'idle' }); return true
      }
    }
    return input.type.startsWith('pointer_')
  }
  return { handle, leave, active: () => active }
}
