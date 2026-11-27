import { matchesCanvasShortcut } from './shortcuts.js'

const controls = new Set(['button', 'toolbar-button', 'menu-trigger', 'anchor'])
const owners = new Set(['canvas', 'text-editing', 'form', 'menu', 'select', ...controls])
export function checkedInputContext(value = { owner: 'canvas' }) {
  if (!value || !owners.has(value.owner)) throw new Error('输入上下文需要已登记的焦点类别。')
  return Object.freeze({ owner: value.owner, isComposing: Boolean(value.isComposing), expanded: value.owner === 'menu-trigger' && Boolean(value.expanded), ownsArrows: Boolean(value.ownsArrows) })
}

// Canvas actions may run while focus rests on a non-input control (#209); an
// open menu keeps them away. Composition is checked by each caller.
export function canvasOwnsFocus(context) {
  return Boolean(context) && !context.expanded && (context.owner === 'canvas' || controls.has(context.owner))
}

// Hosts report focus/composition; this module owns routing, including future
// #132 text editing. No host event or document record enters this state.
export function createKeyboardInput({ read, change, releaseKeys, releaseKey, cancelPointer, dispatchPointer, isBusy }) {
  let point = null, virtualPointer = false
  const onCanvas = () => {
    const c = read().inputContext
    return !c.isComposing && canvasOwnsFocus(c)
  }
  function cancel() {
    if (virtualPointer) { virtualPointer = false; cancelPointer() }
    releaseKeys()
  }
  function context(value) {
    const previous = read().inputContext, next = checkedInputContext(value)
    change({ inputContext: next })
    // Hosts report before every key. Re-reporting the same button must not
    // cancel a newly allowed held key or pointer gesture on that control.
    // Partial control ownership also preserves an active physical drag: focus
    // alone is not its Escape. Idle key nudges, temporary tools and the comma
    // pointer still release on a context transition, including a lost keyup.
    // Returning from a protected text session is its own continuation, not a
    // held canvas key: cancelling here would invalidate note Tab continuation.
    const changed = JSON.stringify(previous) !== JSON.stringify(next)
    const wasCanvas = !previous.isComposing && !previous.expanded && (previous.owner === 'canvas' || controls.has(previous.owner))
    if (!onCanvas() || wasCanvas && changed && (virtualPointer || read().temporaryTool || read().mode === 'idle')) cancel()
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
    const c = read().inputContext, arrow = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(input.key.toLowerCase())
    const escape = matchesCanvasShortcut('escape', input) || matchesCanvasShortcut('escape-folded', input)
    // Native activation and roving focus stay with non-input controls. Every
    // other binding continues through the existing shortcut table below.
    // Rejecting a reserved key must not cancel a real pointer's active preview.
    if (controls.has(c.owner) && (input.key.toLowerCase() === 'enter' || matchesCanvasShortcut('space', input) || arrow || escape && c.owner !== 'toolbar-button')) return { handled: false }
    // The window capture route leaves owned arrows to the control. Its own
    // subsequent, explicitly targeted minimap input is the one allowed route.
    if (input.type === 'key_down' && c.ownsArrows && arrow && input.target !== 'minimap') return { handled: false }
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
    const requestFocus = c.owner === 'toolbar-button' && input.type === 'key_down' && escape && !input.repeat ? 'canvas' : null
    if (input.type === 'key_down' && matchesCanvasShortcut('escape', input) && virtualPointer) { cancel(); return { handled: true, requestFocus } }
    return { input, requestFocus }
  }
  return { route, context, shortcuts, cancel }
}
