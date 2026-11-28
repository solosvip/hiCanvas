import { executeCanvasCommands, assertRecordBasis, getRecordDependencies, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction } from '../../engine/index.js'

const editorReasonCodes = new Set(['slides-layout-locked'])

// Used only by the original fixture/gallery preview. Persistent editing uses
// the same interaction/runtime through the isolated HTTP host below.
export function memoryTransport(snapshot) {
  let saved = snapshot, revision = 0, history, commitCalls = 0
  const read = async () => ({ snapshot: saved, revision: String(revision) })
  const accept = result => { saved = result.snapshot; revision++; return { ...result, revision: String(revision) } }
  const check = expected => { if (expected !== String(revision)) throw Object.assign(new Error('合成画板版本已改变。'), { code: 'conflict' }) }
  const moveHistory = (move, { expectedRevision, actor }) => {
    check(expectedRevision)
    const result = move(saved, history, actor)
    history = result.history
    return accept(result)
  }
  return {
    read, subscribe: () => () => {}, getCommitCount: () => commitCalls,
    async commit({ expectedRevision, commands, actor, recordBasis }) {
      commitCalls++
      if (typeof expectedRevision !== 'string' || !expectedRevision) throw new Error('写入需要版本。')
      if (recordBasis === undefined) check(expectedRevision)
      else assertRecordBasis(saved, recordBasis, getRecordDependencies(saved, commands))
      const result = executeCanvasCommands(saved, commands)
      history = recordCanvasTransaction(history, actor, result.changes)
      return accept(result)
    },
    undo: request => moveHistory(undoCanvasTransaction, request),
    redo: request => moveHistory(redoCanvasTransaction, request),
  }
}

export function previewTransport(conversationId) {
  const query = `?conversation=${encodeURIComponent(conversationId)}`
  async function request(path, method = 'GET', body, actor) {
    const response = await fetch(path + query, { method, headers: { 'x-hicanvas-client': '1', 'content-type': 'application/json', ...(actor && { 'x-hicanvas-actor': actor }) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const value = await response.json()
    if (!response.ok) throw Object.assign(new Error(value.error || '隔离服务请求失败。'), { code: editorReasonCodes.has(value.code) ? value.code : response.status === 409 ? 'conflict' : 'transport' })
    return value
  }
  return {
    read: () => request('/api/canvas'),
    undo: ({ expectedRevision, actor }) => request('/api/canvas/undo', 'POST', { expectedRevision }, actor),
    redo: ({ expectedRevision, actor }) => request('/api/canvas/redo', 'POST', { expectedRevision }, actor),
    commit: ({ expectedRevision, commands, actor, recordBasis }) => request(commands.some(command => command.type === 'paste_content') ? '/api/canvas/clipboard/paste' : '/__interaction/commit', 'POST', { expectedRevision, commands, recordBasis }, actor),
    copyContent: ({ ids, expectedRevision, recordBasis }) => request('/api/canvas/clipboard/copy', 'POST', { ids, expectedRevision, recordBasis }),
    subscribe(listener) {
      const events = new EventSource('/api/canvas-events' + query)
      events.addEventListener('canvas-changed', event => { if (!JSON.parse(event.data).connected) listener() })
      return () => events.close()
    },
    async loadCamera() { return (await request('/api/view-state')).viewState?.camera },
    saveCamera: viewState => request('/api/view-state', 'PUT', viewState),
  }
}
