import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands } from '../engine/index.js'

export const shape = (id, x, y, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'geo', x, y, props: { w: 80, h: 60, fill: 'solid' }, ...extra })
export async function selectionFixture(commands = [shape('a', 100, 100), shape('b', 300, 100), shape('c', 200, 220)], options = {}) {
  const { beforeCommit, ...interactionOptions } = options
  const initial = executeCanvasCommands(createCanvasSnapshot(), commands).snapshot
  let current = initial, revision = 0, time = 0
  const commits = [], session = await createEditorSession({ actor: 'selection-rules', transport: {
    read: async () => ({ snapshot: current, revision: String(revision) }), subscribe: () => () => {},
    commit: async request => {
      if (beforeCommit) await beforeCommit(request)
      commits.push(request)
      if (request.expectedRevision !== String(revision)) throw new Error('stale revision')
      const result = executeCanvasCommands(current, request.commands); current = result.snapshot
      return { ...result, revision: String(++revision) }
    },
  } })
  const interaction = createCanvasInteraction({ session, ...interactionOptions })
  const input = value => { time = Math.max(time + 1, value.time || 0); return interaction.dispatch({ ...value, time }) }
  const pointer = (type, x, y, extra = {}) => input({ type: `pointer_${type}`, point: { x, y }, pointerId: 1, button: 0, buttons: type === 'up' ? 0 : 1, ...extra })
  const click = async (x, y, extra = {}) => { time += 500; pointer('down', x, y, extra); await pointer('up', x, y, extra) }
  const doubleClick = async (x, y) => { await click(x, y); pointer('down', x, y); await pointer('up', x, y) }
  return { initial, session, interaction, commits, input, pointer, click, doubleClick, selected: () => [...interaction.state.get().selectedIds], state: () => interaction.state.get(), current: () => current,
    remote: async commands => { current = executeCanvasCommands(current, commands).snapshot; revision++; await session.refresh() },
    close() { interaction.dispose(); session.dispose() },
  }
}
