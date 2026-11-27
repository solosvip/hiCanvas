import { EMBED_SERVICES } from '../../model/index.js'
import { screenToCanvas } from '../../renderer/geometry.js'
import { planUrlInsertion, planUrlConversion } from '../embeds.js'
import { CanvasEditError } from '../errors.js'
import { matchesCanvasShortcut } from './shortcuts.js'

// Dialog drafts are session state. Only submit crosses the command boundary;
// opening, choosing a provider, typing, back and cancellation never write Store.
export function createEmbedEditing({ session, pageId, targets, read, change, report, prepare }) {
  let basis = null, pending = null, disposed = false
  function blocked() {
    const state = read(), runtime = session.state.get()
    return disposed || runtime.isSubmitting || runtime.isGestureActive || state.mode !== 'idle' || state.temporaryTool || state.clipboardBusy || state.textEditing || state.imageAltEditing || state.croppingId || state.inputContext.isComposing || state.inputContext.owner === 'text-editing'
  }
  function cancel() { basis = null; if (!disposed) change({ embedEditing: null }) }
  function draft(serviceId, url) {
    let valid = false
    try { planUrlInsertion(url, { source: 'dialog', serviceId }); valid = true } catch { /* A partial URL is a normal draft. */ }
    change({ embedEditing: Object.freeze({ serviceId, url, valid }) })
  }
  async function submit() {
    if (pending) return pending
    const value = read().embedEditing, expected = basis
    if (!value || !expected || blocked()) throw new CanvasEditError('请先结束当前操作并打开嵌入对话框。')
    if (session.state.get().revision !== expected.revision || JSON.stringify(read().selectedIds) !== expected.selection) throw new CanvasEditError('输入网址期间画板或选择已变化，请重新打开。', 'conflict')
    planUrlInsertion(value.url, { source: 'dialog', serviceId: value.serviceId })
    pending = session.commitCommands([{ type: 'insert_url', url: value.url, source: 'dialog', serviceId: value.serviceId, pageId, point: expected.point }], { expectedRevision: expected.revision })
    try {
      const reply = await pending
      if (!disposed && basis === expected) { cancel(); change({ selectedIds: [reply.results[0].shapeId], selectionRotation: null, lastError: null }) }
      return reply
    } catch (error) { if (!disposed) report(error); throw error }
    finally { pending = null }
  }
  function conversionIntent(to) {
    const state = read(), id = state.selectedIds[0]
    if (blocked() || state.embedEditing || state.selectedIds.length !== 1 || !targets.isSelectable(id)) return null
    try { planUrlConversion(session.store.get(id), to) } catch { return null }
    return Object.freeze({ type: 'convert', id, to, expectedRevision: session.state.get().revision, selection: JSON.stringify(state.selectedIds) })
  }
  async function convert(value) {
    if (pending || blocked() || read().embedEditing) throw new CanvasEditError('请先结束当前操作再转换。')
    if (value.expectedRevision !== session.state.get().revision || value.selection !== JSON.stringify(read().selectedIds) || read().selectedIds.length !== 1 || read().selectedIds[0] !== value.id) throw new CanvasEditError('画板或选择已变化，请重新选择转换对象。', 'conflict')
    const intent = conversionIntent(value.to)
    if (!intent) throw new CanvasEditError('当前对象不可转换。')
    prepare()
    pending = session.commitCommands([{ type: 'convert_url_shape', id: intent.id, to: intent.to }], { expectedRevision: intent.expectedRevision })
    try {
      const reply = await pending
      if (!disposed) change({ lastError: null })
      return reply
    } catch (error) { if (!disposed) report(error); throw error }
    finally { pending = null }
  }
  const api = {
    cancel,
    available() { return !blocked() && !read().embedEditing },
    action(value) {
      if (value.type === 'conversion-intent') return conversionIntent(value.to)
      if (value.type === 'convert') return convert(value)
      if (value.type === 'cancel') { if (!pending) cancel(); return true }
      if (value.type === 'submit') return submit()
      if (value.type === 'open') {
        if (pending || blocked() || read().embedEditing) throw new CanvasEditError('请先结束当前操作再创建嵌入。')
        prepare()
        const state = read()
        basis = { revision: session.state.get().revision, selection: JSON.stringify(state.selectedIds), point: screenToCanvas({ x: state.viewport.w / 2, y: state.viewport.h / 2 }, state.camera) }
        change({ lastError: null }); draft(null, ''); return true
      }
      if (!read().embedEditing || pending) return false
      if (value.type === 'back') { draft(null, ''); return true }
      if (value.type === 'service') {
        if (!EMBED_SERVICES.some(service => service.id === value.serviceId && service.available)) throw new CanvasEditError('此嵌入服务暂不可用。')
        draft(value.serviceId, ''); return true
      }
      if (value.type === 'update') {
        if (typeof value.url !== 'string' || value.url.length > 8192) throw new CanvasEditError('网址超过大小上限。')
        draft(read().embedEditing.serviceId, value.url); return true
      }
      throw new CanvasEditError('未知嵌入操作。')
    },
    beforeKeyboard(input) {
      if (!read().embedEditing || input.type !== 'key_down' || input.isComposing || input.keyCode === 229 || read().inputContext.isComposing) return { handled: false }
      if (input.key === 'Escape') { if (!pending) cancel(); return { handled: true } }
      // The host's native form owns Enter: it may activate Back or Cancel,
      // rather than the submit button. Both clicks and implicit submission
      // reach action('submit') and the same revision/selection checks.
      return { handled: false }
    },
    handle(input) {
      if (!matchesCanvasShortcut('embed-open', input) || blocked() || read().embedEditing) return false
      api.action({ type: 'open' }); return true
    },
    dispose() { cancel(); disposed = true },
  }
  return api
}
