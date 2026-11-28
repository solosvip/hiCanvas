import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { captureRecordBasis, getRecordDependencies, createClipboardContent, encodeClipboardContent, createEditorSession, createCanvasInteraction } from '../engine/index.js'
import { fixture } from './test-helpers.mjs'
import { httpSessionTransport } from './fixtures/editor-session-http-fixture.mjs'

const basisFor = (snapshot, commands) => captureRecordBasis(snapshot, getRecordDependencies(snapshot, commands))
async function setup(t) {
  const f = await fixture(t), { id } = await f.workspace.open({ title: '合成剪贴板记录条件' })
  const query = `?conversation=${id}`
  const read = async () => (await f.api('/api/canvas' + query)).body
  const post = (path, body, actor = 'ui:clipboard') => f.api(path + query, 'POST', body, { 'x-hicanvas-actor': actor })
  const remote = async operations => {
    const response = await post('/api/canvas/operations', { expectedRevision: (await read()).revision, operations }, 'remote:239')
    assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body
  }
  await remote([
    { type: 'create_shape', id: 'shape:frame', shapeType: 'frame' },
    { type: 'create_shape', id: 'shape:source', shapeType: 'geo', parentId: 'shape:frame' },
    { type: 'create_shape', id: 'shape:other', shapeType: 'geo', x: 1000 },
  ])
  return { ...f, id, read, post, remote, initial: await read() }
}

test('真实HTTP：复制跨过无关远端版本返回原内容，不写文档或历史', async t => {
  const f = await setup(t), intent = [{ type: 'copy_content', ids: ['shape:source'] }]
  const recordBasis = basisFor(f.initial.snapshot, intent)
  await f.remote([{ type: 'update', id: 'shape:other', changes: { x: 1234 } }])
  const current = await f.read()
  const reply = await f.post('/api/canvas/clipboard/copy', { ids: ['shape:source'], expectedRevision: f.initial.revision, recordBasis })
  assert.equal(reply.status, 200, JSON.stringify(reply.body))
  assert.deepEqual(reply.body.rootIds, ['shape:source'])
  assert.equal(reply.body.shapes[0].x, f.initial.snapshot.store['shape:source'].x)
  assert.deepEqual(await f.read(), current, '只读复制不改变版本或远端文档')
})

for (const [name, operations] of [
  ['对象', [{ type: 'update', id: 'shape:source', changes: { x: 30 } }]],
  ['祖先', [{ type: 'update', id: 'shape:frame', changes: { isLocked: true } }]],
  ['新成员', [{ type: 'create_shape', id: 'shape:late', shapeType: 'geo', parentId: 'shape:source' }]],
]) test(`真实HTTP：复制拒绝${name}变化，不把旧内容当成已确认`, async t => {
  const f = await setup(t), recordBasis = basisFor(f.initial.snapshot, [{ type: 'copy_content', ids: ['shape:source'] }])
  await f.remote(operations)
  const before = await f.read()
  const reply = await f.post('/api/canvas/clipboard/copy', { ids: ['shape:source'], expectedRevision: f.initial.revision, recordBasis })
  assert.equal(reply.status, 409, JSON.stringify(reply.body))
  assert.deepEqual(await f.read(), before)
})

for (const action of ['cut', 'paste']) test(`真实HTTP：${action}允许无关变化，撤销只回退本次操作`, async t => {
  const f = await setup(t), content = createClipboardContent(f.initial.snapshot, ['shape:source'], { boardId: f.id })
  const commands = action === 'cut' ? [{ type: 'delete', ids: ['shape:source'] }] : [{ type: 'paste_content', content, parentId: 'shape:frame', offset: { x: 40, y: 20 } }]
  const recordBasis = basisFor(f.initial.snapshot, commands)
  await f.remote([{ type: 'update', id: 'shape:other', changes: { x: 4321 } }])
  const before = await f.read(), path = action === 'cut' ? '/api/canvas/operations' : '/api/canvas/clipboard/paste'
  const reply = await f.post(path, { expectedRevision: f.initial.revision, ...(action === 'cut' ? { operations: commands } : { commands }), recordBasis })
  assert.equal(reply.status, 200, JSON.stringify(reply.body))
  assert.equal(reply.body.snapshot.store['shape:other'].x, 4321)
  if (action === 'cut') assert.equal(reply.body.snapshot.store['shape:source'], undefined)
  else {
    assert.equal(reply.body.results[0].rootIds.length, 1)
    assert.equal(reply.body.snapshot.store[reply.body.results[0].rootIds[0]].parentId, 'shape:frame')
  }
  const undone = await f.post('/api/canvas/undo', { expectedRevision: reply.body.revision })
  assert.equal(undone.status, 200, JSON.stringify(undone.body))
  assert.deepEqual(undone.body.snapshot, before.snapshot)
})

