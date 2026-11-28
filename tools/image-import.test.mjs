import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction, createMediaImport, executeCanvasCommands } from '../engine/index.js'
import { createImageGallery } from './renderer-preview/image-fixtures.js'
import { memoryTransport } from './renderer-preview/transport.js'

const image = { w: 320, h: 180, name: 'grid.png', src: '/c/synthetic/assets/grid.png', mimeType: 'image/png', isAnimated: false }
async function setup() {
  const snapshot = createCanvasSnapshot(), transport = memoryTransport(snapshot), session = await createEditorSession({ transport, actor: 'image-import' })
  let state = { selectedIds: [], camera: { x: 0, y: 0, z: 1 }, viewport: { w: 1280, h: 800 } }
  const interaction = { state: { get: () => state }, setCamera: camera => { state = { ...state, camera } } }
  const pageId = Object.values(snapshot.store).find(r => r.typeName === 'page').id
  return { session, media: createMediaImport({ session, interaction, pageId }), interaction,
    select: selectedIds => { state = { ...state, selectedIds } },
    shapes: () => session.store.allRecords().filter(r => r.typeName === 'shape').sort((a, b) => a.x - b.x), close: () => session.dispose() }
}
test('文件图片按自然尺寸紧贴成行，重复落点不避障；整批一次撤销', async () => {
  const f = await setup()
  try {
    const items = [image, { ...image, w: 160, h: 320 }]
    await f.media.begin({ point: { x: 550, y: 420 } }).commit(items)
    assert.deepEqual(f.shapes().map(s => [s.type, s.x, s.y, s.props.w, s.props.h]), [['image', 310, 260, 320, 180], ['image', 630, 260, 160, 320]])
    const ids = new Set(f.shapes().map(s => s.id))
    await f.media.begin({ point: { x: 550, y: 420 } }).commit(items)
    assert.deepEqual(f.shapes().filter(s => !ids.has(s.id)).sort((a, b) => b.props.w - a.props.w).map(s => [s.x, s.y]), [[310, 260], [630, 260]])
    await f.session.undo(); assert.equal(f.shapes().length, 2)
    await f.session.undo(); assert.equal(f.shapes().length, 0)
    await f.session.redo(); assert.equal(f.shapes().length, 2)
  } finally { f.close() }
})
test('4096宽文件保留尺寸，视角90%适配；生图命令默认512宽', async () => {
  const f = await setup()
  try {
    await f.media.begin({ point: { x: 550, y: 420 } }).commit([{ ...image, w: 4096, h: 256 }])
    assert.equal(f.shapes()[0].props.w, 4096)
    assert.equal(f.interaction.state.get().camera.z, .28125)
    const snapshot = createCanvasSnapshot()
    const result = executeCanvasCommands(snapshot, [{ type: 'insert_image', image: { ...image, w: 4096, h: 256 } }])
    assert.equal(result.results[0].shapeRecord.props.w, 512)
    assert.equal(result.results[0].shapeRecord.props.h, 32)
  } finally { f.close() }
})
test('动画标记不丢失；图片与视频共用一批事务，后项错误整批回滚', async () => {
  const f = await setup()
  try {
    await f.media.begin({ point: { x: 550, y: 420 } }).commit([{ ...image, mimeType: 'image/gif', isAnimated: true }, { ...image, mimeType: 'video/mp4' }])
    assert.deepEqual(f.shapes().map(s => s.type), ['image', 'video'])
    assert.equal(f.session.store.get(f.shapes().find(shape => shape.type === 'image').props.assetId).props.isAnimated, true)
    const before = f.session.store.allRecords()
    await assert.rejects(f.media.begin({ point: { x: 0, y: 0 } }).commit([image, { ...image, src: '', mimeType: 'image/png' }]))
    assert.deepEqual(f.session.store.allRecords(), before)
    await assert.rejects(f.media.begin({ point: { x: 0, y: 0 } }).commit([image, { ...image, mimeType: 'text/html' }]))
    assert.deepEqual(f.session.store.allRecords(), before)
  } finally { f.close() }
})
test('替换保留身份外框描述及镜像，按新图居中裁剪；类型不匹配和选择变化拒绝', async () => {
  const f = await setup()
  try {
    await f.media.begin({ point: { x: 550, y: 420 } }).commit([image])
    const shape = f.shapes()[0]; f.select([shape.id])
    await f.media.begin({ point: { x: 0, y: 0 }, replaceId: shape.id }).commit([{ ...image, w: 160, h: 320 }])
    const next = f.session.store.get(shape.id)
    assert.deepEqual([next.id, next.x, next.y, next.props.w, next.props.h, next.props.altText], [shape.id, shape.x, shape.y, 320, 180, shape.props.altText])
    assert.deepEqual(next.props.crop, { topLeft: { x: 0, y: .359375 }, bottomRight: { x: 1, y: .640625 } })
    await f.session.undo(); assert.deepEqual(f.session.store.get(shape.id), shape)
    await assert.rejects(f.media.begin({ point: { x: 0, y: 0 }, replaceId: shape.id }).commit([{ ...image, mimeType: 'video/mp4' }]))
    const ticket = f.media.begin({ point: { x: 0, y: 0 }, replaceId: shape.id }); f.select([])
    await assert.rejects(ticket.commit([image]), /选择已变化/)
    assert.deepEqual(f.session.store.get(shape.id), shape)
  } finally { f.close() }
})
test('上传期间进入同一图片的裁剪或描述会话，拒绝导入且保留编辑状态', async () => {
  for (const mode of ['crop', 'alt']) {
    const data = createImageGallery(undefined, true), session = await createEditorSession({ transport: memoryTransport(data.snapshot), actor: 'upload-editing' })
    const interaction = createCanvasInteraction({ session, viewport: { w: 1280, h: 800 } })
    try {
      interaction.dispatch({ type: 'pointer_down', time: 1, point: { x: 210, y: 210 }, button: 0, buttons: 1 })
      await interaction.dispatch({ type: 'pointer_up', time: 2, point: { x: 210, y: 210 }, button: 0, buttons: 0 })
      const before = session.store.allRecords(), media = createMediaImport({ session, interaction, pageId: data.viewState.currentPageId })
      const ticket = media.begin({ point: { x: 550, y: 420 } })
      if (mode === 'crop') interaction.cropImage({ type: 'start' }); else interaction.imageAlt({ type: 'start' })
      assert.equal(session.state.get().isGestureActive, false)
      await assert.rejects(ticket.commit([image]), /变化|操作/)
      assert.deepEqual(session.store.allRecords(), before)
      assert.ok(mode === 'crop' ? interaction.state.get().croppingId : interaction.state.get().imageAltEditing)
    } finally { interaction.dispose(); session.dispose() }
  }
})
test('SVG替换沿用公开图片事务，保留身份外框、镜像、描述及一次撤销', async () => {
  const f = await setup()
  try {
    await f.media.begin({ point: { x: 550, y: 420 } }).commit([image])
    const id = f.shapes()[0].id
    f.session.beginGesture()
    f.session.preview([{ type: 'flip_shapes', ids: [id], axis: 'x' }, { type: 'set_image_alt_text', id, altText: '保留这段描述' }])
    await f.session.commitGesture()
    const before = f.session.store.get(id); f.select([id])
    await f.media.begin({ point: { x: 0, y: 0 }, replaceId: id }).commit([{ ...image, w: 160, h: 320, src: '/c/synthetic/assets/clean.svg', mimeType: 'image/svg+xml' }])
    const after = f.session.store.get(id)
    for (const key of ['id', 'x', 'y', 'rotation']) assert.equal(after[key], before[key])
    for (const key of ['w', 'h', 'flipX', 'flipY', 'altText']) assert.equal(after.props[key], before.props[key])
    assert.equal(f.session.store.get(after.props.assetId).props.mimeType, 'image/svg+xml')
    await f.session.undo(); assert.deepEqual(f.session.store.get(id), before)
  } finally { f.close() }
})
