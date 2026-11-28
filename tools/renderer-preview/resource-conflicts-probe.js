// Test gates wrap real adapters. They never edit a Store, snapshot or reply.
// Installed only for the explicit persistent, synthetic image-import gallery.
export function installResourceConflictsProbe({ params, metadata, transport, clipboardAdapter }) {
  if (params.get('resourceConflicts') !== '1') return () => {}
  if (!metadata.persistent || !metadata.imageImportFixture && !metadata.videoFixture) throw new Error('资源冲突探针仅接受持久化合成媒体夹具。')
  let armed = null, waiting = null
  const calls = [], restore = []
  const api = Object.freeze({
    arm(stage, fail = false) {
      if (armed || waiting || !['copy', 'read', 'write', 'commit', 'upload'].includes(stage)) throw new Error('探针阶段无效或尚未释放。')
      armed = { stage, fail }
    },
    release() { const pending = waiting; waiting = null; pending?.resolve() },
    inspect: () => ({ armed: armed?.stage || null, waiting: waiting?.stage || null, calls: structuredClone(calls) }),
  })
  async function pause(stage) {
    calls.push(stage)
    if (armed?.stage !== stage) return
    const { fail } = armed; armed = null
    await new Promise(resolve => { waiting = { stage, resolve } })
    if (fail && stage !== 'commit') throw new Error('synthetic private clipboard denied')
    return fail
  }
  for (const [object, name, stage] of [[clipboardAdapter.port, 'copyContent', 'copy'], [clipboardAdapter.port, 'read', 'read'], [clipboardAdapter.port, 'write', 'write'], [transport, 'commit', 'commit']]) {
    const original = object[name]
    object[name] = async (...args) => {
      const loseReceipt = await pause(stage), result = await original.apply(object, args)
      // The real HTTP save completes; only its caller loses the receipt.
      if (loseReceipt) throw new Error('synthetic commit receipt lost')
      return result
    }
    restore.push(() => { object[name] = original })
  }
  const fetch = window.fetch
  window.fetch = async (url, options) => {
    if (String(url).startsWith('/api/canvas/reference?') && options?.method === 'POST') {
      const args = JSON.parse(options.body)
      if (args.purpose === 'file-import-begin') await pause('upload')
    }
    return fetch.call(window, url, options)
  }
  restore.push(() => { window.fetch = fetch })
  Object.defineProperty(window, '__HICANVAS_RESOURCE_CONFLICTS_PROBE__', { value: api })
  return () => { armed = null; api.release(); for (const reset of restore.reverse()) reset() }
}
