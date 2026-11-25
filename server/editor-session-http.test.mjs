import '../tools/test-sandbox.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createEditorSession } from '../engine/index.js'
import { fixture } from './test-helpers.mjs'
import { httpSessionTransport } from './fixtures/editor-session-http-fixture.mjs'
import { shape, update, snapshotOf } from './fixtures/editor-session-fixture.mjs'

async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(5) }
  assert.fail('等待隔离本机服务的变化广播超时')
}

async function open(t) {
  const { api, base } = await fixture(t)
  const { body } = await api('/api/conversations/open', 'POST', { title: '合成运行时测试' })
  const id = body.conversation.id
  const transport = httpSessionTransport(base, id)
  const session = await createEditorSession({ transport, actor: 'ui:synthetic-http' })
  t.after(() => session.dispose())
  await transport.ready
  async function remote(commands) {
    const current = await transport.read()
    const result = await api(`/api/canvas/operations?conversation=${id}`, 'POST', { expectedRevision: current.revision, operations: commands })
    assert.equal(result.status, 200)
    return result.body
  }
  return { api, base, id, transport, session, remote }
}

test('真实隔离本机服务：预览不写服务，提交净变化并接收 SSE，无关改动保留', async t => {
  const { transport, session, remote } = await open(t)
  const initialRevision = session.state.get().revision
  session.beginGesture()
  session.preview([shape('local')])
  session.preview([update('local', { x: 50 })])
  assert.equal((await transport.read()).revision, initialRevision)
  assert.equal((await transport.read()).snapshot.store['shape:local'], undefined)
  const other = await remote([shape('remote')])
  await waitFor(() => session.state.get().revision === other.revision)
  assert.ok(session.store.has('shape:remote'))
  assert.equal(session.store.get('shape:local').x, 50)
  const saved = await session.commitGesture()
  assert.equal(transport.commits.length, 1)
  assert.equal(transport.commits[0].actor, 'ui:synthetic-http')
  assert.equal(transport.commits[0].commands.length, 1)
  assert.notEqual(saved.revision, other.revision)
  assert.deepEqual(snapshotOf(session), (await transport.read()).snapshot)
})

test('真实隔离本机服务：广播的同记录冲突立即取消整个手势，不覆盖远端', async t => {
  const { transport, session, remote } = await open(t)
  const created = await remote([shape('shared')])
  await waitFor(() => session.state.get().revision === created.revision)
  session.beginGesture()
  session.preview([shape('local-only'), update('shared', { x: 80 })])
  const changed = await remote([update('shared', { y: 70 })])
  await waitFor(() => session.state.get().revision === changed.revision)
  assert.equal(session.state.get().isGestureActive, false)
  assert.equal(session.state.get().lastError.code, 'conflict')
  assert.equal(session.store.has('shape:local-only'), false)
  assert.equal(session.store.get('shape:shared').x, 0)
  assert.equal(session.store.get('shape:shared').y, 70)
  assert.equal(transport.commits.length, 0)
  assert.deepEqual(snapshotOf(session), (await transport.read()).snapshot)
})


test('两个运行时连接同一本机合成画板，交错手势提交后双方快照及版本一致', async t => {
  const { base, id, transport: firstTransport, session: first } = await open(t)
  const secondTransport = httpSessionTransport(base, id)
  const second = await createEditorSession({ transport: secondTransport, actor: 'ui:second-http' })
  t.after(() => second.dispose())
  await secondTransport.ready
  assert.equal(first.state.get().revision, second.state.get().revision)
  first.beginGesture()
  second.beginGesture()
  first.preview([shape('first'), update('first', { x: 12 })])
  second.preview([shape('second'), update('second', { y: 34 })])
  const firstSaved = await first.commitGesture()
  await waitFor(() => second.state.get().revision === firstSaved.revision)
  assert.ok(second.store.has('shape:first'))
  assert.ok(second.store.has('shape:second'))
  assert.equal(second.state.get().isGestureActive, true)
  const secondSaved = await second.commitGesture()
  await waitFor(() => first.state.get().revision === secondSaved.revision)
  assert.notEqual(firstSaved.revision, secondSaved.revision)
  assert.equal(firstTransport.commits.length, 1)
  assert.equal(secondTransport.commits.length, 1)
  assert.equal(secondTransport.commits[0].expectedRevision, firstSaved.revision)
  const actual = await firstTransport.read()
  assert.equal(first.state.get().revision, actual.revision)
  assert.equal(second.state.get().revision, actual.revision)
  assert.deepEqual(snapshotOf(first), actual.snapshot)
  assert.deepEqual(snapshotOf(second), actual.snapshot)
  assert.equal(first.store.get('shape:first').x, 12)
  assert.equal(first.store.get('shape:second').y, 34)
})