for (const action of ['copy', 'cut', 'paste']) test(`真实HTTP会话：${action}等待私有端口期间允许远处更新`, { timeout: 5000 }, async t => {
  const f = await setup(t), transport = httpSessionTransport(f.base, f.id)
  const session = await createEditorSession({ transport, actor: 'ui:clipboard' })
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), reached = new Promise(resolve => { entered = resolve })
  const formats = encodeClipboardContent(createClipboardContent(f.initial.snapshot, ['shape:source'], { boardId: f.id }))
  let writes = 0
  const ui = createCanvasInteraction({ session, viewport: { w: 1200, h: 800 }, boardId: f.id, clipboard: {
    copyContent: args => transport.copyContent(args),
    async read() { entered(); await gate; return formats },
    async write() { writes++; entered(); await gate },
  } })
  f.beforeClose(() => { release(); ui.dispose(); session.dispose() })
  ui.select('first'); ui.select('child')
  assert.deepEqual(ui.state.get().selectedIds, ['shape:source'])
  const pending = ui.runAction(action)
  await reached
  await f.remote([{ type: 'update', id: 'shape:other', changes: { x: 2345 } }]); await session.refresh()
  release()
  assert.equal((await pending).status, action === 'copy' ? 'copied' : 'applied')
  assert.equal(transport.commits.length, action === 'copy' ? 0 : 1)
  assert.equal(writes, action === 'paste' ? 0 : 1)
  assert.equal((await f.read()).snapshot.store['shape:other'].x, 2345)
})

async function editing(t, f, port) {
  const transport = httpSessionTransport(f.base, f.id), session = await createEditorSession({ transport, actor: 'ui:clipboard' })
  const ui = createCanvasInteraction({ session, viewport: { w: 1200, h: 800 }, boardId: f.id, clipboard: { copyContent: args => transport.copyContent(args), ...port } })
  f.beforeClose(() => { ui.dispose(); session.dispose() })
  ui.select('first'); ui.select('child'); assert.deepEqual(ui.state.get().selectedIds, ['shape:source'])
  return { transport, session, ui }
}

test('真实HTTP剪切：私有剪贴板写失败，源对象保留且零删除请求', async t => {
  const f = await setup(t), before = await f.read()
  let writes = 0
  const e = await editing(t, f, { async write() { writes++; throw new Error('private clipboard denied') } })
  await assert.rejects(e.ui.runAction('cut'), /private clipboard denied/)
  assert.equal(writes, 1); assert.equal(e.transport.commits.length, 0)
  assert.deepEqual(await f.read(), before)
})

for (const action of ['cut', 'paste']) for (const related of [false, true]) test(`真实HTTP最后竞态：${action} ${related ? '相关拒绝' : '无关成功'}，只发送一次`, async t => {
  const f = await setup(t), formats = encodeClipboardContent(createClipboardContent(f.initial.snapshot, ['shape:source'], { boardId: f.id }))
  let writes = 0
  const e = await editing(t, f, { async write() { writes++ }, async read() { return formats } })
  const commit = e.transport.commit
  let current
  e.transport.commit = async request => {
    current = await f.remote([{ type: 'update', id: related ? action === 'paste' ? 'shape:frame' : 'shape:source' : 'shape:other', changes: { x: 4567 } }])
    return commit(request)
  }
  if (related) {
    await assert.rejects(e.ui.runAction(action), { code: 'conflict' })
    assert.deepEqual((await f.read()).snapshot, current.snapshot)
  } else {
    assert.equal((await e.ui.runAction(action)).status, 'applied')
    assert.equal((await f.read()).snapshot.store['shape:other'].x, 4567)
  }
  assert.equal(e.transport.commits.length, 1)
  assert.equal(writes, action === 'cut' ? 1 : 0, '剪切失败后不清空已经写入的内容')
  assert.deepEqual(e.session.store.getStoreSnapshot(), (await f.read()).snapshot)
})

