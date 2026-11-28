import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readdir } from 'node:fs/promises'
import { fixture } from './test-helpers.mjs'
import { createEditorSession, createCanvasInteraction } from '../engine/index.js'
import { createFlattenUpload } from '../tools/renderer-preview/flatten-upload.js'
import { rasterFiles } from '../tools/renderer-preview/image-fixtures.js'

async function setup(t, mode = '') {
  const f = await fixture(t), { id } = await f.workspace.open(), actor = 'ui:flatten-http', query = `?conversation=${id}`
  const initial = await f.workspace.read(id)
  await f.workspace.submitCommands(id, initial.revision, 'fixture', () => [{ type: 'create_shape', id: 'shape:source', shapeType: 'geo', x: 20, y: 30, props: { w: 160, h: 90 } }])
  const call = async (path, method, body) => {
    const reply = await f.api(path + query, method, body, { 'x-hicanvas-actor': actor })
    if (reply.status !== 200) throw Object.assign(new Error(reply.body.error), { code: reply.status === 409 ? 'conflict' : 'transport' })
    return reply.body
  }
  let commits = 0, saved, entered, release, importToken
  const reached = new Promise(resolve => { entered = resolve }), gate = new Promise(resolve => { release = resolve })
  const session = await createEditorSession({ actor, transport: {
    read: () => call('/api/canvas'), subscribe: () => () => {},
    async commit(request) {
      commits++
      if (mode === 'abort-before-save') { entered(); await gate }
      if (mode === 'conflict') { const latest = await f.workspace.read(id); await f.workspace.submitCommands(id, latest.revision, 'remote', () => [{ type: 'create_shape', id: 'shape:remote', shapeType: 'geo' }]) }
      const reply = await call('/api/canvas/operations', 'POST', { expectedRevision: request.expectedRevision, operations: request.commands })
      if (['save-first', 'save-before-abort'].includes(mode)) { entered(); await gate }
      if (mode === 'lost-save') throw new Error('合成保存回执丢失')
      return reply
    },
    undo: request => call('/api/canvas/undo', 'POST', { expectedRevision: request.expectedRevision }),
    redo: request => call('/api/canvas/redo', 'POST', { expectedRevision: request.expectedRevision }),
  } })
  const originalFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const response = await originalFetch(typeof input === 'string' && input.startsWith('/') ? f.base + input : input, options)
    const body = options?.body && JSON.parse(options.body)
    if (body?.purpose === 'file-import-begin') importToken = (await response.clone().json()).importToken
    if (body?.purpose === 'file-import') {
      saved = await response.clone().json()
      if (mode === 'cancel-first') { entered(); await gate }
      if (mode === 'lost-upload') throw new Error('合成上传回执丢失')
    }
    return response
  })
  const host = createFlattenUpload({ metadata: { persistent: true, conversationId: id, actor }, document: {}, host: {}, format: 'png' })
  const bounds = { x: 20, y: 30, w: 160, h: 90 }
  const interaction = createCanvasInteraction({ session, viewport: { w: 1000, h: 800 }, flatten: {
    ...host, preflight: () => ({ status: 'ready', bounds, width: 320, height: 180, scale: 2 }),
    render: async () => ({ status: 'complete', bounds, width: 320, height: 180, scale: 2, mime: 'image/png', bytes: new Uint8Array(Buffer.from(rasterFiles.png.base64, 'base64')) }),
  } })
  f.beforeClose(() => { release(); interaction.dispose(); session.dispose() })
  interaction.select('all')
  return { ...f, id, interaction, session, reached, release, abortUpload: () => call('/api/canvas/reference', 'POST', { purpose: 'file-import-abort', importToken }), saved: () => saved, commits: () => commits }
}

