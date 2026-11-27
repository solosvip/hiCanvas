import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createMediaImport } from '../engine/index.js'
import { memoryTransport } from './renderer-preview/transport.js'

const video = { w: 1280, h: 720, name: 'synthetic.mp4', mimeType: 'video/mp4', fileSize: 123, src: '/c/synthetic/assets/grid.mp4' }
async function setup(viewport = null) {
  const snapshot = createCanvasSnapshot(), transport = memoryTransport(snapshot)
  let failSave = false
  const commit = transport.commit
  transport.commit = async request => { if (failSave) throw new Error('模拟提交失败'); return commit(request) }
  const session = await createEditorSession({ transport, actor: 'video-import' })
  let state = { camera: { x: 10, y: 20, z: 2 }, selectedIds: [], ...(viewport && { viewport }) }
  const interaction = { state: { get: () => state }, setCamera: camera => { state = { ...state, camera } } }, pageId = Object.values(snapshot.store).find(r => r.typeName === 'page').id
  const media = createMediaImport({ session, interaction, pageId })
  return { session, transport, media, interaction, failSave: () => { failSave = true }, select: ids => { state = { ...state, selectedIds: ids } }, shapes: () => session.store.allRecords().filter(r => r.typeName === 'shape'), close: () => session.dispose() }
}
test('公开媒体入口：屏幕落点居中、自然尺寸，多文件一次提交/一次撤销', async () => {
  const f = await setup()
  try {
    await f.media.begin({ point: { x: 400, y: 300 } }).commit([video])
    assert.deepEqual([f.shapes()[0].x, f.shapes()[0].y, f.shapes()[0].props.w, f.shapes()[0].props.h], [-450, -230, 1280, 720])
    await f.session.undo(); assert.equal(f.shapes().length, 0)
    const revision = f.session.state.get().revision
    await f.media.begin({ point: { x: 400, y: 300 } }).commit([video, { ...video, w: 160, h: 320 }])
    assert.equal(f.shapes().length, 2); assert.notEqual(f.session.state.get().revision, revision)
    await f.session.undo(); assert.equal(f.shapes().length, 0)
    await f.session.redo(); assert.equal(f.shapes().length, 2)
  } finally { f.close() }
})
test('上传期间选择/版本变化、取消、坏媒体均拒绝，整次不留部分形状；替换保留身份位置', async () => {
  const f = await setup()
  try {
    let ticket = f.media.begin({ point: { x: 0, y: 0 } })
    f.select(['shape:other']); await assert.rejects(ticket.commit([video]), /选择已变化/); assert.equal(f.shapes().length, 0)
    f.select([]); ticket = f.media.begin({ point: { x: 0, y: 0 } })
    await f.transport.commit({ expectedRevision: f.session.state.get().revision, actor: 'remote', commands: [{ type: 'create_shape', shapeType: 'geo' }] }); await f.session.refresh()
    await assert.rejects(ticket.commit([video]), /画板或选择已变化/); assert.equal(f.shapes().filter(s => s.type === 'video').length, 0)
    ticket = f.media.begin({ point: { x: 0, y: 0 } }); ticket.cancel(); await assert.rejects(ticket.commit([video]), /已结束/)
    await assert.rejects(f.media.begin({ point: { x: 0, y: 0 } }).commit([video, { ...video, w: 0 }]), /尺寸/)
    assert.equal(f.shapes().filter(s => s.type === 'video').length, 0)
    await f.media.begin({ point: { x: 400, y: 300 } }).commit([video])
    const shape = f.shapes().find(s => s.type === 'video'); f.select([shape.id])
    await f.media.begin({ point: { x: 999, y: 999 }, replaceId: shape.id }).commit([{ ...video, w: 160, h: 320 }])
    const next = f.session.store.get(shape.id)
    assert.deepEqual([next.id, next.x, next.y, next.props.w, next.props.h], [shape.id, shape.x, shape.y, 160, 320])
    await f.session.undo(); assert.deepEqual(f.session.store.get(shape.id), shape)
    await f.session.redo(); assert.deepEqual(f.session.store.get(shape.id), next)
  } finally { f.close() }
})
test('同批两/三个视频按旧版读数紧贴成行、顶部对齐，整行在落点居中', async () => {
  const f = await setup()
  try {
    const items = [{ ...video, w: 320, h: 180 }, { ...video, w: 160, h: 320 }]
    await f.media.begin({ point: { x: 1120, y: 880 } }).commit(items)
    assert.deepEqual(f.shapes().map(s => [s.x, s.y, s.props.w, s.props.h]), [[310, 260, 320, 180], [630, 260, 160, 320]])
    await f.session.undo()
    await f.media.begin({ point: { x: 1120, y: 880 } }).commit([...items, items[0]])
    assert.deepEqual(f.shapes().map(s => [s.x, s.y, s.props.w, s.props.h]), [[150, 260, 320, 180], [470, 260, 160, 320], [630, 260, 320, 180]])
  } finally { f.close() }
})

test('大视频保留自然尺寸，按旧版1280×800读数居中90%视角；相机不写画板', async () => {
  const f = await setup({ w: 1280, h: 800 })
  try {
    f.interaction.setCamera({ x: 0, y: 0, z: 1 })
    await f.media.begin({ point: { x: 550, y: 420 } }).commit([video])
    const camera = f.interaction.state.get().camera
    assert.ok(Math.abs(camera.z - .9) < 1e-9)
    assert.ok(Math.abs(camera.x - 161.11111111111111) < 1e-9)
    assert.ok(Math.abs(camera.y - 24.444444444444443) < 1e-9)
    assert.deepEqual([f.shapes()[0].x, f.shapes()[0].y], [-90, 60])
    await f.session.undo(); assert.equal(f.shapes().length, 0)
  } finally { f.close() }
})

test('已预览的批量导入遇到宿主提交失败时，资源/形状全部恢复', async () => {
  const f = await setup()
  try {
    const before = f.session.store.allRecords()
    f.failSave()
    await assert.rejects(f.media.begin({point:{x:400,y:300}}).commit([video,{...video,w:160,h:320}]), /模拟提交失败/)
    assert.deepEqual(f.session.store.allRecords(), before)
    assert.equal(f.session.state.get().revision, '0')
    assert.equal(f.session.state.get().isGestureActive, false)
  } finally { f.close() }
})

test('极宽批量视频自动视角遵守既有5%缩放下限', async () => {
  const f = await setup({w:1280,h:800})
  try {
    f.interaction.setCamera({x:0,y:0,z:1})
    await f.media.begin({point:{x:550,y:420}}).commit([{...video,w:16384},{...video,w:16384}])
    const camera=f.interaction.state.get().camera
    assert.equal(camera.z,.05)
    assert.ok(Math.abs((550+camera.x)*camera.z-640)<1e-8)
    assert.ok(Math.abs((420+camera.y)*camera.z-400)<1e-8)
  } finally {f.close()}
})
