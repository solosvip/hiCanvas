// Every input carries time: monotonic host-clock milliseconds; no clock is read here.
// CSS screen coordinates relative to the canvas host; never raw host events.
// pointer_*: point, pointerId, pointerType, pressure, button, buttons, modifiers.
// key_*: key, code, repeat, modifiers. wheel: point, delta in CSS pixels, modifiers.
const types = new Set(['pointer_down', 'pointer_move', 'pointer_up', 'pointer_cancel', 'key_down', 'key_up', 'wheel', 'frame', 'double_click'])
export function normalizeInput(input) {
  if (!input || !types.has(input.type)) throw new Error('未知画布输入。')
  if (!Number.isFinite(input.time) || input.time < 0) throw new Error('输入时间需要非负有限毫秒。')
  const result = { type: input.type, time: input.time }
  if (input.type === 'frame') return result
  if (input.target !== undefined && !['canvas', 'minimap'].includes(input.target)) throw new Error('未知画布输入目标。')
  result.target = input.target || 'canvas'
  if (input.canvasPoint) {
    if (![input.canvasPoint.x, input.canvasPoint.y].every(Number.isFinite)) throw new Error('画布锚点需要有限屏幕坐标。')
    result.canvasPoint = { x: input.canvasPoint.x, y: input.canvasPoint.y }
  }
  for (const key of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey']) result[key] = Boolean(input[key])
  if (input.type.startsWith('key_')) return { ...result, key: String(input.key || ''), code: String(input.code || ''), repeat: Boolean(input.repeat) }
  if (input.type !== 'pointer_cancel' || input.point) {
    if (![input.point?.x, input.point?.y].every(Number.isFinite)) throw new Error('指针需要有限屏幕坐标。')
    result.point = { x: input.point.x, y: input.point.y }
  }
  if (input.type === 'wheel') {
    if (![input.delta?.x, input.delta?.y].every(Number.isFinite)) throw new Error('滚轮需要有限像素位移。')
    return { ...result, delta: { x: input.delta.x, y: input.delta.y } }
  }
  return { ...result, pointerId: input.pointerId ?? 1, pointerType: input.pointerType || 'mouse', pressure: Math.min(1, Math.max(0, Number(input.pressure) || 0)), button: input.button ?? 0, buttons: input.buttons ?? 0 }
}
