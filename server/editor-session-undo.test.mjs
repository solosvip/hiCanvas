import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { createEditorSession } from '../engine/index.js'
import { fixture } from './test-helpers.mjs'
import { httpSessionTransport } from './fixtures/editor-session-http-fixture.mjs'
import { memoryHost, shape, update, snapshotOf } from './fixtures/editor-session-fixture.mjs'

async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(5) }
  assert.fail('撤销广播未到达另一运行时')
}
async function open(t, adapt = value => value) {
  const f = await fixture(t)
  const { body } = await f.api('/api/conversations/open', 'POST', { title: '合成运行时撤销' })
  const id = body.conversation.id, actor = 'ui:synthetic-undo'
  const transport = httpSessionTransport(f.base, id)
  const session = await createEditorSession({ transport: adapt(transport), actor })
  f.beforeClose(() => session.dispose())
  return { ...f, id, actor, transport, session }
}
async function gesture(session, commands) {
  session.beginGesture(); session.preview(commands)
  return session.commitGesture()
}

test('HTTP 运行时：手势只记一次，窗口重开仍可撤销；撤销重做广播给其他窗口', async t => {
  const f = await open(t)
  await f.transport.ready
  const observerTransport = httpSessionTransport(f.base, f.id)
  const observer = await createEditorSession({ transport: observerTransport, actor: 'ui:observer' })
  f.beforeClose(() => observer.dispose())
  await observerTransport.ready
  await gesture(f.session, [shape('drag')])
  f.session.beginGesture()
  for (let x = 1; x <= 20; x++) f.session.preview([update('drag', { x: x / 3, y: x / 7 })])
  const saved = await f.session.commitGesture()
  await waitFor(() => observer.state.get().revision === saved.revision)
  f.session.dispose()
  const replacementTransport = httpSessionTransport(f.base, f.id)
  const replacement = await createEditorSession({ transport: replacementTransport, actor: f.actor })
  f.beforeClose(() => replacement.dispose())
  await replacementTransport.ready
  const undo = await replacement.undo()
  assert.equal(replacement.store.get('shape:drag').x, 0)
  assert.equal(replacement.store.get('shape:drag').y, 0)
  await waitFor(() => observer.state.get().revision === undo.revision)
  assert.deepEqual(snapshotOf(observer), snapshotOf(replacement))
  const redo = await replacement.redo()
  await waitFor(() => observer.state.get().revision === redo.revision)
  assert.deepEqual(snapshotOf(replacement), saved.snapshot)
  assert.deepEqual(snapshotOf(observer), saved.snapshot)
  assert.equal(replacement.state.get().lastError, null)
  await replacement.undo(); await replacement.undo()
  assert.equal(replacement.store.has('shape:drag'), false)
})

test('撤销和重做接口可选，旧宿主照常提交，调用缺失接口时明确报错', async t => {
  const host = memoryHost(), session = await createEditorSession({ transport: host.transport, actor: 'ui:old' })
  t.after(() => session.dispose())
  await gesture(session, [shape('old')])
  for (const direction of ['undo', 'redo']) {
    await assert.rejects(session[direction](), error => error.code === 'unsupported' && /宿主.*不支持/.test(error.message))
    assert.equal(session.state.get().lastError.code, 'unsupported')
  }
  assert.equal(session.store.has('shape:old'), true)
  assert.equal(session.state.get().isSubmitting, false)
})

test('运行时撤销不抢占手势，执行时拒绝其他写入；关闭后迟到结果不再写存储', async t => {
  const host = memoryHost(), entered = Promise.withResolvers(), release = Promise.withResolvers()
  let calls = 0
  const session = await createEditorSession({ actor: 'ui:busy', transport: {
    ...host.transport,
    async undo() { calls++; entered.resolve(); await release.promise; return host.current() },
  } })
  t.after(() => { release.resolve(); session.dispose() })
  session.beginGesture(); session.preview([shape('preview')])
  await assert.rejects(session.undo(), { code: 'busy' })
  assert.equal(calls, 0)
  assert.equal(session.store.has('shape:preview'), true)
  session.cancelGesture()
  const pending = session.undo()
  await entered.promise
  assert.equal(session.state.get().isSubmitting, true)
  assert.throws(() => session.beginGesture(), { code: 'busy' })
  await assert.rejects(session.undo(), { code: 'busy' })
  session.dispose(); release.resolve()
  await assert.rejects(pending, { code: 'disposed' })
  assert.equal(calls, 1)
})

test('撤销已经保存但回复丢失时重读服务，不重复撤销；随后仍能重做', async t => {
  let calls = 0
  const f = await open(t, transport => ({ ...transport, subscribe: () => () => {}, async undo(request) {
    calls++; await transport.undo(request); throw Object.assign(new Error('合成丢失回复'), { code: 'transport' })
  } }))
  await gesture(f.session, [shape('first')])
  await gesture(f.session, [shape('second')])
  await assert.rejects(f.session.undo(), /合成丢失回复/)
  assert.equal(calls, 1)
  assert.equal(f.session.store.has('shape:first'), true)
  assert.equal(f.session.store.has('shape:second'), false)
  assert.deepEqual(snapshotOf(f.session), (await f.transport.read()).snapshot)
  assert.equal(f.session.state.get().lastError.code, 'transport')
  assert.equal(f.session.state.get().isSubmitting, false)
  await f.session.redo()
  assert.equal(f.session.store.has('shape:second'), true)
})

test('运行时撤销版本冲突只刷新不自动重试，用户明确重试后保留别人改动', async t => {
  let calls = 0
  const f = await open(t, transport => ({ ...transport, subscribe: () => () => {}, undo(request) { calls++; return transport.undo(request) } }))
  await gesture(f.session, [shape('own')])
  const stale = f.session.state.get().revision
  const remote = await f.api(`/api/canvas/operations?conversation=${f.id}`, 'POST', { expectedRevision: stale, operations: [shape('other')] }, { 'x-hicanvas-actor': 'ai:other' })
  assert.equal(remote.status, 200)
  await assert.rejects(f.session.undo(), { code: 'conflict' })
  assert.equal(calls, 1)
  assert.equal(f.session.state.get().revision, remote.body.revision)
  assert.equal(f.session.store.has('shape:own'), true)
  await f.session.undo()
  assert.equal(f.session.store.has('shape:own'), false)
  assert.equal(f.session.store.has('shape:other'), true)
})

test('运行时也接收宿主仅返回的撤销变化，不要求回复包含整份快照', async t => {
  const f = await open(t, transport => ({ ...transport, subscribe: () => () => {},
    async undo(request) { const { snapshot: _snapshot, ...reply } = await transport.undo(request); return reply },
    async redo(request) { const { snapshot: _snapshot, ...reply } = await transport.redo(request); return reply },
  }))
  const saved = await gesture(f.session, [shape('changes-only')])
  await f.session.undo()
  assert.equal(f.session.store.has('shape:changes-only'), false)
  await f.session.redo()
  assert.deepEqual(snapshotOf(f.session), saved.snapshot)
})
