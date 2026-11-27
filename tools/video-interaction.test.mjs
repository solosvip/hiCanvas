import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands } from '../engine/index.js'
import { createVideoFixture } from './renderer-preview/video-fixtures.js'
import { videoSource } from '../renderer/video-source.js'

test('F19 双击进入、外点与 Escape 退出，播放状态只在会话，不产生提交和历史', async () => {
  let snapshot = createVideoFixture().snapshot, revision = 0, time = 0, commits = 0
  const session = await createEditorSession({ actor: 'video', transport: { read: async () => ({ snapshot, revision: String(revision) }), subscribe: () => () => {}, commit: async request => { commits++; const result = executeCanvasCommands(snapshot, request.commands); snapshot = result.snapshot; return { ...result, revision: String(++revision) } } } })
  const interaction = createCanvasInteraction({ session, camera: { x: 0, y: 0, z: 1 }, edgeScrolling: false })
  const input = value => interaction.dispatch({ ...value, time: ++time })
  const click = async (x, y) => { input({ type: 'pointer_down', point: { x, y }, button: 0, buttons: 1, pointerId: 1 }); await input({ type: 'pointer_up', point: { x, y }, button: 0, buttons: 0, pointerId: 1 }) }
  try {
    const before = structuredClone(snapshot)
    await click(200, 150); await click(200, 150)
    assert.equal(interaction.state.get().interactingVideoId, 'shape:video-0')
    assert.equal(session.state.get().isGestureActive, false)
    assert.equal(interaction.videoInput({ type: 'playback', id: 'shape:video-0', assetId: 'asset:video-0', time: 3.3, playing: true }), true)
    assert.deepEqual(snapshot, before); assert.equal(commits, 0)
    assert.equal(interaction.state.get().videoPlayback['shape:video-0'].time, 3.3)
    assert.equal(interaction.videoInput({ type: 'playback', id: 'shape:video-0', assetId: 'asset:stale', time: 4, playing: false }), false)
    await click(1100, 600)
    assert.equal(interaction.state.get().interactingVideoId, null)
    interaction.videoInput({ type: 'start', id: 'shape:video-0' })
    interaction.setInputContext({ owner: 'form', isComposing: false })
    assert.equal(input({ type: 'key_down', key: 'Escape' }), true)
    assert.equal(interaction.state.get().interactingVideoId, null)
    interaction.videoInput({ type: 'start', id: 'shape:video-0' }); interaction.setTool('hand')
    assert.equal(interaction.state.get().interactingVideoId, null)
    assert.deepEqual(snapshot, before); assert.equal(commits, 0)
    interaction.videoInput({ type: 'playback', id: 'shape:video-0', assetId: 'asset:video-0', time: 2, playing: false })
    session.beginGesture(); session.preview([{ type: 'replace_video', id: 'shape:video-0', video: { src: '/c/synthetic/assets/new.mp4', w: 160, h: 320, mimeType: 'video/mp4' } }]); await session.commitGesture()
    const playback = interaction.state.get().videoPlayback['shape:video-0']
    assert.equal(playback.playing, false); assert.equal(playback.time, 0); assert.equal(playback.assetId, session.store.get('shape:video-0').props.assetId)
  } finally { interaction.dispose(); session.dispose() }
})
test('视频资源兼容旧 data URL 和本机路径；拒绝外链、路径穿越和非法编码', () => {
  for (const src of ['data:video/mp4;base64,AAAA', '/assets/a.mp4', '/page-assets/p/a.mov', '/c/synthetic/assets/a.webm']) assert.equal(videoSource(src), src)
  for (const src of ['https://example.com/a.mp4', '//example.com/a.mp4', '/assets/%2e%2e', '/assets/a%2fb', '/assets/%ZZ', '/assets/a?x', 'blob:other', null]) assert.equal(videoSource(src), null)
})
test('替换提交失败恢复旧资源的暂停进度，不能把原视频退回零秒', async () => {
  const snapshot = createVideoFixture().snapshot
  const session = await createEditorSession({ actor: 'video-failure', transport: { read: async () => ({ snapshot, revision: '0' }), subscribe: () => () => {}, commit: async () => { throw new Error('模拟保存失败') } } })
  const interaction = createCanvasInteraction({ session })
  try {
    interaction.videoInput({ type: 'playback', id: 'shape:video-0', assetId: 'asset:video-0', time: 3.3, playing: false })
    session.beginGesture(); session.preview([{ type: 'replace_video', id: 'shape:video-0', video: { src: '/c/synthetic/assets/new.mp4', mimeType: 'video/mp4', w: 160, h: 320 } }])
    await assert.rejects(session.commitGesture(), /模拟保存失败/)
    session.cancelGesture()
    assert.equal(session.store.get('shape:video-0').props.assetId, 'asset:video-0')
    assert.deepEqual(interaction.state.get().videoPlayback['shape:video-0'], { assetId: 'asset:video-0', time: 3.3, playing: false })
  } finally { interaction.dispose(); session.dispose() }
})
test('组内视频首次双击先进入组，已聚焦组的双击才进入原生控件', async () => {
  const snapshot = executeCanvasCommands(createVideoFixture().snapshot, [{ type: 'group_shapes', ids: ['shape:video-0', 'shape:video-1'] }]).snapshot
  const group = Object.values(snapshot.store).find(r => r.type === 'group')
  const session = await createEditorSession({ actor: 'group-video', transport: { read: async () => ({ snapshot, revision: '0' }), subscribe: () => () => {}, commit: async () => { throw new Error('双击不应保存') } } })
  const interaction = createCanvasInteraction({ session, camera: { x: 0, y: 0, z: 1 } })
  let time = 0
  const click = async () => { for (const type of ['pointer_down', 'pointer_up']) await interaction.dispatch({ type, time: ++time, pointerId: 1, button: 0, buttons: type === 'pointer_down' ? 1 : 0, point: { x: 200, y: 150 } }) }
  try {
    await click(); await click()
    assert.equal(interaction.state.get().interactingVideoId, null)
    assert.equal(interaction.state.get().focusedGroupId, group.id)
    time += 500; await click(); await click()
    assert.equal(interaction.state.get().interactingVideoId, 'shape:video-0')
  } finally { interaction.dispose(); session.dispose() }
})
