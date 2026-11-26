import { getMinimapLayout, minimapToPagePoint, hitMinimapViewport } from '../../renderer/geometry.js'
import { checkedViewport, centerOf } from './camera-math.js'

// #98 / 2349 approval: deliberate fixes to observed legacy behavior. Native
// scroll 40 caused two DOM wheel events (minimap.canvas, then canvas), y += 80;
// Ctrl scroll 5 gave z *= 1.05². Route once through the shared #85 navigation.
// Legacy drag also chased a stationary pointer: x 98.863636 -> 98.295455 on
// repeated move at identical coordinates. Freeze the framing for drawing AND
// input until release; displacement is exact, symmetric, independent of origin.
export function createMinimapInteraction({ session, read, change, content, navigation }) {
  let dimensions = null, drag = null, click = null
  const atPoint = (tap, point) => tap && Math.hypot(tap.point.x - point.x, tap.point.y - point.y) <= 5
  function describe(state = read()) {
    if (!dimensions) return null
    const layout = getMinimapLayout({ camera: state.camera, viewport: state.viewport, size: dimensions, contentBounds: content.bounds(), frameBounds: drag?.layout.pageBounds })
    return Object.freeze({ size: dimensions, layout, dragging: Boolean(drag) })
  }
  function cancel(clearClick = true) { if (clearClick) click = null; if (!drag) return; drag = null; change({ mode: 'idle' }) }
  function handle(input) {
    if (drag && input.type === 'key_down' && input.key === 'Escape') { navigation.reset(); cancel(); return true }
    if (input.target !== 'minimap') {
      if (['wheel', 'pointer_down', 'key_down'].includes(input.type)) click = null
      return Boolean(drag && input.type.startsWith('pointer_'))
    }
    if (!dimensions || session.state.get().isGestureActive) return true
    const state = read()
    if (input.type === 'wheel') {
      click = null
      if (drag) return true
      navigation.handle({ ...input, point: input.canvasPoint || centerOf(state.viewport) }); return true
    }
    if (input.type === 'key_down') {
      click = null
      const delta = { ArrowLeft: { x: -40, y: 0 }, ArrowRight: { x: 40, y: 0 }, ArrowUp: { x: 0, y: -40 }, ArrowDown: { x: 0, y: 40 } }[input.key]
      if (delta && !drag) { navigation.reset(); change({ camera: { ...state.camera, x: state.camera.x - delta.x / state.camera.z, y: state.camera.y - delta.y / state.camera.z } }) }
      return true
    }
    if (input.type === 'double_click') {
      // Native dblclick arrives after two complete taps, with animation frames
      // between them. Keep the first tap's world target when reframing changes.
      // The host has already recognized the native double click. Do not impose
      // another timeout: OS double-click preferences may allow slower taps.
      const point = atPoint(click, input.point) && atPoint(click.previous, input.point) ? click.previous.page : minimapToPagePoint(describe().layout, input.point)
      navigation.reset(); cancel(); navigation.centerOn(point, input.time); return true
    }
    if (input.type === 'pointer_down') {
      if (drag || input.button !== 0) return true
      const layout = describe().layout, camera = state.camera
      navigation.reset()
      const inside = hitMinimapViewport(layout, input.point), page = minimapToPagePoint(layout, input.point)
      const origin = inside ? camera : { ...camera, x: state.viewport.w / (2 * camera.z) - page.x, y: state.viewport.h / (2 * camera.z) - page.y }
      drag = { pointerId: input.pointerId, point: input.point, camera: origin, layout, page, axis: null, moved: false }
      change({ mode: 'minimap-panning' })
      if (!inside) navigation.centerOn(page, input.time)
      return true
    }
    if (!drag || input.pointerId !== drag.pointerId) return true
    if (input.type === 'pointer_move') {
      let x = input.point.x - drag.point.x, y = input.point.y - drag.point.y
      if (!x && !y && !drag.moved) return true
      if (input.shiftKey) { drag.axis ||= Math.abs(x) >= Math.abs(y) ? 'x' : 'y'; if (drag.axis === 'x') y = 0; else x = 0 }
      else drag.axis = null
      const camera = { ...drag.camera, x: drag.camera.x - x / drag.layout.scale, y: drag.camera.y - y / drag.layout.scale }
      drag.moved = true; navigation.reset(); change({ camera, mode: 'minimap-panning' })
    } else if (input.type === 'pointer_up' || input.type === 'pointer_cancel') {
      if (input.type === 'pointer_cancel') navigation.reset()
      click = input.type === 'pointer_up' && !drag.moved ? { point: drag.point, page: drag.page, previous: click && { point: click.point, page: click.page } } : null
      cancel(false)
    }
    return true
  }
  return { describe, handle, cancel,
    setSize(value) {
      const next = value === null ? null : checkedViewport(value)
      if (next?.w === dimensions?.w && next?.h === dimensions?.h) return
      // Visibility changes (including a narrow-window resize) must not reset
      // another surface's active shape drag or camera navigation.
      if (drag) navigation.reset()
      cancel(); dimensions = next; change()
    },
  }
}
