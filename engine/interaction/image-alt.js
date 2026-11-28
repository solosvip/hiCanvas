import { captureRecordBasis, assertRecordBasis } from '../record-basis.js'
import { getRecordDependencies } from '../record-dependencies.js'
import { editableImage } from '../commands/crop-image.js'

// Native toolbar input (#137, isolated CDP, 2026-11-26): Enter/outside save;
// Escape preserves the original text. Drafts stay outside Store and history.
export function createImageAlt({ session, read, change, prepare }) {
  let basis = null, disposed = false, pending = null
  const cancel = () => { basis = null; if (!disposed && read().imageAltEditing) change({ imageAltEditing: null }) }
  function start(id = read().selectedIds.length === 1 && read().selectedIds[0]) {
    if (session.state.get().isSubmitting || session.state.get().isGestureActive || read().toolId !== 'select' || read().selectedIds.length !== 1 || read().selectedIds[0] !== id) throw new Error('请先结束当前操作并选择一张未锁定图片。')
    const shape = editableImage(session.store, id)
    prepare()
    const snapshot = session.store.getStoreSnapshot()
    basis = captureRecordBasis(snapshot, getRecordDependencies(snapshot, [{ type: 'set_image_alt_text', id }]))
    change({ imageAltEditing: Object.freeze({ id, text: shape.props.altText || '' }) })
    return true
  }
  async function finish() {
    if (pending) return pending
    const draft = read().imageAltEditing, expected = basis
    if (!draft || disposed) return false
    const shape = editableImage(session.store, draft.id)
    if (session.state.get().isSubmitting || session.state.get().isGestureActive) throw new Error('编辑描述期间画板已变化，请重试。')
    const commands = [{ type: 'set_image_alt_text', id: draft.id, altText: draft.text }], snapshot = session.store.getStoreSnapshot()
    assertRecordBasis(snapshot, expected, getRecordDependencies(snapshot, commands))
    if (draft.text === (shape.props.altText || '')) { cancel(); return false }
    pending = session.commitCommands(commands, { recordBasis: expected })
    try {
      const result = await pending
      if (!disposed && basis === expected && read().imageAltEditing?.id === draft.id) cancel()
      return result
    } finally { pending = null }
  }
  return {
    cancel,
    action(value) {
      if (value.type === 'start') return start(value.id)
      if (value.type === 'finish') return finish()
      if (value.type === 'cancel') { cancel(); return true }
      if (value.type !== 'update') throw new Error('未知图片描述操作。')
      if (!read().imageAltEditing) return false
      if (typeof value.text !== 'string' || value.text.length > 10000) throw new Error('替代文字不能超过 10000 字。')
      change({ imageAltEditing: Object.freeze({ ...read().imageAltEditing, text: value.text }) }); return true
    },
    beforeKeyboard(input) {
      if (!read().imageAltEditing) return { handled: false }
      if (pending) return { handled: input.type === 'pointer_down' || input.type === 'key_down' && ['Enter', 'Escape'].includes(input.key) }
      if (input.type === 'key_down' && !input.isComposing && input.keyCode !== 229) {
        if (input.key === 'Escape') { cancel(); return { handled: true } }
        if (input.key === 'Enter') return { handled: true, result: finish() }
      }
      if (input.type === 'pointer_down') return { handled: true, result: finish() }
      return { handled: false }
    },
    dispose() { cancel(); disposed = true },
  }
}
