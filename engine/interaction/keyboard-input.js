import { matchesCanvasShortcut } from './shortcuts.js'

const owners = new Set(['canvas', 'text-editing', 'form', 'menu'])
export function checkedInputContext(value = { owner: 'canvas' }) {
  if (!value || !owners.has(value.owner)) throw new Error('输入上下文须为 canvas、text-editing、form 或 menu。')
  return Object.freeze({ owner: value.owner, isComposing: Boolean(value.isComposing) })
}

// Hosts report focus/composition; this module owns routing, including future
// #132 text editing. No host event or document record enters this state.
export function createKeyboardInput({ read, change, releaseKeys, releaseKey, cancelPointer, dispatchPointer, isBusy }) {
  let point = null, virtualPointer = false
  const onCanvas = () => read().inputContext.owner === 'canvas' && !read().inputContext.isComposing
  function cancel() {
    if (virtualPointer) { virtualPointer = false; cancelPointer() }
    releaseKeys()
  }
  function context(value) {
    change({ inputContext: checkedInputContext(value) })
    if (!onCanvas()) cancel()
  }
  function shortcuts(enabled) {
    change({ shortcutsEnabled: Boolean(enabled) })
    if (!enabled) cancel()
  }
  function route(input) {
    if (input.type.startsWith('pointer_')) {
      if (input.point) point = { ...input.point }
      if (virtualPointer) {
        if (input.type === 'pointer_cancel') { cancel(); return { handled: true } }
        if (input.type !== 'pointer_move') return { handled: true }
        return { input: { ...input, pointerId: -1, pointerType: 'mouse', button: 0, buttons: 1, pressure: .5 } }
      }
      return { input }
    }
    if (!input.type.startsWith('key_')) return { input }
    // Release session-local continuation even if a form/composition, disabled
    // shortcut gate or pending commit will reject the key as an action.
    if (input.type === 'key_up') releaseKey?.(input.key)
    if (!onCanvas() || input.isComposing || input.keyCode === 229) { cancel(); return { handled: false } }
    // Legacy #122 (native focused canvas, 2026-11-26): disabling ordinary
    // shortcuts retains Space+Arrow panning and Escape cancellation (H24).
    const essential = matchesCanvasShortcut('escape', input) || matchesCanvasShortcut('space', input) || matchesCanvasShortcut('pan-key-gate', input) && read().temporaryTool === 'hand'
    if (!read().shortcutsEnabled && !essential) return { handled: false }
    if (matchesCanvasShortcut('comma', input) || virtualPointer && matchesCanvasShortcut('comma-release', input)) {
      // Legacy: comma down/move/up is one pointer gesture at the last screen
      // point. Repeated downs do not begin extra gestures. Release commits once.
      if (input.type === 'key_down') {
        if (virtualPointer || input.repeat || !point || isBusy() || read().mode !== 'idle') return { handled: true }
        virtualPointer = true
      } else {
        if (!virtualPointer) return { handled: true }
        virtualPointer = false
      }
      const result = dispatchPointer({ ...input, type: input.type === 'key_down' ? 'pointer_down' : 'pointer_up', point: { ...point }, pointerId: -1, pointerType: 'mouse', button: 0, buttons: virtualPointer ? 1 : 0, pressure: virtualPointer ? .5 : 0 })
      return { handled: true, result }
    }
    // This Escape belongs to the active virtual gesture. Consuming it avoids
    // treating the newly idle state as a second, idle "clear selection" action.
    if (input.type === 'key_down' && matchesCanvasShortcut('escape', input) && virtualPointer) { cancel(); return { handled: true } }
    return { input }
  }
  return { route, context, shortcuts, cancel }
}
