import { screenToCanvas } from '../../renderer/geometry.js'
import { adjacentNote, noteGeometry, noteIsRtl } from './note-geometry.js'
import { canvasOwnsFocus } from './keyboard-input.js'

export function createNoteEditing(context, editing) {
  const { index, targets, read, change, session } = context
  let pressed = null, continuing = false, disposed = false, generation = 0
  function describe(state) {
    if (state.toolId !== 'select' || state.temporaryTool || !canvasOwnsFocus(state.inputContext) || state.inputContext.isComposing || state.textEditing || state.croppingId || state.selectedIds.length !== 1 || !['idle', 'pointing'].includes(state.mode)) return null
    const shape = index.getRecord(state.selectedIds[0])
    if (shape?.type !== 'note') return null
    return { kind: 'note', id: shape.id, bounds: { x: 0, y: 0, w: 0, h: 0 }, handles: noteGeometry(index, shape).handles.filter(handle => index.isPointVisible(shape.id, handle)) }
  }
  function hit(input) {
    const overlay = describe(read())
    if (!overlay || !input.point) return null
    const point = screenToCanvas(input.point, read().camera), radius = context.handleMetrics.cornerHit / read().camera.z
    const handle = overlay.handles.find(h => Math.hypot(h.x - point.x, h.y - point.y) <= radius)
    return handle && { id: overlay.id, direction: handle.id }
  }
  async function continueEditing(direction) {
    if (continuing || session.state.get().isSubmitting) return false
    const source = index.getRecord(read().textEditing?.id)
    if (source?.type !== 'note' || !targets.isSelectable(source.id)) return false
    const id = `shape:${globalThis.crypto.randomUUID()}`
    let adjacent
    const intent = generation
    continuing = true
    try {
      // Source-only position/parent refreshes are valid text merges. Rebuild
      // the neighbour plan after each bounded replay, never reuse stale poses.
      const result = await editing.finish(() => {
        const latest = index.getRecord(source.id)
        if (!latest || !targets.isSelectable(latest.id)) throw new Error('续建源便签已不可编辑。')
        adjacent = adjacentNote(context, latest, direction, id)
        return adjacent.commands
      })
      if (result && !disposed && generation === intent && !read().textEditing && read().inputContext.owner === 'canvas' && editing.canBegin(adjacent.id)) editing.begin(adjacent.id)
      return result
    } finally { continuing = false }
  }
  function beforeKeyboard(input) {
    const state = read()
    if (!state.textEditing || state.textEditing.kind !== 'note' || state.inputContext.owner !== 'text-editing' || state.inputContext.isComposing || input.isComposing || input.keyCode === 229 || input.altKey) return { handled: false }
    const horizontal = input.key === 'Tab' && !input.metaKey && !input.ctrlKey
    const vertical = input.key === 'Enter' && (input.metaKey || input.ctrlKey)
    if (!horizontal && !vertical) return { handled: false }
    const reverse = horizontal ? Boolean(input.shiftKey) !== Boolean(noteIsRtl(state.textEditing.content)) : input.shiftKey
    const direction = horizontal ? reverse ? 'left' : 'right' : reverse ? 'top' : 'bottom'
    return { handled: true, result: input.type === 'key_down' && !input.repeat ? continueEditing(direction) : true }
  }
  function handle(input) {
    if (input.type === 'pointer_down' && input.button === 0) {
      const target = hit(input)
      if (!target) return { handled: false }
      pressed = { ...target, pointerId: input.pointerId, point: input.point, expected: JSON.stringify(index.getRecord(target.id)) }
      return { handled: true }
    }
    if (!pressed) return { handled: false }
    if (input.type === 'pointer_cancel' || input.type === 'key_down' && input.key === 'Escape') { pressed = null; change({ mode: 'idle' }); return { handled: true } }
    if (input.pointerId !== pressed.pointerId) return { handled: false }
    if (input.type === 'pointer_up') {
      const previous = pressed; pressed = null
      if (JSON.stringify(index.getRecord(previous.id)) !== previous.expected || Math.hypot(input.point.x - previous.point.x, input.point.y - previous.point.y) > 4) return { handled: true }
      const adjacent = adjacentNote(context, index.getRecord(previous.id), previous.direction)
      if (!adjacent.commands.length) return { handled: true, result: editing.begin(adjacent.id) }
      session.beginGesture(); session.preview(adjacent.commands); editing.adopt(adjacent.id)
      return { handled: true }
    }
    return { handled: input.type === 'pointer_move' }
  }
  return { describe, beforeKeyboard, handle, candidate: input => pressed || input.type === 'pointer_down' && hit(input), cancel() { generation++; pressed = null }, dispose() { disposed = true; generation++; pressed = null } }
}
