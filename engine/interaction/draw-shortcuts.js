// The common input-context gate runs first; product toolIds govern availability.
export function createDrawShortcuts({ toolIds, setTool }) {
  return { handle(input) {
    if (input.type !== 'key_down' || input.repeat || input.metaKey || input.ctrlKey || input.altKey) return false
    const key = input.key.toLowerCase()
    if (!['d', 'b', 'x'].includes(key)) return false
    const id = key === 'd' && input.shiftKey ? 'highlight' : 'draw'
    if (!toolIds.includes(id)) return false
    setTool(id); return true
  } }
}
