import { executeCanvasCommands } from '../../engine/index.js'

// Used only by the original fixture/gallery preview. Persistent editing uses
// the same interaction/runtime through the isolated HTTP host below.
export function memoryTransport(snapshot) {
  let saved = snapshot, revision = 0
  const read = async () => ({ snapshot: saved, revision: String(revision) })
  return {
    read, subscribe: () => () => {},
    async commit({ expectedRevision, commands }) {
      if (expectedRevision !== String(revision)) throw Object.assign(new Error('合成画板版本已改变。'), { code: 'conflict' })
      const result = executeCanvasCommands(saved, commands)
      saved = result.snapshot; revision++
      return { ...result, revision: String(revision) }
    },

  }
}

export function previewTransport(conversationId) {
  const query = `?conversation=${encodeURIComponent(conversationId)}`
  async function request(path, method = 'GET', body, actor) {
    const response = await fetch(path + query, { method, headers: { 'x-hicanvas-client': '1', 'content-type': 'application/json', ...(actor && { 'x-hicanvas-actor': actor }) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const value = await response.json()
    if (!response.ok) throw Object.assign(new Error(value.error || '隔离服务请求失败。'), { code: response.status === 409 ? 'conflict' : 'transport' })
    return value
  }
  return {
    read: () => request('/api/canvas'),
    commit: ({ expectedRevision, commands, actor }) => request('/__interaction/commit', 'POST', { expectedRevision, commands }, actor),
    subscribe(listener) {
      const events = new EventSource('/api/canvas-events' + query)
      events.addEventListener('canvas-changed', event => { if (!JSON.parse(event.data).connected) listener() })
      return () => events.close()
    },
    async loadCamera() { return (await request('/api/view-state')).viewState?.camera },
    saveCamera: viewState => request('/api/view-state', 'PUT', viewState),
  }
}
