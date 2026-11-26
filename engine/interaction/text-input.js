import { screenToCanvas } from '../../renderer/geometry.js'
import { frameTitleAtPoint } from './frame-title-hit.js'

// Shared frame input and completion policy. No native event, view or DOM is
// accepted here. The adapter supplies focus/composition through #122.
export function createTextInput(context, editing) {
  const { session, index, targets, read, change, replay, canCreate, prepare } = context
  let pending = null, disposed = false
  function beforeKeyboard(input) {
    if (pending && input.type.startsWith('pointer_')) {
      if (input.type === 'pointer_move' && pending.at(-1)?.type === 'pointer_move') pending[pending.length - 1] = input
      else pending.push(input)
      return { handled: true }
    }
    const state = read()
    if (!state.textEditing) return { handled: false }
    if (input.type === 'pointer_down' && input.button === 0) {
      pending = [input]
      const result = editing.finish().then(async saved => {
        const inputs = pending; pending = null
        if (saved && !disposed && !read().textEditing) for (const event of inputs) await replay(event)
        return saved
      }).finally(() => { pending = null })
      return { handled: true, result }
    }
    if (!input.type.startsWith('key_') || state.inputContext.owner !== 'text-editing') return { handled: false }
    if (state.inputContext.isComposing || input.isComposing || input.keyCode === 229) return { handled: false }
    // A second native/CDP observation (2026-11-26, explicit Meta/Ctrl and
    // Return char) did not finish the old editor. E21 requires Mod+Enter;
    // implement that inventory contract, pending real-user confirmation.
    const complete = input.key === 'Escape' || input.key === 'Enter' && (state.textEditing.kind === 'frame' || input.metaKey || input.ctrlKey)
    return complete ? { handled: true, result: input.type === 'key_down' && !input.repeat ? editing.finish() : true } : { handled: false }
  }
  function handle(input) {
    const state = read()
    if (state.textEditing || state.toolId !== 'select') return { handled: false }
    if (input.type === 'key_down' && input.key === 'Enter' && !input.repeat && !input.metaKey && !input.ctrlKey && !input.altKey && !input.shiftKey && state.selectedIds.length === 1 && editing.canBegin(state.selectedIds[0])) return { handled: true, result: editing.begin(state.selectedIds[0]) }
    if (input.type !== 'pointer_up' || input.button !== 0 || input.clickCount !== 2 || state.mode !== 'pointing') return { handled: false }
    const point = screenToCanvas(input.point, state.camera), raw = index.hitsAtPoint(point, 4 / state.camera.z, { geoInterior: true }).find(targets.isSelectable)
    const title = frameTitleAtPoint(context, point)
    const id = title || raw && targets.target(raw, targets.scopeFor(raw, state.focusedGroupId)), shape = index.getRecord(id)
    if (input.altKey && shape?.type === 'geo' && ['rectangle', 'check-box'].includes(shape.props.geo) && !shape.isLocked) {
      // A38 remained unconfirmed with Alt on key and pointer events, both
      // preselected/unselected boxes (2026-11-26). Follow inventory A38;
      // preserve identity and all other properties; user verification remains.
      prepare(); session.beginGesture()
      session.preview([{ type: 'update', id, changes: { props: { geo: shape.props.geo === 'rectangle' ? 'check-box' : 'rectangle' } } }])
      change({ selectedIds: [id], mode: 'idle' })
      return { handled: true, result: session.commitGesture() }
    }
    if (editing.canBegin(id) && (shape.type !== 'frame' || title)) return { handled: true, result: editing.begin(id) }
    if (!id && canCreate()) return { handled: true, result: editing.create(point) }
    return { handled: false }
  }
  return { beforeKeyboard, handle, dispose() { disposed = true; pending = null } }
}
