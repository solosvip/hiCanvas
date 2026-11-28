import { canvasOwnsFocus } from './keyboard-input.js'

// Shared read-only lifetime. Each action owns its controller; neither action
// can cancel another output, change selection, or open a document transaction.
export function createSnapshotOutput({ session, interaction }) {
  let disposed = false, active = null, lastError = null
  function unavailable(origin) {
    if (disposed) return 'disposed'
    if (active) return 'exporting'
    const state = interaction.state.get(), runtime = session.state.get()
    if (runtime.isSubmitting) return 'submitting'
    if (state.croppingId) return 'cropping'
    if (state.textEditing || state.inputContext?.owner === 'text-editing') return 'text-editing'
    if (runtime.isGestureActive || state.mode !== 'idle') return 'pointer-gesture'
    if (state.inputContext?.isComposing) return 'composing'
    if (state.inputContext?.owner && !canvasOwnsFocus(state.inputContext) && !(origin === 'toolbar' && state.inputContext.owner === 'form')) return 'input-owner'
    return null
  }
  function cancel() { active?.abort(new Error('输出已取消。')) }
  async function run({ origin = 'canvas', signal }, produce) {
    if (!['canvas', 'toolbar'].includes(origin)) throw new Error('输出动作来源无效。')
    const reason = unavailable(origin)
    if (reason) return { status: 'unavailable', reason }
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    active = controller; lastError = null
    const check = () => { controller.signal.throwIfAborted(); if (disposed) throw new Error('输出会话已关闭。') }
    try {
      check()
      const selected = [...interaction.state.get().selectedIds]
      const snapshot = structuredClone(session.store.getStoreSnapshot('document'))
      return await produce({ snapshot, selected, signal: controller.signal, check })
    } catch (error) {
      lastError = Object.freeze({ message: error.message, blockedResources: error.blockedResources || 0, failedResources: error.failedResources || 0 })
      if (controller.signal.aborted) return { status: 'cancelled', ...lastError }
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
      if (active === controller) active = null
    }
  }
  return { run, cancel, read: () => Object.freeze({ busy: !!active, lastError }),
    assertActive() { if (disposed) throw new Error('输出会话已关闭。') },
    dispose() { if (!disposed) { disposed = true; cancel() } },
  }
}
