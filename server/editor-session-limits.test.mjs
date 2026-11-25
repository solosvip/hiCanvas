import '../tools/test-sandbox.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { react } from '@tldraw/state'
import { generateNKeysBetween } from 'fractional-indexing'
import { createCanvasSnapshot } from '../model/index.js'
import * as engine from '../engine/index.js'
import { memoryHost, shape, snapshotOf } from './fixtures/editor-session-fixture.mjs'

function manyShapes(count) {
  const snapshot = engine.executeCanvasCommands(createCanvasSnapshot(), [shape('template')]).snapshot
  const record = snapshot.store['shape:template']
  delete snapshot.store[record.id]
  const indices = generateNKeysBetween(null, null, count)
  for (let i = 0; i < count; i++) snapshot.store[`shape:bulk-${i}`] = { ...structuredClone(record), id: `shape:bulk-${i}`, index: indices[i] }
  return snapshot
}

async function open(t, snapshot) {
  const host = memoryHost(snapshot)
  const session = await engine.createEditorSession({ transport: host.transport, actor: 'ui:large-gesture' })
  t.after(() => session.dispose())
  return { host, session }
}

test('600 个形状多帧微移只提交一个事务，版本只前进一次', async t => {
  const { host, session } = await open(t, manyShapes(600))
  const ids = session.store.allRecords().filter(r => r.typeName === 'shape').map(r => r.id)
  session.beginGesture()
  for (let i = 0; i < 3; i++) session.preview([{ type: 'nudge_shapes', ids, delta: { x: 3, y: 2 } }])
  assert.equal(host.commits.length, 0)
  await session.commitGesture()
  assert.equal(host.commits.length, 1)
  assert.equal(host.commits[0].commands.length, 600)
  assert.equal(host.commits[0].expectedRevision, 'v0')
  assert.equal(session.state.get().revision, 'v1')
  for (const id of ids) assert.equal(session.store.get(id).x, 9)
  assert.deepEqual(snapshotOf(session), host.current().snapshot)
})

test('超过 20000 条净命令时整次手势取消，恢复已确认数据并明确报错', async t => {
  const { host, session } = await open(t, manyShapes(20001))
  const ids = session.store.allRecords().filter(r => r.typeName === 'shape').map(r => r.id)
  session.beginGesture()
  session.preview([{ type: 'nudge_shapes', ids, delta: { x: 1, y: 0 } }])
  await assert.rejects(session.commitGesture(), error => error.code === 'limit' && error.message === '改动太多，无法一次提交')
  assert.equal(host.commits.length, 0)
  assert.equal(session.state.get().revision, 'v0')
  assert.equal(session.state.get().isGestureActive, false)
  assert.deepEqual(snapshotOf(session), host.current().snapshot)
})

test('一次 bulk put 后条校验失败也回滚前条，不向监听者泄漏半帧', async t => {
  const initial = engine.executeCanvasCommands(createCanvasSnapshot(), [shape('one'), shape('two', { x: Number.MAX_VALUE })]).snapshot
  const { session } = await open(t, initial)
  const frames = []
  const stop = react('observe bulk rollback', () => frames.push(session.store.get('shape:one').x))
  t.after(stop)
  session.beginGesture()
  assert.throws(() => session.preview([{ type: 'nudge_shapes', ids: ['shape:one', 'shape:two'], delta: { x: Number.MAX_VALUE, y: 0 } }]), engine.CanvasEditError)
  assert.deepEqual(snapshotOf(session), initial)
  assert.ok(frames.every(x => x === 0), '失败帧没有泄漏前条已写入的坐标')
  session.preview([{ type: 'nudge_shapes', ids: ['shape:one'], delta: { x: 1, y: 0 } }])
  await session.commitGesture()
  assert.equal(session.store.get('shape:one').x, 1)
})
