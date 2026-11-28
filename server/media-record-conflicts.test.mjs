import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorSession, createCanvasInteraction, createMediaImport } from '../engine/index.js'
import { fixture } from './test-helpers.mjs'
import { httpSessionTransport } from './fixtures/editor-session-http-fixture.mjs'
import { rasterFiles } from '../tools/renderer-preview/image-fixtures.js'
import { videoData } from '../tools/renderer-preview/video-fixtures.js'
import { readdir } from 'node:fs/promises'

async function setup(t, kind) {
  const f = await fixture(t), { id } = await f.workspace.open({ title: '合成媒体记录条件' }), query = `?conversation=${id}`
  const read = async () => (await f.api('/api/canvas' + query)).body
  const post = (path, body, actor = 'ui:media') => f.api(path + query, 'POST', body, { 'x-hicanvas-actor': actor })
  const remote = async operations => {
    const reply = await post('/api/canvas/operations', { expectedRevision: (await read()).revision, operations }, 'remote:239')
    assert.equal(reply.status, 200, JSON.stringify(reply.body)); return reply.body
  }
  const dataUrl = kind === 'image' ? `data:image/png;base64,${rasterFiles.png.base64}` : videoData.mp4
  const upload = await post('/api/canvas/reference', { dataUrl, ...(kind === 'image' && { purpose: 'file-import' }) })
  assert.equal(upload.status, 200, JSON.stringify(upload.body))
  const item = { src: upload.body.src, mimeType: upload.body.mimeType, w: upload.body.w || 320, h: upload.body.h || 180 }
  await remote([{ type: `insert_${kind}`, [kind]: item }, { type: 'create_shape', id: 'shape:other', shapeType: 'geo', x: 1000 }])
  const initial = await read(), target = Object.values(initial.snapshot.store).find(record => record.typeName === 'shape' && record.type === kind)
  const transport = httpSessionTransport(f.base, id), session = await createEditorSession({ transport, actor: 'ui:media' })
  const interaction = createCanvasInteraction({ session, viewport: { w: 1200, h: 800 } })
  f.beforeClose(() => { interaction.dispose(); session.dispose() })
  const pageId = Object.values(initial.snapshot.store).find(record => record.typeName === 'page').id
  return { ...f, id, query, initial, item, target, post, read, remote, session, interaction, transport, media: createMediaImport({ session, interaction, pageId }) }
}

for (const kind of ['image', 'video']) for (const replace of [false, true]) test(`真实HTTP会话：${kind}${replace ? '替换' : '插入'}跨无关更新只提交一次`, async t => {
  const f = await setup(t, kind)
  if (replace) { f.interaction.select('first'); assert.deepEqual(f.interaction.state.get().selectedIds, [f.target.id]) }
  const ticket = f.media.begin({ point: { x: 600, y: 400 }, ...(replace && { replaceId: f.target.id }) })
  await f.remote([{ type: 'update', id: 'shape:other', changes: { x: 3456 } }]); await f.session.refresh()
  const before = await f.read()
  await ticket.commit([{ ...f.item, w: 160, h: 320 }])
  assert.equal(f.transport.commits.length, 1)
  const after = await f.read()
  assert.equal(after.snapshot.store['shape:other'].x, 3456)
  assert.equal(Object.values(after.snapshot.store).filter(record => record.typeName === 'shape' && record.type === kind).length, replace ? 1 : 2)
  assert.equal(f.session.state.get().isGestureActive, false)
  const undone = await f.post('/api/canvas/undo', { expectedRevision: after.revision })
  assert.equal(undone.status, 200, JSON.stringify(undone.body)); assert.deepEqual(undone.body.snapshot, before.snapshot)
})

