import { normalizeHttpUrl } from '../../model/index.js'
import { bookmarkTarget } from '../bookmarks.js'
import { CanvasEditError } from '../errors.js'
import { canvasOwnsFocus } from './keyboard-input.js'
import { createBookmarkJobs } from './bookmark-jobs.js'

// Selection controls only the entry point. Once preparation starts its explicit
// target survives selection, camera and unrelated document changes.
export function createBookmarkEditing(context, port) {
  const { session, pageId, read, change, prepare } = context
  let disposed = false, basis = null
  const draft = () => read().bookmarkEditing
  function event(job, status, data) {
    if (disposed || job.kind !== 'url' || draft()?.id !== job.id) return
    if (status === 'applied' || status === 'unchanged' || status === 'cancelled' || status === 'failed' && data.stage === 'commit') { basis = null; change({ bookmarkEditing: null }) }
    else change({ bookmarkEditing: Object.freeze({ ...draft(), phase: status, ...(status === 'failed' ? { errorCode: data.code, error: data.message } : { errorCode: null, error: null }) }) })
  }
  const jobs = createBookmarkJobs({ ...context, port, onEvent: event })
  function chosen(id) {
    if (!port || disposed) return null
    const state = read(), targetId = id || (state.selectedIds.length === 1 ? state.selectedIds[0] : null)
    try { return bookmarkTarget(session.store, targetId, pageId) } catch { return null }
  }
  function available() {
    const state = read(), runtime = session.state.get()
    return !runtime.isSubmitting && !runtime.isGestureActive && state.mode === 'idle' && !state.temporaryTool && !state.clipboardBusy && !state.textEditing && !state.imageAltEditing && !state.embedEditing && !state.croppingId && !state.inputContext.isComposing && !!chosen()
  }
  function close() {
    const value = draft()
    if (value?.phase === 'submitting') return false
    if (value) jobs.cancel(value.id)
    basis = null; change({ bookmarkEditing: null }); return true
  }
  const api = {
    available,
    auto(id) { if (chosen(id)) void jobs.start({ id, kind: 'auto' }).catch(() => {}) },
    pulse: jobs.pulse,
    applyChanges() {
      jobs.applyChanges()
      if (basis && draft()?.phase !== 'submitting') {
        try { if (JSON.stringify(bookmarkTarget(session.store, draft().id, pageId).records) === basis) return } catch { /* Target disappeared. */ }
        close()
      }
    },
    action(value) {
      if (value.type === 'cancel') return value.id ? jobs.cancel(value.id) : close()
      if (value.type === 'refresh') {
        const target = chosen(value.id)
        if (!target || draft()?.id === target.shape.id) return Promise.resolve({ status: 'unavailable' })
        return jobs.start({ id: target.shape.id })
      }
      if (value.type === 'open') {
        if (!available() || draft()) throw new CanvasEditError('请先结束当前操作并选择一个书签。')
        const target = chosen(); jobs.cancel(target.shape.id); prepare()
        basis = JSON.stringify(target.records)
        change({ bookmarkEditing: Object.freeze({ id: target.shape.id, url: target.shape.props.url, valid: true, phase: 'editing', error: null, errorCode: null }), interactingEmbedId: null, interactingVideoId: null })
        return true
      }
      const current = draft()
      if (!current || current.phase === 'submitting') return false
      if (value.type === 'update') {
        if (typeof value.url !== 'string' || new TextEncoder().encode(value.url).length > 8192) throw new CanvasEditError('网址超过大小上限。')
        jobs.cancel(current.id)
        // Cancellation may clear the old draft; this update creates a new one.
        const target = chosen(current.id)
        if (!target) return false
        basis = JSON.stringify(target.records)
        change({ bookmarkEditing: Object.freeze({ ...current, url: value.url, valid: !!normalizeHttpUrl(value.url), phase: 'editing', error: null, errorCode: null }) })
        return true
      }
      if (['submit', 'save-url-only'].includes(value.type)) {
        if (!current.valid || session.state.get().isGestureActive || session.state.get().isSubmitting || read().inputContext.isComposing) throw new CanvasEditError('请先结束当前操作并填写有效网址。')
        if (value.type === 'save-url-only' && current.phase !== 'failed') throw new CanvasEditError('请在读取失败后明确选择仅保存网址。')
        const target = chosen(current.id), url = normalizeHttpUrl(current.url)
        if (!target || JSON.stringify(target.records) !== basis) { close(); throw new CanvasEditError('书签已变化。', 'conflict') }
        if (url === target.shape.props.url) { close(); return Promise.resolve({ status: 'unchanged' }) }
        if (['fetching', 'ready'].includes(current.phase)) return false
        return jobs.start({ id: current.id, kind: 'url', url, ...(value.type === 'save-url-only' && { metadata: null }) })
      }
      throw new CanvasEditError('未知书签操作。')
    },
    beforeKeyboard(input) {
      const state = read()
      if (!draft() || input.type !== 'key_down' || input.key !== 'Escape' || input.isComposing || input.keyCode === 229 || state.inputContext.isComposing || !canvasOwnsFocus(state.inputContext)) return { handled: false }
      close(); return { handled: true }
    },
    dispose() { if (!disposed) { jobs.dispose(); basis = null; change({ bookmarkEditing: null, bookmarkJobs: Object.freeze([]) }); disposed = true } },
  }
  return api
}
