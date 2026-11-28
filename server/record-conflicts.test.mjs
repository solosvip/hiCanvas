import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { captureRecordBasis, getRecordDependencies, createEditorSession, createCanvasInteraction } from '../engine/index.js'
import { fixture } from './test-helpers.mjs'
import { httpSessionTransport } from './fixtures/editor-session-http-fixture.mjs'

const link = { type: 'set_shape_link', id: 'shape:target', url: 'https://example.invalid/new' }
async function setup(t) {
  const f = await fixture(t), board = await f.workspace.open({ createNew: true, title: '合成记录冲突' }), id = board.id
  const first = await f.workspace.read(id)
  const initial = await f.workspace.submitCommands(id, first.revision, 'seed', () => [
    { type: 'create_shape', id: 'shape:parent', shapeType: 'frame' },
    { type: 'create_shape', id: 'shape:target', shapeType: 'geo', parentId: 'shape:parent' },
    { type: 'create_shape', id: 'shape:other', shapeType: 'geo' },
  ])
  const path = `/api/canvas/operations?conversation=${id}`
  const remote = async commands => f.workspace.submitCommands(id, (await f.workspace.read(id)).revision, 'remote', () => commands)
  return { ...f, id, initial, remote, post: body => f.api(path, 'POST', body, { 'x-hicanvas-actor': 'ui:basis' }) }
}
const basisFor = (snapshot, commands) => captureRecordBasis(snapshot, getRecordDependencies(snapshot, commands))

test('真实HTTP：旧整板版本配完整记录条件，无关远端写入仍一次保存且撤销不抹远端', async t => {
  const f = await setup(t), recordBasis = basisFor(f.initial.snapshot, [link])
  await f.remote([{ type: 'update', id: 'shape:other', changes: { x: 777 } }])
  const reply = await f.post({ expectedRevision: f.initial.revision, operations: [link], recordBasis })
  assert.equal(reply.status, 200, JSON.stringify(reply.body))
  assert.ok(Array.isArray(reply.body.results), '带记录条件的宿主需要完整命令回执')
  assert.equal(reply.body.snapshot.store['shape:target'].props.url, link.url)
  assert.equal(reply.body.snapshot.store['shape:other'].x, 777)
  const undone = await f.workspace.undo(f.id, reply.body.revision, 'ui:basis')
  assert.equal(undone.snapshot.store['shape:target'].props.url, '')
  assert.equal(undone.snapshot.store['shape:other'].x, 777)
})

test('旧HTTP成功回执不增加results；带记录条件才扩展命令回执', async t => {
  const f = await setup(t)
  const legacy = await f.post({ expectedRevision: f.initial.revision, operations: [link] })
  assert.equal(legacy.status, 200)
  assert.equal(legacy.body.results, undefined)
  const commands = [{ ...link, url: 'https://example.invalid/next' }]
  const current = await f.workspace.read(f.id)
  const guarded = await f.post({ expectedRevision: current.revision, operations: commands, recordBasis: basisFor(current.snapshot, commands) })
  assert.equal(guarded.status, 200)
  assert.ok(Array.isArray(guarded.body.results))
})

for (const change of ['target', 'ancestor']) test(`真实HTTP：${change}变化409，不改变文档/版本或创建本地历史`, async t => {
  const f = await setup(t), recordBasis = basisFor(f.initial.snapshot, [link])
  await f.remote([{ type: 'update', id: change === 'target' ? 'shape:target' : 'shape:parent', changes: { x: 99 } }])
  const before = await f.workspace.read(f.id)
  const reply = await f.post({ expectedRevision: before.revision, operations: [link], recordBasis })
  assert.equal(reply.status, 409)
  assert.deepEqual(await f.workspace.read(f.id), before)
  await assert.rejects(f.workspace.undo(f.id, before.revision, 'ui:basis'))
})
test('真实HTTP：没有基线仍严格版本，缺版本428；错误/漏祖先/未知动作均明确拒绝', async t => {
  const f = await setup(t), recordBasis = basisFor(f.initial.snapshot, [link])
  await f.remote([{ type: 'update', id: 'shape:other', changes: { x: 1 } }])
  assert.equal((await f.post({ expectedRevision: f.initial.revision, operations: [link] })).status, 409)
  assert.equal((await f.post({ operations: [link], recordBasis })).status, 428)
  const current = await f.workspace.read(f.id)
  const partial = structuredClone(recordBasis); partial.records = partial.records.filter(([id]) => id !== 'shape:parent')
  for (const body of [
    { operations: [link], recordBasis: partial },
    { operations: [link], recordBasis: null },
    { operations: [{ type: 'delete', ids: ['shape:target'] }], recordBasis },
  ]) {
    const result = await f.post({ expectedRevision: current.revision, ...body })
    assert.equal(result.status, 400)
    assert.deepEqual(await f.workspace.read(f.id), current)
  }
})

