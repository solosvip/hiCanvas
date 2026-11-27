import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './test-helpers.mjs'

test('HTTP 排版、版本门禁、锁原因、保存重读和单次撤销重做', async t => {
  const { api } = await fixture(t)
  const opened = await api('/api/conversations/open', 'POST', { createNew: true, title: '合成 Slides 事务' })
  const query = `?conversation=${opened.body.conversation.id}`, headers = { 'x-hicanvas-actor': 'slides:synthetic' }
  const read = async () => (await api('/api/canvas' + query)).body
  const operate = (revision, operations) => api('/api/canvas/operations' + query, 'POST', { expectedRevision: revision, operations }, headers)
  const initial = await read()
  let reply = await operate(initial.revision, [{ type: 'create_shape', id: 'shape:d', shapeType: 'frame', props: { w: 280, h: 180 }, meta: { cowartAiSlides: true } }])
  assert.equal(reply.status, 200)
  const empty = await read()
  reply = await operate(empty.revision, ['a', 'b', 'c'].map((id, i) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'image', parentId: 'shape:d', x: i * 400, props: { w: 240, h: 140 } })))
  assert.equal(reply.status, 200)
  const filled = await read()
  assert.deepEqual(['a', 'b', 'c'].map(id => filled.snapshot.store[`shape:${id}`].x), [12, 284, 556])
  assert.equal(filled.snapshot.store['shape:d'].props.w, 1048)
  assert.notEqual(filled.revision, empty.revision)
  const stale = await operate(empty.revision, [{ type: 'delete', ids: ['shape:b'] }])
  assert.equal(stale.status, 409)
  assert.deepEqual(await read(), filled)
  const undone = await api('/api/canvas/undo' + query, 'POST', { expectedRevision: filled.revision }, headers)
  assert.equal(undone.status, 200)
  assert.deepEqual((await read()).snapshot, empty.snapshot)
  const redone = await api('/api/canvas/redo' + query, 'POST', { expectedRevision: undone.body.revision }, headers)
  assert.equal(redone.status, 200)
  assert.deepEqual((await read()).snapshot, filled.snapshot)
  reply = await operate(redone.body.revision, [{ type: 'toggle_lock', ids: ['shape:b'] }])
  assert.equal(reply.status, 200)
  const locked = await read()
  const rejected = await operate(locked.revision, [{ type: 'delete', ids: ['shape:a'] }])
  assert.equal(rejected.status, 400)
  assert.equal(rejected.body.code, 'slides-layout-locked')
  assert.match(rejected.body.error, /幻灯片里有锁定的页，无法重新排版/)
  assert.deepEqual(await read(), locked, '拒绝后不产生新版本，也不删掉任何记录')
  const invalid = await operate(locked.revision, [{ type: 'unknown-synthetic-command' }])
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.code, 'invalid-input')
  assert.match(invalid.body.error, /未知的画板操作/)
  assert.deepEqual(await read(), locked)
})


test('HTTP 新建提示页同次版本自动收纳；明确父级优先且无需旧界面计时器', async t => {
  const { api } = await fixture(t)
  const opened = await api('/api/conversations/open', 'POST', { createNew: true, title: '合成生成页自动收纳' })
  const query = `?conversation=${opened.body.conversation.id}`
  const read = async () => (await api('/api/canvas' + query)).body
  const operate = (revision, operations) => api('/api/canvas/operations' + query, 'POST', { expectedRevision: revision, operations })
  let state = await read()
  const created = await operate(state.revision, [{ type: 'create_shape', id: 'shape:d', shapeType: 'frame', props: { w: 280, h: 180 }, meta: { cowartAiSlides: true } }, { type: 'create_shape', id: 'shape:ordinary', shapeType: 'frame' }])
  assert.equal(created.status, 200)
  state = await read()
  const inserted = await operate(state.revision, [{ type: 'create_shape', id: 'shape:auto', shapeType: 'image', x: 700, y: 400, props: { w: 240, h: 140 }, meta: { cowartAiSlidesParentShapeId: 'shape:d' } }])
  assert.equal(inserted.status, 200)
  let saved = await read()
  assert.equal(saved.revision, inserted.body.revision, '没有另一次计时器提交')
  assert.notEqual(saved.revision, state.revision)
  assert.equal(saved.snapshot.store['shape:auto'].parentId, 'shape:d')
  assert.deepEqual([saved.snapshot.store['shape:auto'].x, saved.snapshot.store['shape:auto'].y], [12, 12])
  assert.deepEqual([saved.snapshot.store['shape:d'].props.w, saved.snapshot.store['shape:d'].props.h], [1048, 600])
  const deckBefore = structuredClone(saved.snapshot.store['shape:d'])
  const explicit = await operate(saved.revision, [
    { type: 'create_shape', id: 'shape:explicit-page', shapeType: 'image', parentId: 'page:page', x: 900, y: 400, props: { w: 240, h: 140 }, meta: { cowartAiSlidesParentShapeId: 'shape:d' } },
    { type: 'create_shape', id: 'shape:explicit-frame', shapeType: 'image', parentId: 'shape:ordinary', x: 30, y: 40, props: { w: 240, h: 140 }, meta: { cowartAiSlidesParentShapeId: 'shape:d' } },
  ])
  assert.equal(explicit.status, 200)
  saved = await read()
  assert.equal(saved.revision, explicit.body.revision)
  assert.equal(saved.snapshot.store['shape:explicit-page'].parentId, 'page:page')
  assert.equal(saved.snapshot.store['shape:explicit-frame'].parentId, 'shape:ordinary')
  assert.equal(saved.snapshot.store['shape:explicit-page'].meta.cowartAiSlidesParentShapeId, undefined)
  assert.equal(saved.snapshot.store['shape:explicit-frame'].meta.cowartAiSlidesParentShapeId, undefined)
  assert.deepEqual(saved.snapshot.store['shape:d'], deckBefore)
})
