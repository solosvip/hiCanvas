import { createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'
import { createTextEditingFixture } from './text-editing-fixture.js'

// Public mount contract, separate from native editing input. Inject a failing
// host callback, then observe DOM/subscriptions without internal view access.
export async function textLifecycleProbe() {
  const counts = []
  for (const [id, kind, content] of [['shape:text', 'text', { type: 'doc', content: [{ type: 'paragraph' }] }], ['shape:frame', 'frame', 'Board']]) {
    const raw = createCanvasStore(), listeners = new Set()
    let reads = 0
    raw.loadStoreSnapshot(createTextEditingFixture().snapshot)
    const store = new Proxy(raw, { get(target, key) {
      const value = Reflect.get(target, key, target)
      if (key === 'get') return (...args) => { reads++; return value.apply(target, args) }
      if (['listen', 'addHistoryInterceptor'].includes(key)) return (...args) => {
        const token = {}, stop = value.apply(target, args); listeners.add(token)
        return () => { listeners.delete(token); stop() }
      }
      return typeof value === 'function' ? value.bind(target) : value
    } })
    const host = document.createElement('div'); host.tabIndex = 0; document.body.append(host)
    const renderer = mountCanvasRenderer(host, { store, textEditing: { onChange() {}, onInputContext(value) { if (value.owner === 'canvas') throw new Error('synthetic cleanup callback') } } })
    try {
      renderer.setTextEditing({ id, kind, content, epoch: 1 })
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      if (!host.querySelector('[data-canvas-text-editor]')?.contains(document.activeElement)) throw new Error('清理反例没有聚焦到文字编辑器。')
      let failed = false
      try { renderer.unmount() } catch (error) { if (error.message !== 'synthetic cleanup callback') throw error; failed = true }
      if (!failed || host.children.length || listeners.size) throw new Error(`文字清理异常后有残留：${kind}/${host.children.length}/${listeners.size}`)
      renderer.unmount()
      reads = 0
      raw.put([{ ...raw.get('shape:text'), x: 123 }])
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      if (reads) throw new Error(`文字清理异常后React仍响应Store：${kind}/${reads}`)
      counts.push({ kind, callbackFailed: true, remainingDom: host.children.length, remainingSubscriptions: listeners.size, readsAfterUnmount: reads })
    } finally { try { renderer.unmount() } finally { host.remove(); raw.dispose() } }
  }
  return counts
}
