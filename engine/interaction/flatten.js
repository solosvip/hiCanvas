import { CanvasEditError } from '../errors.js'
import { flattenPlan, validateFlattenImage } from '../flatten-plan.js'
import { createSnapshotOutput } from './snapshot-output.js'
import { canvasOwnsFocus } from './keyboard-input.js'
import { matchesCanvasShortcut } from './shortcuts.js'

const changed = () => { throw new CanvasEditError('扁平化期间画板、目标、工具或选区已变化，请重新操作。', 'conflict') }
const validBox = bounds => bounds && ['x', 'y', 'w', 'h'].every(key => Number.isSafeInteger(bounds[key])) && bounds.w > 0 && bounds.h > 0

// Kept in one seam for #231: every asynchronous stage uses the SAME fixed
// revision and target/selection basis. Never replay against a newer document.
function checkFlattenBasis({ session, read }, token) {
  token.controller.signal.throwIfAborted()
  const state = read(), runtime = session.state.get()
  if (runtime.revision !== token.revision || runtime.isGestureActive || runtime.isSubmitting || state.mode !== 'idle' || state.textEditing || state.croppingId || state.inputContext.isComposing || state.toolId !== token.tool || JSON.stringify(state.selectedIds) !== token.selected || JSON.stringify(session.store.getStoreSnapshot('document').store) !== token.document || !canvasOwnsFocus(state.inputContext) && !(token.origin === 'toolbar' && state.inputContext.owner === 'form')) changed()
}

export function createFlatten(context, port) {
  const { session, read, change, report } = context
  const output = createSnapshotOutput({ session, interaction: { state: { get: read } } })
  const cleanupMessage = '本次临时文件未完全清理，请稍后重试。'
  let active = null, disposed = false
  const phase = value => change({ flattenStatus: Object.freeze({ phase: value }) })
  function cancel() {
    if (!active || active.committing) return false
    active.controller.abort(new Error('扁平化已取消。')); return true
  }
  function get() {
    if (disposed || !port) return Object.freeze({ status: 'unavailable', reason: disposed ? 'disposed' : 'unsupported' })
    if (active) return Object.freeze({ status: 'unavailable', reason: 'busy', phase: active.committing ? 'committing' : 'preparing' })
    try { const plan = flattenPlan(session.store.getStoreSnapshot('document'), read().selectedIds, { render: false }); return Object.freeze({ status: plan.status, ...(plan.reason && { reason: plan.reason }) }) }
    catch (error) { return Object.freeze({ status: 'unavailable', reason: error.code, message: error.message }) }
  }
  async function start({ origin = 'canvas', signal } = {}) {
    const available = get()
    if (available.status !== 'ready') return available
    const token = { controller: new AbortController(), committing: false, origin, tool: read().toolId, selected: JSON.stringify(read().selectedIds), revision: session.state.get().revision }
    const abort = () => { if (!token.committing) token.controller.abort(signal.reason) }
    const timeout = AbortSignal.timeout(60000), expire = () => { if (!token.committing) token.controller.abort(new Error('扁平化准备超时，已取消。')) }
    timeout.addEventListener('abort', expire, { once: true })
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort()
    active = token
    try {
      const result = await output.run({ origin, signal: token.controller.signal }, async ({ snapshot, selected, signal: renderSignal, check }) => {
        token.document = JSON.stringify(snapshot.store)
        const plan = flattenPlan(snapshot, selected), format = port.format, scale = format === 'svg' ? 1 : format === 'png' ? 2 : 0
        if (!scale) throw new Error('扁平化格式未配置。')
        const options = { scope: 'selection', ids: plan.ids, format, scale, padding: 0, background: null, signal: renderSignal }
        const preflight = port.preflight(plan.renderSnapshot, options)
        if (preflight.status === 'empty') return preflight
        if (!validBox(preflight.bounds)) throw new Error('扁平化输出范围回执无效。')
        let attempt, complete = false
        try {
          phase('rendering')
          const result = await port.render(plan.renderSnapshot, options)
          check(); checkFlattenBasis(context, token)
          if (result.status !== 'complete' || result.mime !== (format === 'svg' ? 'image/svg+xml' : 'image/png') || !(result.bytes instanceof Uint8Array) || !result.bytes.length || result.width !== preflight.bounds.w * scale || result.height !== preflight.bounds.h * scale || JSON.stringify(result.bounds) !== JSON.stringify(preflight.bounds)) throw new Error('扁平化渲染回执无效。')
          phase('uploading'); attempt = port.begin({ signal: renderSignal })
          const image = await attempt.upload(result)
          check(); checkFlattenBasis(context, token)
          validateFlattenImage(image, result.bounds)
          if (image.mimeType !== result.mime || image.w !== result.width || image.h !== result.height) throw new Error('扁平化上传回执无效。')
          const id = `shape:${globalThis.crypto.randomUUID()}`, assetId = `asset:${globalThis.crypto.randomUUID()}`
          // Cancellation stops at this boundary. Runtime commits once and
          // refreshes an uncertain reply; it never retries this transaction.
          check(); checkFlattenBasis(context, token); token.committing = true; phase('committing')
          try { await session.commitCommands([{ type: 'flatten_shapes', ids: plan.ids, bounds: result.bounds, image, id, assetId }], { expectedRevision: token.revision }) }
          catch (error) { throw new CanvasEditError(error.code === 'conflict' ? '画板版本已变化，未重发扁平化，请重新操作。' : `扁平化提交结果不确定，已刷新核对，未重发：${error.message}`, error.code || 'flatten-uncertain') }
          complete = true
          if (!disposed) change({ selectedIds: [id], lastError: null })
          return { status: 'complete', shapeId: id, assetId, warnings: [...(result.warnings || []), ...(image.warnings || [])] }
        } finally {
          // Even a lost save receipt can be cleaned safely: the shared save
          // path protects files referenced by the document and undo history.
          if (attempt && !complete) {
            try { if ((await attempt.abort())?.remaining) throw new Error('remaining') }
            catch { token.cleanupFailed = true }
          }
        }
      })
      if (token.cleanupFailed) {
        const message = `${result.message || '扁平化已取消'}；${cleanupMessage}`
        if (!disposed) change({ lastNotice: { message } })
        return { ...result, message }
      }
      return result
    } catch (error) {
      const failure = token.cleanupFailed ? new CanvasEditError(`${error.message}；${cleanupMessage}`, error.code || 'flatten-cleanup') : error
      if (!disposed) report(failure); throw failure
    }
    finally { signal?.removeEventListener('abort', abort); timeout.removeEventListener('abort', expire); if (active === token) active = null; if (disposed) output.dispose(); else phase('idle') }
  }
  return {
    get, cancel,
    action(action = {}) { if (action.type === 'cancel') return cancel(); if (action.type !== 'start') throw new Error('未知扁平化动作。'); return start(action) },
    sync(state) {
      if (!active || active.committing) return
      if (state.toolId !== active.tool) cancel()
      // A refresh may filter a newly locked/deleted target out of selection.
      // Keep that as a basis conflict, rather than mislabel it user cancellation.
      else if (JSON.stringify(state.selectedIds) !== active.selected && (!active.document || JSON.stringify(session.store.getStoreSnapshot('document').store) === active.document)) cancel()
    },
    handle(input) {
      if (matchesCanvasShortcut('escape', input) && cancel()) return { handled: true, result: true }
      if (read().shortcutsEnabled && matchesCanvasShortcut('flatten', input)) return { handled: true, result: start() }
      return { handled: false }
    },
    dispose() { disposed = true; if (!active?.committing) { cancel(); output.dispose() } },
  }
}