for (const [label, operations] of [
  ['移动', [{ type: 'update', id: 'shape:frame', changes: { x: 10 } }]],
  ['锁定', [{ type: 'update', id: 'shape:frame', changes: { isLocked: true } }]],
  ['换父', [{ type: 'create_shape', id: 'shape:new-parent', shapeType: 'frame' }, { type: 'update', id: 'shape:frame', changes: { parentId: 'shape:new-parent' } }]],
  ['删除', [{ type: 'delete', ids: ['shape:frame'] }]],
]) test(`真实HTTP：粘贴原父容器${label}后拒绝，不能重新认领目标`, async t => {
  const f = await setup(t), content = createClipboardContent(f.initial.snapshot, ['shape:source'], { boardId: f.id })
  const commands = [{ type: 'paste_content', content, parentId: 'shape:frame', offset: { x: 20, y: 30 } }], recordBasis = basisFor(f.initial.snapshot, commands)
  await f.remote(operations); const before = await f.read()
  const reply = await f.post('/api/canvas/clipboard/paste', { expectedRevision: f.initial.revision, commands, recordBasis })
  assert.equal(reply.status, 409, JSON.stringify(reply.body)); assert.deepEqual(await f.read(), before)
})

test('真实HTTP会话：读取期间新出现的框不改变开始时粘贴的父容器与落点', async t => {
  const f = await setup(t)
  const content = createClipboardContent(f.initial.snapshot, ['shape:source'], { boardId: 'another-synthetic-board' })
  let entered, release
  const reached = new Promise(r => { entered = r }), gate = new Promise(r => { release = r })
  const e = await editing(t, f, { async read() { entered(); await gate; return encodeClipboardContent(content) } })
  f.beforeClose(release)
  e.ui.runAction('paste-at-cursor')
  e.ui.dispatch({ type: 'pointer_move', point: { x: 4000, y: 3000 }, pointerId: 1, time: 1 })
  const pending = e.ui.runAction('paste'); await reached
  await f.remote([{ type: 'create_shape', id: 'shape:late-frame', shapeType: 'frame', x: 3800, y: 2800, props: { w: 300, h: 300 } }]); await e.session.refresh()
  release(); const result = await pending, saved = await f.read(), pasted = saved.snapshot.store[result.reply.results[0].rootIds[0]]
  assert.equal(pasted.parentId, Object.values(f.initial.snapshot.store).find(r => r.typeName === 'page').id)
  assert.deepEqual([pasted.x + pasted.props.w / 2, pasted.y + pasted.props.h / 2], [4000, 3000])
  assert.equal(e.transport.commits.length, 1)
})

