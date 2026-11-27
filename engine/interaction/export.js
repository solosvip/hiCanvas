import { canvasOwnsFocus } from './keyboard-input.js'

// Read-only output owns no document transaction. Browser and desktop adapters
// receive a complete result only after the fixed snapshot has finished rendering.
export function createCanvasExport({ session, interaction, render, download, background }) {
  if (!session?.store || !interaction?.state || typeof render !== 'function' || typeof download !== 'function' || typeof background !== 'string' || !background.trim()) throw new Error('画布输出需要会话、交互、渲染、下载与背景颜色。')
  let disposed = false, active = null, withBackground = true, lastError = null
  const read = () => Object.freeze({ busy: !!active, background: withBackground, lastError })
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
  async function run({ format = 'png', scope = 'selection', origin = 'canvas', signal, ...options } = {}) {
    if (!['svg', 'png'].includes(format) || !['selection', 'all'].includes(scope) || !['canvas', 'toolbar'].includes(origin)) throw new Error('输出格式、范围或动作来源无效。')
    const reason = unavailable(origin)
    if (reason) return { status: 'unavailable', reason }
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    active = controller; lastError = null
    try {
      controller.signal.throwIfAborted()
      const selected = [...interaction.state.get().selectedIds]
      const snapshot = structuredClone(session.store.getStoreSnapshot('document'))
      const result = await render(snapshot, { ...options, format, ids: scope === 'selection' && selected.length ? selected : undefined, background: withBackground ? background : null, signal: controller.signal })
      controller.signal.throwIfAborted()
      if (disposed) throw new Error('输出会话已关闭。')
      if (result.status === 'empty') return result
      if (result.status !== 'complete' || !(result.bytes instanceof Uint8Array) || !result.bytes.length) throw new Error('输出结果不完整。')
      await download(result, { filename: `hiCanvas.${format}`, signal: controller.signal })
      return result
    } catch (error) {
      lastError = Object.freeze({ message: error.message, blockedResources: error.blockedResources || 0, failedResources: error.failedResources || 0 })
      if (controller.signal.aborted) return { status: 'cancelled', ...lastError }
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
      if (active === controller) active = null
    }
  }
  return Object.freeze({ state: Object.freeze({ get: read }), run, cancel,
    setBackground(value) { if (disposed) throw new Error('输出会话已关闭。'); if (typeof value !== 'boolean') throw new Error('背景开关需要布尔值。'); withBackground = value },
    dispose() { if (!disposed) { disposed = true; cancel() } },
  })
}
