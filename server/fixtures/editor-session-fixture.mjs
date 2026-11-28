import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands, CanvasEditError, assertRecordBasis, getRecordDependencies } from '../../engine/index.js'

export const shape = (name, extra = {}) => ({ type: 'create_shape', id: `shape:${name}`, shapeType: 'geo', ...extra })
export const update = (name, changes) => ({ type: 'update', id: `shape:${name}`, changes })
export const snapshotOf = session => structuredClone(session.store.getStoreSnapshot())

export function memoryHost(snapshot = createCanvasSnapshot()) {
  let current = { snapshot: structuredClone(snapshot), revision: 'v0' }
  let sequence = 0
  const listeners = new Set()
  const commits = []
  let beforeCommit = null
  let canonicalize = record => record
  function notify() { for (const listener of [...listeners]) listener({ revision: current.revision }) }
  async function write({ expectedRevision, commands, actor, recordBasis }) {
    if (recordBasis === undefined) { if (expectedRevision !== current.revision) throw new CanvasEditError('版本已变化。', 'conflict') }
    else assertRecordBasis(current.snapshot, recordBasis, getRecordDependencies(current.snapshot, commands))
    const result = executeCanvasCommands(current.snapshot, commands)
    for (const record of Object.values(result.snapshot.store)) canonicalize(record)
    for (const [id, value] of Object.entries(result.changes.added)) result.changes.added[id] = structuredClone(result.snapshot.store[id])
    for (const [id, [before]] of Object.entries(result.changes.updated)) result.changes.updated[id] = [before, structuredClone(result.snapshot.store[id])]
    current = { snapshot: result.snapshot, revision: `v${++sequence}` }
    commits.push({ expectedRevision, commands: structuredClone(commands), actor })
    notify()
    return { ...structuredClone(current), changes: result.changes, results: result.results }
  }
  return {
    commits,
    current: () => structuredClone(current),
    async remote(commands, { broadcast = true } = {}) {
      const savedListeners = [...listeners]
      if (!broadcast) listeners.clear()
      try { return await write({ expectedRevision: current.revision, commands, actor: 'remote' }) }
      finally { if (!broadcast) for (const listener of savedListeners) listeners.add(listener) }
    },
    beforeCommit(fn) { beforeCommit = fn },
    canonicalize(fn) { canonicalize = fn },
    listenerCount: () => listeners.size,
    transport: {
      async read() { return structuredClone(current) },
      async commit(request) {
        if (beforeCommit) await beforeCommit(request)
        return write(request)
      },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    },
  }
}