const bind = (id, fromId, toId, terminal = 'end') => ({ type: 'put', record: { id: `binding:${id}`, typeName: 'binding', type: 'arrow', fromId, toId, props: { terminal, normalizedAnchor: { x: .5, y: .5 }, isExact: false, isPrecise: true, snap: 'none' }, meta: {} } })
for (const action of ['copy', 'cut']) for (const change of ['binding', 'endpoint', 'new-binding']) test(`真实HTTP：${action}闭包保护外部箭头${change}`, async t => {
  const f = await setup(t)
  await f.remote([{ type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', x: 300 }, bind('old', 'shape:arrow', action === 'copy' ? 'shape:other' : 'shape:source')])
  const initial = await f.read(), ids = [action === 'copy' ? 'shape:arrow' : 'shape:source'], commands = [{ type: action === 'copy' ? 'copy_content' : 'delete', ids }], recordBasis = basisFor(initial.snapshot, commands)
  const operations = change === 'binding' ? [{ type: 'update', id: 'binding:old', changes: { props: { normalizedAnchor: { x: .2, y: .8 } } } }] : change === 'endpoint' ? [{ type: 'update', id: action === 'copy' ? 'shape:other' : 'shape:arrow', changes: { x: 3200 } }] : [bind('late', 'shape:arrow', action === 'copy' ? 'shape:source' : 'shape:source', 'start')]
  await f.remote(operations); const before = await f.read()
  const reply = await f.post(action === 'copy' ? '/api/canvas/clipboard/copy' : '/api/canvas/operations', { expectedRevision: initial.revision, recordBasis, ...(action === 'copy' ? { ids } : { operations: commands }) })
  assert.equal(reply.status, 409, JSON.stringify(reply.body)); assert.deepEqual(await f.read(), before)
})

for (const change of ['remaining-child', 'new-child']) test(`真实HTTP：剪切自动解组保护${change}，正常删除一次撤销恢复组`, async t => {
  const f = await setup(t)
  await f.remote([{ type: 'create_shape', id: 'shape:group', shapeType: 'group', parentId: 'shape:frame' }, { type: 'create_shape', id: 'shape:sibling', shapeType: 'geo', parentId: 'shape:group' }, { type: 'update', id: 'shape:source', changes: { parentId: 'shape:group' } }])
  const initial = await f.read(), commands = [{ type: 'delete', ids: ['shape:source'] }], recordBasis = basisFor(initial.snapshot, commands)
  const okay = await f.post('/api/canvas/operations', { expectedRevision: initial.revision, operations: commands, recordBasis })
  assert.equal(okay.status, 200, JSON.stringify(okay.body)); assert.equal(okay.body.snapshot.store['shape:group'], undefined)
  const undo = await f.post('/api/canvas/undo', { expectedRevision: okay.body.revision }); assert.equal(undo.status, 200); assert.deepEqual(undo.body.snapshot, initial.snapshot)
  await f.remote(change === 'new-child' ? [{ type: 'create_shape', id: 'shape:late', shapeType: 'geo', parentId: 'shape:group' }] : [{ type: 'update', id: 'shape:sibling', changes: { x: 42 } }])
  const before = await f.read(), refused = await f.post('/api/canvas/operations', { expectedRevision: initial.revision, operations: commands, recordBasis })
  assert.equal(refused.status, 409, JSON.stringify(refused.body)); assert.deepEqual(await f.read(), before)
})

for (const action of ['cut', 'paste']) for (const change of ['peer', 'membership']) test(`真实HTTP：${action}保护Slides排版的${change}依赖`, async t => {
  const f = await setup(t)
  await f.remote([
    { type: 'create_shape', id: 'shape:deck', shapeType: 'frame', meta: { cowartAiSlides: true } },
    { type: 'create_shape', id: 'shape:p1', shapeType: 'image', parentId: 'shape:deck', props: { w: 240, h: 140 } },
    { type: 'create_shape', id: 'shape:p2', shapeType: 'image', parentId: 'shape:deck', props: { w: 320, h: 180 } },
  ])
  const initial = await f.read(), commands = action === 'cut' ? [{ type: 'delete', ids: ['shape:p1'] }] : [{ type: 'paste_content', parentId: 'shape:deck', content: createClipboardContent(initial.snapshot, ['shape:p1']), offset: { x: 300, y: 0 } }]
  const recordBasis = basisFor(initial.snapshot, commands)
  await f.remote(change === 'peer' ? [{ type: 'update', id: 'shape:p2', changes: { props: { h: 220 } } }] : [{ type: 'create_shape', id: 'shape:late-slide', shapeType: 'image', parentId: 'shape:deck', props: { w: 180, h: 120 } }])
  const before = await f.read(), reply = await f.post(action === 'cut' ? '/api/canvas/operations' : '/api/canvas/clipboard/paste', { expectedRevision: initial.revision, recordBasis, ...(action === 'cut' ? { operations: commands } : { commands }) })
  assert.equal(reply.status, 409, JSON.stringify(reply.body)); assert.deepEqual(await f.read(), before)
})

test('真实HTTP：伪造缺少绑定/成员的基线不能给剪切放行，旧无条件粘贴仍严格版本', async t => {
  const f = await setup(t), commands = [{ type: 'delete', ids: ['shape:source'] }], complete = basisFor(f.initial.snapshot, commands)
  for (const kind of ['children', 'bindings-from', 'bindings-to']) {
    const recordBasis = { ...complete, memberships: complete.memberships.filter(query => query.kind !== kind) }
    const reply = await f.post('/api/canvas/operations', { expectedRevision: f.initial.revision, operations: commands, recordBasis })
    assert.equal(reply.status, 400); assert.deepEqual(await f.read(), f.initial)
  }
  const content = createClipboardContent(f.initial.snapshot, ['shape:source'])
  await f.remote([{ type: 'update', id: 'shape:other', changes: { x: 5000 } }])
  const current = await f.read(), reply = await f.post('/api/canvas/clipboard/paste', { expectedRevision: f.initial.revision, commands: [{ type: 'paste_content', content }] })
  assert.equal(reply.status, 409); assert.deepEqual(await f.read(), current)
})
