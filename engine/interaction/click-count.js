// Shared editor input policy. The 400ms / 16 screen-CSS-pixel limits come
// from the previously observed hand-tool behaviour in camera-pan.js.
// camera-pan retains its own counting until its separate migration.
export function createClickCounter() {
  let previous = null
  const pressed = new Map()
  return function countClicks(input) {
    const result = { ...input }
    if (input.type === 'pointer_cancel') {
      pressed.delete(input.pointerId)
      previous = null
      return result
    }
    if (input.type === 'pointer_move') {
      const press = pressed.get(input.pointerId)
      if (press && Math.hypot(input.point.x - press.point.x, input.point.y - press.point.y) >= 16) previous = null
      return result
    }
    if (input.type === 'pointer_down') {
      const consecutive = previous && input.time - previous.time <= 400 && Math.hypot(input.point.x - previous.point.x, input.point.y - previous.point.y) < 16 && input.button === previous.button && input.pointerType === previous.pointerType
      const clickCount = consecutive ? previous.clickCount + 1 : 1
      previous = { ...input, point: { ...input.point }, clickCount }
      pressed.set(input.pointerId, { point: { ...input.point }, clickCount })
      result.clickCount = clickCount
    }
    if (input.type === 'pointer_up') {
      result.clickCount = pressed.get(input.pointerId)?.clickCount || 1
      pressed.delete(input.pointerId)
    }
    return result
  }
}