async function dialog(t, kind) {
  const f = await setup(t)
  let id = 'shape:target'
  if (kind === 'alt') {
    const result = await f.remote([{ type: 'insert_image', args: { x: 400, y: 200, avoidOverlap: false }, image: { src: 'https://example.invalid/synthetic.png', w: 80, h: 60, mimeType: 'image/png' } }])
    id = result.results[0].shapeId
  }
  if (kind === 'convert') {
    const result = await f.remote([{ type: 'insert_url', url: 'https://youtu.be/demo', point: { x: 800, y: 800 } }])
    id = result.results[0].shapeId
  }
  const transport = httpSessionTransport(f.base, f.id), session = await createEditorSession({ transport, actor: 'ui:dialog' })
  const ui = createCanvasInteraction({ session, edgeScrolling: false, viewport: { w: 1280, h: 800 } })
  f.beforeClose(() => { ui.dispose(); session.dispose() })
  await transport.ready
  if (kind !== 'new-embed') {
    ui.select('first')
    for (let i = 0; i < 10 && ui.state.get().selectedIds[0] !== id; i++) ui.select('next')
    // A frame child needs the public child-navigation action.
    if (kind === 'link' && ui.state.get().selectedIds[0] !== id) { ui.select('first'); ui.select('child') }
    assert.deepEqual(ui.state.get().selectedIds, [id])
  }
  let submit
  if (kind === 'alt') { ui.imageAlt({ type: 'start' }); ui.imageAlt({ type: 'update', text: '新描述231' }); submit = () => ui.imageAlt({ type: 'finish' }) }
  if (kind === 'link') { ui.link({ type: 'open' }); ui.link({ type: 'update', url: 'example.invalid/confirmed' }); submit = () => ui.link({ type: 'submit' }) }
  if (kind === 'new-embed') {
    ui.embed({ type: 'open' }); ui.embed({ type: 'service', serviceId: 'G13' }); ui.embed({ type: 'update', url: 'https://youtu.be/demo' })
    submit = () => ui.embed({ type: 'submit' })
    id = Object.values(session.store.getStoreSnapshot().store).find(record => record.typeName === 'page').id
  }
  if (kind === 'convert') { const intent = ui.embed({ type: 'conversion-intent', to: 'bookmark' }); assert.ok(intent); submit = () => ui.embed(intent) }
  return { ...f, transport, session, ui, submit, targetId: id }
}

