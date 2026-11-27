import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction } from '../engine/index.js'

const frame = (id, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'frame', props: { w: 280, h: 180 }, meta: { cowartAiSlides: true }, ...extra })
const page = (id, x, w, h) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'image', parentId: 'shape:a', x, y: 80, props: { w, h } })
const create = commands => executeCanvasCommands(createCanvasSnapshot(), commands).snapshot
function roundTrip(before, commands) {
  const result = executeCanvasCommands(before, commands), history = recordCanvasTransaction(undefined, 'synthetic', result.changes)
  const undo = undoCanvasTransaction(result.snapshot, history, 'synthetic')
  assert.deepEqual(undo.snapshot, before, '一次撤销恢复完整记录，而非只恢复拖动页')
  assert.deepEqual(redoCanvasTransaction(undo.snapshot, undo.history, 'synthetic').snapshot, result.snapshot)
  return result
}

test('空小框首张页、删除中间页、移出和跨套都一撤全还原，两套布局一起入历史', () => {
  let before = create([frame('a')])
  const first = roundTrip(before, [page('p1', 40, 240, 140)])
  assert.equal(first.snapshot.store['shape:a'].props.w, 1048)
  before = executeCanvasCommands(first.snapshot, [page('p2', 400, 360, 220), page('p3', 850, 180, 170), frame('b', { x: 1500, y: 100 })]).snapshot
  const deleted = roundTrip(before, [{ type: 'delete', ids: ['shape:p2'] }])
  assert.equal(deleted.snapshot.store['shape:p3'].x, 284)
  const out = roundTrip(before, [{ type: 'reparent_shapes', ids: ['shape:p2'], parentId: 'page:page' }])
  assert.equal(out.snapshot.store['shape:p3'].x, 284)
  const across = roundTrip(before, [{ type: 'reparent_shapes', ids: ['shape:p2'], parentId: 'shape:b' }])
  assert.equal(across.snapshot.store['shape:p3'].x, 284)
  assert.equal(across.snapshot.store['shape:p2'].x, 12)
  assert.equal(across.snapshot.store['shape:b'].props.w, 1048)
})

test('撤销恢复未整理的历史原值而不再布局，别人碰过排版连带页就拒绝撤销', () => {
  const before = create([frame('a'), page('p1', 40, 240, 140), page('p2', 400, 360, 220)])
  before.store['shape:p2'].x = 999
  const result = roundTrip(before, [{ type: 'update', id: 'shape:p1', changes: { x: 1200 } }])
  const history = recordCanvasTransaction(undefined, 'synthetic', result.changes)
  const remote = executeCanvasCommands(result.snapshot, [{ type: 'update', id: 'shape:p2', changes: { meta: { remote: true } } }]).snapshot
  assert.throws(() => undoCanvasTransaction(remote, history, 'synthetic'), e => e.code === 'conflict')
})

test('旋转祖先/容器原位保留，组为普通孩子；整套复制不改变源与父链', () => {
  const before = create([{ type: 'create_shape', id: 'shape:g', shapeType: 'group', x: 100, y: 180, rotation: .2 }, frame('a', { parentId: 'shape:g', x: 250, y: 170, rotation: .37 }), page('p1', 40, 240, 140), page('p2', 400, 360, 220)])
  const after = roundTrip(before, [{ type: 'duplicate_shapes', ids: ['shape:g'] }])
  const map = after.results[0].idMap
  assert.equal(after.snapshot.store[map['shape:a']].parentId, map['shape:g'])
  assert.equal(after.snapshot.store[map['shape:p1']].parentId, map['shape:a'])
  assert.equal(after.snapshot.store[map['shape:a']].rotation, .37)
  assert.equal(after.snapshot.store[map['shape:g']].rotation, .2)
  for (const id of ['shape:g', 'shape:a', 'shape:p1', 'shape:p2']) assert.deepEqual(after.snapshot.store[id], before.store[id])
})
