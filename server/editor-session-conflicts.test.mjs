import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, executeCanvasCommands } from '../engine/index.js'
import { memoryHost, shape, update, snapshotOf } from './fixtures/editor-session-fixture.mjs'

async function open(t, snapshot) {
  const host = memoryHost(snapshot)
  const session = await createEditorSession({ transport: host.transport, actor: 'ui:conflict-test' })
  t.after(() => session.dispose())
  return { host, session }
}

test('冲突重放有界：最多重放两次，持续变更后恢复最新服务端状态', async t => {
  const { host, session } = await open(t)
  let attempts = 0
  host.beforeCommit(async () => { await host.remote([shape(`other-${++attempts}`)], { broadcast: false }) })
  session.beginGesture()
  session.preview([shape('local')])
  await assert.rejects(session.commitGesture(), error => error.code === 'conflict' && /重放上限/.test(error.message))
  assert.equal(attempts, 3)
  assert.equal(host.commits.filter(c => c.actor === 'ui:conflict-test').length, 0)
  assert.deepEqual(snapshotOf(session), host.current().snapshot)
  assert.equal(session.store.has('shape:local'), false)
  assert.ok(session.store.has('shape:other-3'))
})

test('远端删除、同 ID 新建或修改一条记录，都取消多记录手势且不写回', async t => {
  for (const kind of ['delete', 'create', 'update']) {
    await t.test(kind, async t => {
      const seed = kind === 'create' ? createCanvasSnapshot() : executeCanvasCommands(createCanvasSnapshot(), [shape('shared')]).snapshot
      const { host, session } = await open(t, seed)
      session.beginGesture()
      session.preview([shape('other-local'), ...(kind === 'create' ? [shape('shared')] : [update('shared', { x: 25 })])])
      await host.remote(kind === 'delete' ? [{ type: 'delete', ids: ['shape:shared'] }] : kind === 'create' ? [shape('shared', { x: 99 })] : [update('shared', { y: 99 })])
      await session.refresh()
      assert.equal(session.state.get().isGestureActive, false)
      assert.equal(session.state.get().lastError.code, 'conflict')
      assert.equal(session.store.has('shape:other-local'), false)
      assert.deepEqual(snapshotOf(session), host.current().snapshot)
      assert.equal(host.commits.filter(c => c.actor === 'ui:conflict-test').length, 0)
    })
  }
})

test('本地删父形状期间别人新建子形状，重放不能级联删除新记录', async t => {
  const seed = executeCanvasCommands(createCanvasSnapshot(), [shape('frame', { shapeType: 'frame' })]).snapshot
  const { host, session } = await open(t, seed)
  session.beginGesture()
  session.preview([{ type: 'delete', ids: ['shape:frame'] }])
  await host.remote([shape('new-child', { parentId: 'shape:frame' })], { broadcast: false })
  await assert.rejects(session.commitGesture(), error => error.code === 'conflict' && /连带/.test(error.message))
  assert.ok(session.store.has('shape:frame'))
  assert.ok(session.store.has('shape:new-child'))
  assert.deepEqual(snapshotOf(session), host.current().snapshot)
})

test('提交回执丢失时重新读取已保存结果，不重复提交', async t => {
  const host = memoryHost()
  const commit = host.transport.commit
  host.transport.commit = async request => { await commit(request); throw new Error('模拟回执丢失') }
  const session = await createEditorSession({ transport: host.transport, actor: 'ui:lost-reply' })
  t.after(() => session.dispose())
  session.beginGesture()
  session.preview([shape('saved')])
  await assert.rejects(session.commitGesture(), /模拟回执丢失/)
  assert.equal(host.commits.length, 1)
  assert.deepEqual(snapshotOf(session), host.current().snapshot)
  assert.ok(session.store.has('shape:saved'))
  assert.equal(session.state.get().isGestureActive, false)
  assert.match(session.state.get().lastError.message, /模拟回执丢失/)
})

test('提交期间阻止交错写入，关闭后取消订阅，迟到的回执不再改状态', async t => {
  const { host, session } = await open(t)
  let release
  host.beforeCommit(() => new Promise(resolve => { release = resolve }))
  session.beginGesture()
  session.preview([shape('pending')])
  const pending = session.commitGesture()
  await Promise.resolve()
  for (const call of [() => session.beginGesture(), () => session.preview([shape('busy')]), () => session.cancelGesture(), () => session.commitGesture()]) assert.throws(call, error => error.code === 'busy')
  assert.equal(host.listenerCount(), 1)
  session.dispose()
  assert.equal(host.listenerCount(), 0)
  const before = session.state.get()
  release()
  await assert.rejects(pending, error => error.code === 'disposed')
  assert.equal(session.state.get(), before)
  assert.throws(() => session.beginGesture(), error => error.code === 'disposed')
})

test('启动读取失败也释放变化订阅', async () => {
  const host = memoryHost()
  host.transport.read = async () => { throw new Error('模拟断线') }
  await assert.rejects(createEditorSession({ transport: host.transport, actor: 'ui:failed-open' }), /模拟断线/)
  assert.equal(host.listenerCount(), 0)
})
