import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands } from '../engine/index.js'
import { createVideoFixture } from './renderer-preview/video-fixtures.js'
import { videoSource } from '../renderer/video-source.js'
import { memoryTransport } from './renderer-preview/transport.js'

test('#186 后起播的视频独占播放，前一个视频保留进度且不提交画板', async () => {
  const snapshot = createVideoFixture().snapshot, before = structuredClone(snapshot)
  let commits = 0
  const session = await createEditorSession({ actor: 'one-video', transport: { read: async () => ({ snapshot, revision: '0' }), subscribe: () => () => {}, commit: async () => { commits++; throw new Error('播放不应提交') } } })
  const interaction = createCanvasInteraction({ session })
  const report = (id, time) => interaction.videoInput({ type: 'playback', event: 'play', id: `shape:video-${id}`, assetId: `asset:video-${id}`, time, playing: true })
  try {
    assert.equal(report(0, 1.25), true)
    assert.equal(report(1, .4), true)
    const playback = interaction.state.get().videoPlayback
    assert.deepEqual(playback['shape:video-0'], { assetId: 'asset:video-0', time: 1.25, playing: false })
    assert.equal(playback['shape:video-1'].playing, true)
    assert.deepEqual(snapshot, before); assert.equal(commits, 0)
    assert.equal(session.state.get().isGestureActive, false)
  } finally { interaction.dispose(); session.dispose() }
})

test('#186 旧画板不从进度回执起播，暂停后迟到的进度也不能抢回播放', async () => {
  const snapshot = createVideoFixture().snapshot
  for (const r of Object.values(snapshot.store)) if (r.type === 'video' && r.typeName === 'shape') { r.props.playing = true; r.props.autoplay = true }
  const before = structuredClone(snapshot)
  const session = await createEditorSession({ actor: 'late-video', transport: { read: async () => ({ snapshot, revision: '0' }), subscribe: () => () => {}, commit: async () => { throw new Error('播放不应提交') } } })
  const interaction = createCanvasInteraction({ session })
  const report = (id, event, time, playing = true) => interaction.videoInput({ type: 'playback', event, id: `shape:video-${id}`, assetId: `asset:video-${id}`, time, playing })
  try {
    assert.equal(Object.values(interaction.state.get().videoPlayback).some(entry => entry.playing), false)
    report(0, 'timeupdate', .1)
    assert.equal(interaction.state.get().videoPlayback['shape:video-0'].playing, false)
    report(0, 'play', 1.25); report(1, 'play', .5)
    report(0, 'timeupdate', 1.3); report(0, 'seeked', 1.4)
    assert.equal(interaction.state.get().videoPlayback['shape:video-0'].playing, false)
    assert.equal(interaction.state.get().videoPlayback['shape:video-0'].time, 1.4)
    assert.equal(interaction.state.get().videoPlayback['shape:video-1'].playing, true)
    report(1, 'pause', .6, false)
    assert.equal(Object.values(interaction.state.get().videoPlayback).some(entry => entry.playing), false)
    assert.deepEqual(snapshot, before)
  } finally { interaction.dispose(); session.dispose() }
})

test('#186 替换撤销只恢复旧资源进度，不恢复曾经的起播状态打断当前视频', async () => {
  const session = await createEditorSession({ actor: 'undo-one-video', transport: memoryTransport(createVideoFixture().snapshot) })
  const interaction = createCanvasInteraction({ session })
  try {
    interaction.videoInput({ type: 'playback', event: 'play', id: 'shape:video-0', assetId: 'asset:video-0', time: 1.25, playing: true })
    session.beginGesture(); session.preview([{ type: 'replace_video', id: 'shape:video-0', video: { src: '/c/synthetic/assets/new.mp4', mimeType: 'video/mp4', w: 160, h: 320 } }]); await session.commitGesture()
    interaction.videoInput({ type: 'playback', event: 'play', id: 'shape:video-1', assetId: 'asset:video-1', time: .5, playing: true })
    await session.undo()
    const playback = interaction.state.get().videoPlayback
    assert.deepEqual(playback['shape:video-0'], { assetId: 'asset:video-0', time: 1.25, playing: false })
    assert.equal(playback['shape:video-1'].playing, true)
  } finally { interaction.dispose(); session.dispose() }
})

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
