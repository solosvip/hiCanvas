import { matchesCanvasShortcut } from './shortcuts.js'

// Ordinary canvas keys. The host/core input-context gate (#122) runs before
// this delegate; no DOM, composition or form policy belongs in selection rules.
export function createSelectionShortcuts({ session, index, read, select }) {
  const pending = new Set()
  function cancel() { pending.clear() }
  function handle(input) {
    if (!['key_down', 'key_up'].includes(input.type)) return false
    const key = input.key.toLowerCase(), down = input.type === 'key_down'
    if (matchesCanvasShortcut('escape-folded', input)) {
      cancel()
      // H24 keeps active-gesture Escape cancellation when shortcuts are off;
      // idle selection clearing is an ordinary action, so leave it disabled.
      if (!down || session.state.get().isGestureActive || read().mode !== 'idle' || read().shortcutsEnabled === false) return false
      if (!input.repeat) select('clear')
      return true
    }
    if (session.state.get().isGestureActive || read().mode !== 'idle') return false
    if (matchesCanvasShortcut('selection-cycle', input)) {
      if (!read().selectedIds.length) return false
      if (down) {
        pending.add(key)
        if (input.repeat) select(input.shiftKey ? 'previous' : 'next')
      } else if (pending.delete(key)) select(input.shiftKey ? 'previous' : 'next')
      else return false
      return true
    }
    if (matchesCanvasShortcut('selection-enter', input)) {
      if (down) { if (read().selectedIds.length !== 1 || index.getRecord(read().selectedIds[0])?.type !== 'group') return false; pending.add(key); return true }
      return pending.delete(key) ? select('enter') : false
    }
    if (matchesCanvasShortcut('selection-all', input)) { select('all'); return true }
    const direction = { arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down' }[key]
    if (!['selection-neighbor', 'selection-parent', 'selection-child'].some(id => matchesCanvasShortcut(id, input))) return false
    select(input.shiftKey ? direction === 'up' ? 'parent' : 'child' : direction)
    return true
  }
  return { handle, cancel }
}
