import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorSession, createCanvasInteraction, getShapeScalingCapabilities } from '../engine/index.js'
import { fixture, subject } from './scale-fixtures.mjs'

const examples = [
  ['line', { color: 'black', dash: 'solid', size: 'm', scale: 1, spline: 'line', points: { a1: { id: 'a1', index: 'a1', x: 0, y: 0 }, a2: { id: 'a2', index: 'a2', x: 200, y: 100 } } }, { x: 350, y: 275 }],
  ['arrow', { end: { x: 200, y: 100 } }, { x: 350, y: 275 }],
  ['note', {}, { x: 350, y: 300 }],
  ['bookmark', {}, { x: 350, y: 300 }],
  ['embed', { w: 320, h: 240, url: 'https://scratch.mit.edu/projects/123456789' }, { x: 350, y: 300 }],
]
for (const [type, props, point] of examples) for (const group of [false, true]) test(`${type}/${group ? '组选' : '单选及混选'}：缩放能力与手柄可见性分开判断`, async () => {
  const snapshot = fixture(type, props, { group, peer: true })
  const session = await createEditorSession({ actor: 'scaling-visibility', transport: {
    read: async () => ({ snapshot, revision: '0' }), subscribe: () => () => {}, commit: async () => { throw Error('Selection must not write') },
  } })
  const interaction = createCanvasInteraction({ session })
  let time = 0
  const click = async (p, modifiers = {}) => {
    const input = { time: ++time, point: p, pointerId: 1, pointerType: 'mouse', button: 0, ...modifiers }
    interaction.dispatch({ type: 'pointer_down', ...input }); await interaction.dispatch({ type: 'pointer_up', ...input })
  }
  const resizeHandles = () => interaction.state.get().overlays.find(o => o.kind === 'selection')?.handles.filter(h => h.kind === 'resize')
  try {
    assert.deepEqual(getShapeScalingCapabilities(snapshot.store[subject]), { canScale: true, lockAspectRatio: false, hideResizeHandles: true })
    await click(point)
    assert.deepEqual(interaction.state.get().selectedIds, [group ? 'shape:group' : subject])
    assert.equal(resizeHandles().length, group ? 8 : 0)
    if (!group) { await click({ x: 800, y: 300 }, { shiftKey: true }); assert.equal(resizeHandles().length, 8) }
  } finally { interaction.dispose(); session.dispose() }
})
