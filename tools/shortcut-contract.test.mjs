import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasInteraction, createEditorSession } from '../engine/index.js'
import { createImageGallery } from './renderer-preview/image-fixtures.js'
import { createZoomTool } from '../engine/interaction/camera-zoom-tool.js'
import { normalizeInput } from '../engine/interaction/input.js'

// The normalized input contract retains key casing. Refactoring declarations
// must retain the pre-action delegates' exact Enter/Escape checks as well.
test('图片裁剪保留Enter精确拼写，选择清空继续兼容原先忽略大小写的Escape', async () => {
  const snapshot = createImageGallery(undefined, true).snapshot
  const session = await createEditorSession({ actor: 'shortcut-contract', transport: { read: async () => ({ snapshot, revision: '0' }), subscribe: () => () => {}, commit: async () => { throw new Error('选择不应提交') } } })
  const interaction = createCanvasInteraction({ session, edgeScrolling: false })
  let time = 0
  const input = value => interaction.dispatch({ ...value, time: ++time })
  try {
    input({ type: 'pointer_down', point: { x: 220, y: 210 } }); await input({ type: 'pointer_up', point: { x: 220, y: 210 } })
    assert.deepEqual(interaction.state.get().selectedIds, ['shape:image-0'])
    assert.equal(input({ type: 'key_down', key: 'enter' }), false)
    assert.ok(!interaction.state.get().croppingId)
    assert.equal(input({ type: 'key_down', key: 'Enter' }), true)
    assert.equal(interaction.state.get().croppingId, 'shape:image-0')
    interaction.cropImage({ type: 'finish' })
    assert.equal(input({ type: 'key_down', key: 'escape' }), true)
    assert.deepEqual(interaction.state.get().selectedIds, [])
  } finally { interaction.dispose(); session.dispose() }
})

test('临时缩放只由精确Escape退出，忽略大小写的Z按下仍进入', () => {
  let state = { camera: { x: 0, y: 0, z: 1 } }
  const zoom = createZoomTool({ read: () => state, change: patch => { state = { ...state, ...patch } }, motion: { stop() {} }, navigate() {}, viewport: () => ({ w: 1280, h: 900 }) })
  const key = (key, time) => normalizeInput({ type: 'key_down', key, time })
  assert.equal(zoom.handle(key('Z', 1)), true); assert.equal(zoom.active(), true)
  assert.equal(zoom.handle(key('escape', 2)), false); assert.equal(zoom.active(), true)
  assert.equal(zoom.handle(key('Escape', 3)), true); assert.equal(zoom.active(), false)
})