function selectReplacement(f) {
  f.interaction.select('first')
  assert.deepEqual(f.interaction.state.get().selectedIds, [f.target.id])
}
for (const kind of ['image', 'video']) for (const change of ['target', 'asset', 'ancestor', 'deleted']) test(`真实HTTP会话：${kind}替换拒绝${change}变化，零提交且不改远端`, async t => {
  const f = await setup(t, kind)
  if (change === 'ancestor') {
    await f.remote([{ type: 'create_shape', id: 'shape:parent', shapeType: 'frame' }, { type: 'update', id: f.target.id, changes: { parentId: 'shape:parent' } }]); await f.session.refresh()
    // Select the frame, then descend through the public navigation action.
    f.interaction.select('first'); f.interaction.select('child')
  } else selectReplacement(f)
  assert.deepEqual(f.interaction.state.get().selectedIds, [f.target.id])
  const ticket = f.media.begin({ point: { x: 500, y: 400 }, replaceId: f.target.id })
  const operations = change === 'deleted' ? [{ type: 'delete', ids: [f.target.id] }] : [{ type: 'update', id: change === 'asset' ? f.target.props.assetId : change === 'ancestor' ? 'shape:parent' : f.target.id, changes: change === 'asset' ? { props: { name: 'remote-new-name' } } : { x: 999 } }]
  await f.remote(operations); await f.session.refresh()
  const before = await f.read()
  await assert.rejects(ticket.commit([f.item]))
  assert.equal(f.transport.commits.length, 0); assert.deepEqual(await f.read(), before)
})

for (const kind of ['image', 'video']) for (const replace of [false, true]) for (const related of [false, true]) test(`真实HTTP最后竞态：${kind}${replace ? '替换' : '插入'} ${related ? '相关拒绝' : '无关成功'}只发一次`, async t => {
  const f = await setup(t, kind)
  if (replace) selectReplacement(f)
  const ticket = f.media.begin({ point: { x: 600, y: 400 }, ...(replace && { replaceId: f.target.id }) }), commit = f.transport.commit
  let before
  f.transport.commit = async request => {
    before = await f.remote([{ type: 'update', id: related ? replace ? f.target.id : ticket.uploadGuard.intent.pageId : 'shape:other', changes: related && !replace ? { name: '远端画布改名' } : { x: 4567 } }])
    return commit(request)
  }
  if (related) {
    await assert.rejects(ticket.commit([f.item]), { code: 'conflict' })
    assert.deepEqual((await f.read()).snapshot, before.snapshot)
  } else {
    await ticket.commit([f.item]); assert.equal((await f.read()).snapshot.store['shape:other'].x, 4567)
  }
  assert.equal(f.transport.commits.length, 1)
  assert.deepEqual(f.session.store.getStoreSnapshot(), (await f.read()).snapshot)
  await assert.rejects(ticket.commit([f.item]), /已结束/, '同一ticket不可用作重发许可')
})

for (const kind of ['image', 'video']) test(`真实HTTP：${kind}凭证沿用开始基线，成功丢回执再取消不删已保存文件`, async t => {
  const f = await setup(t, kind), ticket = f.media.begin({ point: { x: 700, y: 500 } })
  const guard = ticket.uploadGuard
  guard.intent.pageId = 'page:mutated-copy'
  assert.notEqual(ticket.uploadGuard.intent.pageId, guard.intent.pageId, 'getter不泄漏可变条件')
  const start = await f.post('/api/canvas/reference', { purpose: 'file-import-begin', fileCount: 1, ...ticket.uploadGuard })
  assert.equal(start.status, 200, JSON.stringify(start.body))
  const importToken = start.body.importToken
  const upload = await f.post('/api/canvas/reference', { ...(kind === 'image' && { purpose: 'file-import' }), importToken, dataUrl: kind === 'image' ? `data:image/png;base64,${rasterFiles.png.base64}` : videoData.mp4 })
  assert.equal(upload.status, 200, JSON.stringify(upload.body))
  const item = { ...f.item, src: upload.body.src }, commit = f.transport.commit
  f.transport.commit = async request => { await commit(request); throw new Error('synthetic lost receipt') }
  await assert.rejects(ticket.commit([item]), /synthetic lost receipt/)
  assert.equal(f.transport.commits.length, 1)
  const saved = await f.read(), aborted = await f.post('/api/canvas/reference', { purpose: 'file-import-abort', importToken })
  assert.equal(aborted.status, 200); assert.equal(aborted.body.removed, 0)
  assert.equal((await fetch(f.base + item.src)).status, 200)
  assert.deepEqual(f.session.store.getStoreSnapshot(), saved.snapshot)
  const undo = await f.post('/api/canvas/undo', { expectedRevision: saved.revision })
  assert.equal(undo.status, 200)
  const redo = await f.post('/api/canvas/redo', { expectedRevision: undo.body.revision })
  assert.equal(redo.status, 200); assert.deepEqual(redo.body.snapshot, saved.snapshot)
  assert.equal((await readdir(await f.workspace.assetsDir(f.id))).length, 2)
})
