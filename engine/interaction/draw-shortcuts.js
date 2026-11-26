import { findCanvasShortcut } from './shortcuts.js'

// The common input-context gate runs first; product toolIds govern availability.
export function createDrawShortcuts({ toolIds, setTool }) {
  return { handle(input) {
    const binding = findCanvasShortcut('draw', input)
    if (!binding || !toolIds.includes(binding.tool)) return false
    setTool(binding.tool); return true
  } }
}
