import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction } from '../engine/index.js'
import { attachPreviewInput } from './renderer-preview/input.js'

test('按钮事件和较早的同帧 rAF 共用时间归一化，动画不因输入时间倒退而取消', async () => {
  const session = await createEditorSession({ actor: 'camera-input', transport: {
    read: async () => ({ snapshot: createCanvasSnapshot(), revision: '0' }), subscribe: () => () => {}, commit: async () => { throw new Error('视角不能提交') },
  } })
  const interaction = createCanvasInteraction({ session }), keys = new EventTarget(), host = new EventTarget(), frames = new Map(), errors = []
  let next = 0
  keys.requestAnimationFrame = callback => { frames.set(++next, callback); return next }
  keys.cancelAnimationFrame = id => frames.delete(id)
  host.ownerDocument = { defaultView: keys }; host.clientWidth = 1280; host.clientHeight = 800
  const controls = attachPreviewInput(host, interaction, { onError: error => errors.push(error.message) })
  const frame = time => { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(time) }
  try {
    controls.navigate('zoom-in', null, 200)
    frame(190); assert.equal(interaction.state.get().camera.z, 1)
    frame(300); assert.ok(interaction.state.get().camera.z > 1)
    frame(500); assert.equal(interaction.state.get().camera.z, 2)
    assert.deepEqual(errors, []); assert.equal(frames.size, 0)
  } finally { controls.dispose(); interaction.dispose(); session.dispose() }
})
