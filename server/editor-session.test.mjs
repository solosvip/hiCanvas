import '../tools/test-sandbox.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { react } from '@tldraw/state'
import { createCanvasSnapshot } from '../model/index.js'
import * as engine from '../engine/index.js'
import { memoryHost, shape, update, snapshotOf } from './fixtures/editor-session-fixture.mjs'

async function sessionFor(t, host = memoryHost(), actor = 'ui:synthetic') {
  const session = await engine.createEditorSession({ transport: host.transport, actor })
  t.after(() => session.dispose())
  return { session, host }
}

test('活存储多帧预览不读取整份快照，手势结束只提交一份净变化', async t => {
  const { session, host } = await sessionFor(t)
  const store = session.store
  const getSnapshot = store.getStoreSnapshot
  session.beginGesture()
  store.getStoreSnapshot = () => { throw new Error('预览不应复制整个文档') }
  session.preview([shape('one')])
  session.preview([update('one', { x: 10 })])
  session.preview([update('one', { x: 40, props: { w: 300 } })])
  assert.equal(host.commits.length, 0)
  assert.equal(store.get('shape:one').x, 40)
  store.getStoreSnapshot = getSnapshot
  const result = await session.commitGesture()
  assert.equal(host.commits.length, 1)
  assert.equal(host.commits[0].actor, 'ui:synthetic')
  assert.deepEqual(host.commits[0].commands.map(command => command.type), ['put'])
  assert.equal(host.commits[0].commands[0].record.x, 40)
  assert.equal(session.store, store, '供渲染层挂载的存储不换身份')
  assert.deepEqual(snapshotOf(session), host.current().snapshot)
  assert.equal(session.state.get().revision, result.revision)
  assert.equal(session.state.get().isGestureActive, false)
})

test('取消仅恢复本次手势，新增后删除的净空手势不提交', async t => {
  const { session, host } = await sessionFor(t)
  const initial = snapshotOf(session)
  session.beginGesture()
  session.preview([shape('cancelled')])
  session.preview([update('cancelled', { x: 30 })])
  session.cancelGesture()
  assert.deepEqual(snapshotOf(session), initial)
  assert.equal(host.commits.length, 0)
  session.beginGesture()
  session.preview([shape('net-empty'), { type: 'delete', ids: ['shape:net-empty'] }])
  await session.commitGesture()
  assert.equal(host.commits.length, 0)
  assert.deepEqual(snapshotOf(session), initial)
})

test('一帧中途失败或关系校验失败，已成功的前一帧保留且没有半帧泄漏', async t => {
  const { session } = await sessionFor(t)
  session.beginGesture()
  session.preview([shape('kept')])
  const before = snapshotOf(session)
  const seen = []
  const stop = react('observe synthetic frame', () => { seen.push(session.store.get('shape:kept').x) })
  t.after(stop)
  for (const commands of [
    [update('kept', { x: 88 }), shape('temporary'), update('kept', { props: { w: 'invalid' } })],
    [update('kept', { x: 99, parentId: 'shape:missing' })],
  ]) {
    assert.throws(() => session.preview(commands), engine.CanvasEditError)
    assert.deepEqual(snapshotOf(session), before)
  }
  assert.ok(seen.every(x => x === 0), '订阅者从未看到失败帧的中间位置')
  session.preview([update('kept', { x: 5 })])
  await session.commitGesture()
  assert.equal(session.store.get('shape:kept').x, 5)
})

test('广播期间别人修改不相干记录立即并入，取消不丢别人的记录', async t => {
  const { session, host } = await sessionFor(t)
  session.beginGesture()
  session.preview([shape('local')])
  await host.remote([shape('external')])
  await session.refresh()
  assert.ok(session.store.has('shape:local'))
  assert.ok(session.store.has('shape:external'))
  assert.equal(session.state.get().isGestureActive, true)
  session.cancelGesture()
  assert.equal(session.store.has('shape:local'), false)
  assert.ok(session.store.has('shape:external'))
  assert.deepEqual(snapshotOf(session), host.current().snapshot)
})

test('提交遇到无广播的版本变化时先读取并重放，只保留一条本地事务', async t => {
  const { session, host } = await sessionFor(t)
  session.beginGesture()
  session.preview([shape('local')])
  await host.remote([shape('remote')], { broadcast: false })
  await session.commitGesture()
  assert.equal(host.commits.filter(item => item.actor === 'ui:synthetic').length, 1)
  assert.deepEqual(snapshotOf(session), host.current().snapshot)
  assert.ok(session.store.has('shape:local'))
  assert.ok(session.store.has('shape:remote'))
})

test('别人改了同一记录时放弃手势并报告冲突，工作副本等于服务端', async t => {
  const initial = engine.executeCanvasCommands(createCanvasSnapshot(), [shape('shared')]).snapshot
  const { session, host } = await sessionFor(t, memoryHost(initial))
  session.beginGesture()
  session.preview([update('shared', { x: 40 })])
  await host.remote([update('shared', { y: 90 })], { broadcast: false })
  await assert.rejects(session.commitGesture(), error => error.code === 'conflict' && /shape:shared/.test(error.message))
  assert.deepEqual(snapshotOf(session), host.current().snapshot)
  assert.equal(session.state.get().isGestureActive, false)
  assert.equal(session.state.get().lastError.code, 'conflict')
  assert.equal(host.commits.filter(item => item.actor === 'ui:synthetic').length, 0)
})

test('成功后采用服务端实际保存的数据，即使回执只有 changes', async t => {
  const host = memoryHost()
  host.canonicalize(record => { if (record.id === 'shape:canonical') record.meta.saved = 'server-value' })
  const commit = host.transport.commit
  host.transport.commit = async request => { const { snapshot, ...result } = await commit(request); return result }
  const { session } = await sessionFor(t, host)
  session.beginGesture()
  session.preview([shape('canonical')])
  await session.commitGesture()
  assert.equal(session.store.get('shape:canonical').meta.saved, 'server-value')
  assert.deepEqual(snapshotOf(session), host.current().snapshot)
})