test('真实HTTP：上传后一次替换、一次撤销重做，清理租约不删历史引用文件', async t => {
  const f = await setup(t), before = await f.workspace.read(f.id)
  const result = await f.interaction.flatten({ type: 'start' })
  assert.equal(result.status, 'complete'); assert.equal(f.commits(), 1)
  let current = await f.workspace.read(f.id)
  assert.equal(current.snapshot.store['shape:source'], undefined)
  assert.equal(current.snapshot.store[result.shapeId].props.assetId, result.assetId)
  await access(f.saved().assetPath)
  await f.session.undo(); current = await f.workspace.read(f.id)
  assert.deepEqual(current.snapshot.store, before.snapshot.store)
  await access(f.saved().assetPath)
  await f.session.redo(); assert.ok((await f.workspace.read(f.id)).snapshot.store[result.shapeId]); await access(f.saved().assetPath)
})

for (const mode of ['cancel-first', 'save-first']) test(`真实HTTP：${mode}交错时源项和文件遵守提交截止边界`, async t => {
  const f = await setup(t, mode), before = await f.workspace.read(f.id)
  const pending = f.interaction.flatten({ type: 'start' })
  await f.reached
  assert.equal(f.interaction.flatten({ type: 'cancel' }), mode === 'cancel-first')
  f.release()
  const result = await pending, current = await f.workspace.read(f.id)
  if (mode === 'cancel-first') {
    assert.equal(result.status, 'cancelled'); assert.equal(f.commits(), 0)
    assert.deepEqual(current, before); assert.deepEqual(await readdir(await f.workspace.assetsDir(f.id)), [])
  } else {
    assert.equal(result.status, 'complete'); assert.equal(f.commits(), 1)
    assert.equal(current.snapshot.store['shape:source'], undefined)
    await access(f.saved().assetPath); await f.session.undo(); await f.session.redo(); await access(f.saved().assetPath)
  }
})

for (const mode of ['abort-before-save', 'save-before-abort']) test(`真实HTTP清理/保存锁交错：${mode}不产生悬空引用或误删已保存文件`, async t => {
  const f = await setup(t, mode), before = await f.workspace.read(f.id)
  const pending = f.interaction.flatten({ type: 'start' })
  await f.reached
  // Explicitly race the actual cleanup endpoint with an actual save. This
  // models an independent abandoned-window cleanup, not a fake UI cancellation.
  const aborted = await f.abortUpload()
  assert.equal(aborted.remaining, 0)
  if (mode === 'abort-before-save') {
    const rejected = assert.rejects(pending, /版本已变化/)
    f.release(); await rejected
    assert.deepEqual(await f.workspace.read(f.id), before)
    assert.deepEqual(await readdir(await f.workspace.assetsDir(f.id)), [])
  } else {
    await access(f.saved().assetPath)
    f.release(); assert.equal((await pending).status, 'complete')
    await f.session.undo(); await f.session.redo(); await access(f.saved().assetPath)
  }
  assert.equal(f.commits(), 1)
})

for (const mode of ['conflict', 'lost-upload', 'lost-save']) test(`真实HTTP：${mode}不重发，失败清理与已保存保护各自成立`, async t => {
  const f = await setup(t, mode)
  await assert.rejects(f.interaction.flatten({ type: 'start' }), mode === 'conflict' ? /版本已变化/ : mode === 'lost-save' ? /结果不确定.*已刷新.*未重发/ : /上传回执丢失/)
  const current = await f.workspace.read(f.id), shapes = Object.values(current.snapshot.store).filter(r => r.typeName === 'shape')
  assert.equal(f.commits(), mode === 'lost-upload' ? 0 : 1)
  if (mode === 'lost-save') {
    assert.equal(shapes.length, 1); assert.equal(shapes[0].type, 'image')
    assert.deepEqual(f.session.store.getStoreSnapshot('document'), current.snapshot)
    await access(f.saved().assetPath); await f.session.undo(); await f.session.redo(); await access(f.saved().assetPath)
  } else {
    assert.ok(current.snapshot.store['shape:source'])
    assert.deepEqual(await readdir(await f.workspace.assetsDir(f.id)), [])
    if (mode === 'conflict') assert.ok(current.snapshot.store['shape:remote'])
  }
})
