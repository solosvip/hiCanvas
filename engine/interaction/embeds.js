import { EMBED_SERVICES, resolveEmbedUrl } from '../../model/index.js'
import { screenToCanvas } from '../../renderer/geometry.js'
import { planUrlInsertion, planUrlConversion } from '../embeds.js'
import { CanvasEditError } from '../errors.js'
import { matchesCanvasShortcut } from './shortcuts.js'
import { canvasOwnsFocus } from './keyboard-input.js'

// Dialog drafts are session state. Only submit crosses the command boundary;
// opening, choosing a provider, typing, back and cancellation never write Store.
export function createEmbedEditing({ session, pageId, index, targets, read, change, report, prepare, bookmarks }) {
  let basis = null, pending = null, disposed = false, interactionBasis = null, press = null
  const external = id => {
    const shape = session.store.get(id)
    return shape?.type === 'embed' && !shape.meta?.cowartHtmlDraft && !shape.meta?.cowartHtmlDraftAssetUrl && resolveEmbedUrl(shape.props.url) && targets.isSelectable(id)
  }
  function finish() { interactionBasis = null; if (read().interactingEmbedId) change({ interactingEmbedId: null }) }
  function interact(id, click = false) {
    const state = read(), runtime = session.state.get()
    if (disposed || pending || runtime.isSubmitting || (!click && runtime.isGestureActive) || state.toolId !== 'select' || !['idle', ...(click ? ['pointing'] : [])].includes(state.mode) || state.temporaryTool || state.clipboardBusy || state.textEditing || state.imageAltEditing || state.croppingId || state.embedEditing || state.inputContext.isComposing || state.inputContext.owner === 'text-editing' || !external(id) || targets.target(id, state.focusedGroupId) !== id) return false
    // Validate before releasing another owner. Preparation cancels only the
    // pointing gesture, not video playback or the frame's own document state.
    prepare()
    interactionBasis = new Set(targets.lineage(id).map(record => record.id))
    change({ interactingEmbedId: id, interactingVideoId: null, selectedIds: [id], mode: 'idle' })
    return true
  }
  function blocked() {
    const state = read(), runtime = session.state.get()
    return disposed || runtime.isSubmitting || runtime.isGestureActive || state.mode !== 'idle' || state.temporaryTool || state.clipboardBusy || state.textEditing || state.imageAltEditing || state.croppingId || state.bookmarkEditing || state.inputContext.isComposing || state.inputContext.owner === 'text-editing'
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
      if (!disposed && intent.to === 'bookmark') bookmarks?.auto(intent.id)
      return reply
    } catch (error) { if (!disposed) report(error); throw error }
    finally { pending = null }
  }
  const api = {
    cancel,
    finish,
    sync(next, patch) {
      const id = next.interactingEmbedId
      if (!id) return null
      return patch.interactingVideoId || next.toolId !== 'select' || next.selectedIds.length !== 1 || next.selectedIds[0] !== id || targets.target(id, next.focusedGroupId) !== id || !external(id) || next.textEditing || next.imageAltEditing || next.croppingId || next.embedEditing || next.inputContext.owner === 'text-editing' ? null : id
    },
    applyChanges(changes) {
      if (interactionBasis && [...Object.keys(changes.updated), ...Object.keys(changes.removed)].some(id => interactionBasis.has(id))) finish()
    },
    available() { return !blocked() && !read().embedEditing },
    action(value) {
      if (value.type === 'interact') return interact(value.id)
      if (value.type === 'finish-interaction') { finish(); return true }
      // Reports come from the current parent-owned iframe element. A stale
      // source or an already detached node cannot end a newer interaction.
      if (['frame-load', 'frame-error'].includes(value.type)) {
        if (read().interactingEmbedId === value.id && session.store.get(value.id)?.props.url === value.url) finish()
        return true
      }
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
      const state = read()
      if (state.interactingEmbedId) {
        if (input.type === 'pointer_down' && input.button === 0 && !state.temporaryTool) finish()
        if (input.type === 'key_down' && input.key === 'Escape' && canvasOwnsFocus(state.inputContext) && !state.inputContext.isComposing && !input.isComposing && input.keyCode !== 229) { finish(); return { handled: true } }
      }
      if (!read().embedEditing || input.type !== 'key_down' || input.isComposing || input.keyCode === 229 || read().inputContext.isComposing) return { handled: false }
      if (input.key === 'Escape') { if (!pending) cancel(); return { handled: true } }
      // The host's native form owns Enter: it may activate Back or Cancel,
      // rather than the submit button. Both clicks and implicit submission
      // reach action('submit') and the same revision/selection checks.
      return { handled: false }
    },
    handle(input) {
      const state = read()
      if (input.type === 'pointer_down') press = input.button === 0 ? { id: input.pointerId, point: input.point } : null
      if (input.type === 'pointer_cancel') press = null
      const released = input.type === 'pointer_up' ? press : null
      if (input.type === 'pointer_up') press = null
      // A coalesced final position can cross select's drag threshold without
      // a move event. Let select process that release as an ordinary drag.
      if (released && released.id === input.pointerId && Math.hypot(input.point.x - released.point.x, input.point.y - released.point.y) <= 4 && state.toolId === 'select' && state.mode === 'pointing' && input.type === 'pointer_up' && input.button === 0 && input.clickCount === 2 && !input.isComposing && input.keyCode !== 229) {
        const raw = index.hitsAtPoint(screenToCanvas(input.point, state.camera), 4 / state.camera.z, { geoInterior: true }).find(targets.isSelectable)
        const id = raw && targets.target(raw, targets.scopeFor(raw, state.focusedGroupId))
        if (interact(id, true)) return true
      }
      if (!matchesCanvasShortcut('embed-open', input) || blocked() || read().embedEditing) return false
      api.action({ type: 'open' }); return true
    },
    dispose() { finish(); cancel(); disposed = true },
  }
  return api
}