for (const kind of ['new-embed', 'convert', 'alt', 'link']) for (const related of [false, true]) {
  test(`真实HTTP最后竞态：${kind} ${related ? '目标变化拒绝' : '无关变化成功'}，修改请求恰好一次`, async t => {
    const f = await dialog(t, kind), commit = f.transport.commit, requests = []
    f.transport.commit = async request => {
      requests.push(structuredClone(request))
      // No event broadcast: the window has passed its check but has not sent HTTP.
      await f.remote([{ type: 'update', id: related ? f.targetId : 'shape:other', changes: related && kind === 'new-embed' ? { name: '页面被远端修改' } : { x: 987 } }])
      return commit(request)
    }
    if (related) {
      await assert.rejects(f.submit(), { code: 'conflict' })
      const current = await f.workspace.read(f.id)
      assert.deepEqual(f.session.store.getStoreSnapshot(), current.snapshot)
      if (kind === 'alt') assert.equal(f.ui.state.get().imageAltEditing.text, '新描述231')
      if (kind === 'link') assert.equal(f.ui.state.get().linkEditing.url, 'example.invalid/confirmed')
      if (kind === 'new-embed') assert.ok(f.ui.state.get().embedEditing)
      await assert.rejects(f.workspace.undo(f.id, current.revision, 'ui:dialog'))
    } else {
      const result = await f.submit()
      assert.equal(result.snapshot.store['shape:other'].x, 987)
      assert.deepEqual(f.session.store.getStoreSnapshot(), (await f.workspace.read(f.id)).snapshot)
      const undone = await f.workspace.undo(f.id, result.revision, 'ui:dialog')
      assert.equal(undone.snapshot.store['shape:other'].x, 987)
      const redone = await f.workspace.redo(f.id, undone.revision, 'ui:dialog')
      assert.deepEqual(redone.snapshot, result.snapshot)
    }
    assert.equal(requests.length, 1)
    assert.ok(requests[0].recordBasis)
    assert.equal(f.transport.commits.length, 1)
  })
}
for (const kind of ['new-embed', 'alt', 'link']) test(`真实HTTP：${kind}保存回执丢失后刷新实际快照，不重发`, async t => {
  const f = await dialog(t, kind), commit = f.transport.commit
  let requests = 0
  f.transport.commit = async request => { requests++; await commit(request); throw new Error('合成回执丢失231') }
  await assert.rejects(f.submit(), /合成回执丢失231/)
  const current = await f.workspace.read(f.id)
  assert.equal(requests, 1)
  assert.deepEqual(f.session.store.getStoreSnapshot(), current.snapshot)
  const undone = await f.workspace.undo(f.id, current.revision, 'ui:dialog')
  await assert.rejects(f.workspace.undo(f.id, undone.revision, 'ui:dialog'))
})

for (const related of [false, true]) test(`排队后复核：${related ? '目标更新不发送' : '无关更新用最新确认版本发送一次'}`, async t => {
  const f = await dialog(t, 'link'), read = f.transport.read
  let release, entered
  const waiting = new Promise(resolve => { entered = resolve }), gate = new Promise(resolve => { release = resolve })
  f.transport.read = async () => { entered(); await gate; return read() }
  const refresh = f.session.refresh(); await waiting
  const commands = [{ type: 'set_shape_link', id: f.targetId, url: 'https://example.invalid/queued' }]
  const recordBasis = basisFor(f.session.store.getStoreSnapshot(), commands), requests = [], commit = f.transport.commit
  f.transport.commit = async request => { requests.push(structuredClone(request)); return commit(request) }
  const pending = f.session.commitCommands(commands, { recordBasis })
  const outcome = pending.then(value => ({ value }), error => ({ error }))
  const remote = await f.remote([{ type: 'update', id: related ? f.targetId : 'shape:other', changes: { x: 456 } }])
  release(); await refresh
  const result = await outcome
  if (related) { assert.equal(result.error?.code, 'conflict'); assert.equal(requests.length, 0) }
  else { assert.ok(result.value); assert.equal(requests.length, 1); assert.equal(requests[0].expectedRevision, remote.revision) }
  assert.deepEqual(f.session.store.getStoreSnapshot(), (await f.workspace.read(f.id)).snapshot)
})
test('带记录条件的回执必须给实际保存快照；缺失时只刷新一次不重发', async t => {
  const f = await dialog(t, 'link'), commit = f.transport.commit
  let attempts = 0
  f.transport.commit = async request => { attempts++; const { snapshot: _snapshot, ...reply } = await commit(request); return reply }
  await assert.rejects(f.submit(), { code: 'invalid-record-basis' })
  assert.equal(attempts, 1)
  assert.deepEqual(f.session.store.getStoreSnapshot(), (await f.workspace.read(f.id)).snapshot)
})
