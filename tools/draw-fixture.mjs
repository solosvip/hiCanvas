import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands } from '../engine/index.js'
import { b64Vecs } from '@tldraw/tlschema'

export const points = shape => shape.props.segments.map(s => ({ type: s.type, points: b64Vecs.decodePoints(s.path) }))
export async function drawFixture(commands = [], options = {}) {
  let snapshot = createCanvasSnapshot(), revision = 0, time = 0, gate = null
  if (commands.length) snapshot = executeCanvasCommands(snapshot, commands).snapshot
  const initial = structuredClone(snapshot), commits = [], past = [], future = []
  const read = async () => ({ snapshot, revision: String(revision) })
  const history = from => async () => {
    if (from.length) {
      const destination = from.pop(), before = snapshot
      ;(from === past ? future : past).push(before); snapshot = destination; revision++
    }
    return { ...await read(), changes: { added: {}, updated: {}, removed: {} }, results: [] }
  }
  const session = await createEditorSession({ actor: 'draw-test', transport: {
    read, subscribe: () => () => {}, undo: history(past), redo: history(future),
    async commit(request) {
      if (gate) await gate
      if (request.expectedRevision !== String(revision)) throw Object.assign(new Error('合成版本冲突'), { code: 'conflict' })
      const result = executeCanvasCommands(snapshot, request.commands)
      commits.push(request); past.push(snapshot); future.length = 0; snapshot = result.snapshot
      return { ...result, revision: String(++revision) }
    },
  } })
  const created = new Map()
  const stop = session.store.addHistoryInterceptor(({ changes }) => {
    for (const shape of Object.values(changes.added)) if (['draw', 'highlight'].includes(shape.type) && !created.has(shape.id)) created.set(shape.id, created.size)
  })
  const interaction = createCanvasInteraction({ session, toolIds: ['select', 'hand', 'draw', 'highlight'], edgeScrolling: false, ...options })
  const input = value => { time = Math.max(time + 1, value.time || 0); return interaction.dispatch({ ...value, time }) }
  const pointer = (type, x, y, extra = {}) => input({ type: `pointer_${type}`, point: { x, y }, pointerId: 1, button: 0, buttons: type === 'up' ? 0 : 1, ...extra })
  const key = (key, extra = {}, type = 'down') => input({ type: `key_${type}`, key, ...extra })
  const shapes = () => session.store.allRecords().filter(r => ['draw', 'highlight'].includes(r.type)).sort((a, b) => created.get(a.id) - created.get(b.id))
  return { initial, session, interaction, input, pointer, key, shapes, commits, state: () => interaction.state.get(), saved: () => snapshot, depth: () => past.length,
    remote: async commands => { snapshot = executeCanvasCommands(snapshot, commands).snapshot; revision++; await session.refresh() },
    hold() { let resume; gate = new Promise(resolve => { resume = resolve }); return () => { gate = null; resume() } },
    close() { interaction.dispose(); stop(); session.dispose() },
  }
}
