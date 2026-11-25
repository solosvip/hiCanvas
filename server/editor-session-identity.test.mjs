import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, executeCanvasCommands } from '../engine/index.js'
import { memoryHost, shape, update, snapshotOf } from './fixtures/editor-session-fixture.mjs'

async function open(t) {
  // MIT Store 的内置测试调度器同步送出 listen 通知，不需要网页的 RAF。
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  t.after(() => { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous })
  const initial = executeCanvasCommands(createCanvasSnapshot(), [shape('stable'), shape('edited'), shape('remote')]).snapshot
  const host = memoryHost(initial)
  const session = await createEditorSession({ transport: host.transport, actor: 'ui:identity' })
  t.after(() => session.dispose())
  function observe() {
    const entries = []
    const stop = session.store.listen(entry => entries.push(structuredClone(entry.changes)), { scope: 'document' })
    t.after(stop)
    return entries
  }
  return { session, host, observe }
}

function ids(entries, field) { return entries.flatMap(diff => Object.keys(diff[field])).sort() }

test('确认已预览的手势时保持所有原对象，不向 Store 监听发送假变化', async t => {
  const { session, host, observe } = await open(t)
  session.beginGesture()
  session.preview([update('edited', { x: 10 })])
  const stable = session.store.get('shape:stable')
  const edited = session.store.get('shape:edited')
  const entries = observe()
  await session.commitGesture()
  await session.refresh()
  assert.equal(session.store.get('shape:stable'), stable)
  assert.equal(session.store.get('shape:edited'), edited)
  assert.deepEqual(entries, [])
  assert.deepEqual(snapshotOf(session), host.current().snapshot)
})

test('取消只恢复真正改过的记录，其他对象保持身份且监听只含净变化', async t => {
  const { session, host, observe } = await open(t)
  const stable = session.store.get('shape:stable')
  const remote = session.store.get('shape:remote')
  session.beginGesture()
  session.preview([update('edited', { x: 10 }), shape('temporary'), { type: 'delete', ids: ['shape:remote'] }])
  const entries = observe()
  session.cancelGesture()
  assert.equal(session.store.get('shape:stable'), stable)
  assert.deepEqual(session.store.get('shape:remote'), remote)
  assert.deepEqual(ids(entries, 'updated'), ['shape:edited'])
  assert.deepEqual(ids(entries, 'added'), ['shape:remote'])
  assert.deepEqual(ids(entries, 'removed'), ['shape:temporary'])
  assert.equal(entries.length, 1, '一次差异批处理产生一次文档通知')
  assert.deepEqual(snapshotOf(session), host.current().snapshot)
})

test('收到无关远端改动时，只通知远端记录，本地预览和未变记录保持原对象', async t => {
  const { session, host, observe } = await open(t)
  session.beginGesture()
  session.preview([update('edited', { x: 10 })])
  const stable = session.store.get('shape:stable')
  const edited = session.store.get('shape:edited')
  const entries = observe()
  await host.remote([update('remote', { y: 20 })])
  await session.refresh()
  assert.equal(session.store.get('shape:stable'), stable)
  assert.equal(session.store.get('shape:edited'), edited)
  assert.deepEqual(ids(entries, 'updated'), ['shape:remote'])
  assert.deepEqual(ids(entries, 'added'), [])
  assert.deepEqual(ids(entries, 'removed'), [])
  assert.equal(session.state.get().isGestureActive, true)
})

test('服务端归一化提交结果只替换实际改变的记录', async t => {
  const { session, host, observe } = await open(t)
  host.canonicalize(record => { if (record.id === 'shape:edited') record.meta.saved = true })
  session.beginGesture()
  session.preview([update('edited', { x: 10 })])
  const stable = session.store.get('shape:stable')
  const edited = session.store.get('shape:edited')
  const entries = observe()
  await session.commitGesture()
  await session.refresh()
  assert.equal(session.store.get('shape:stable'), stable)
  assert.notEqual(session.store.get('shape:edited'), edited)
  assert.equal(session.store.get('shape:edited').meta.saved, true)
  assert.deepEqual(ids(entries, 'updated'), ['shape:edited'])
  assert.deepEqual(ids(entries, 'added'), [])
  assert.deepEqual(ids(entries, 'removed'), [])
})
