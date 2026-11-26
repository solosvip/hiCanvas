import { createCanvasSnapshot } from '../model/index.js'
import { createCanvasInteraction, canvasToolRegistry, createEditorSession, executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction } from '../engine/index.js'

// An in-memory host boundary, using the same public command/history contracts
// as HTTP. Tests drive the public interaction API and inspect saved records.
export async function creationFixture({ commands = [], beforeCommit, ...options } = {}) {
  const initial = commands.length ? executeCanvasCommands(createCanvasSnapshot(), commands).snapshot : createCanvasSnapshot()
  let current = initial, revision = 0, history, time = 0
  const commits = []
  const accept = result => { current = result.snapshot; return { ...result, revision: String(++revision) } }
  const session = await createEditorSession({ actor: 'creator', transport: {
    read: async () => ({ snapshot: current, revision: String(revision) }), subscribe: () => () => {},
    commit: async request => {
      commits.push(structuredClone(request))
      await beforeCommit?.(request)
      if (request.expectedRevision !== String(revision)) throw Object.assign(new Error('Synthetic revision conflict'), { code: 'conflict' })
      const result = executeCanvasCommands(current, request.commands)
      history = recordCanvasTransaction(history, request.actor, result.changes)
      return accept(result)
    },
    undo: async ({ actor }) => { const result = undoCanvasTransaction(current, history, actor); history = result.history; return accept(result) },
    redo: async ({ actor }) => { const result = redoCanvasTransaction(current, history, actor); history = result.history; return accept(result) },
  } })
  const interaction = createCanvasInteraction({ session, toolIds: Object.keys(canvasToolRegistry), viewport: { w: 1280, h: 800 }, edgeScrolling: false, ...options })
  const pointer = (type, x, y, extra = {}) => interaction.dispatch({ type: `pointer_${type}`, time: ++time, point: { x, y }, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'up' ? 0 : 1, pressure: .5, ...extra })
  const key = (key, extra = {}, type = 'key_down') => interaction.dispatch({ type, time: ++time, key, ...extra })
  return {
    initial, session, interaction, commits, pointer, key,
    click: async (x, y, extra) => { pointer('down', x, y, extra); return pointer('up', x, y, extra) },
    current: () => current,
    shapes: () => Object.values(current.store).filter(record => record.typeName === 'shape').sort((a,b) => a.index < b.index ? -1 : a.index > b.index ? 1 : 0),
    previewShapes: () => session.store.allRecords().filter(record => record.typeName === 'shape'),
    remote: async (commands, refresh = true) => { current = executeCanvasCommands(current, commands).snapshot; revision++; if (refresh) await session.refresh() },
    close: () => { interaction.dispose(); session.dispose() },
  }
}
