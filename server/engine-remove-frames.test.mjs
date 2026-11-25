import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, CanvasEditError, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction } from '../engine/index.js'

const shape = (name, fields = {}) => ({ type: 'create_shape', id: `shape:${name}`, shapeType: 'geo', ...fields })
function initial(commands) { return executeCanvasCommands(createCanvasSnapshot(), commands).snapshot }
function pose(records, id) {
  const record = records[id]
  if (records[record.parentId]?.typeName === 'page') return { x: record.x, y: record.y, rotation: record.rotation }
  const parent = pose(records, record.parentId)
  return { x: parent.x + Math.cos(parent.rotation) * record.x - Math.sin(parent.rotation) * record.y, y: parent.y + Math.sin(parent.rotation) * record.x + Math.cos(parent.rotation) * record.y, rotation: parent.rotation + record.rotation }
}
function close(actual, expected) { for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} 应接近 ${expected[key]}`) }

test('移除旋转嵌套画框保留子孙的画布位置、旋转与前后层次', () => {
  const snapshot = initial([
    shape('parent', { shapeType: 'group', x: -100, y: 50, rotation: -0.3 }),
    shape('below', { parentId: 'shape:parent' }),
    shape('frame', { shapeType: 'frame', parentId: 'shape:parent', x: 100, y: 200, rotation: 0.7 }),
    shape('background', { parentId: 'shape:frame', x: 20, y: 30, rotation: -0.1 }),
    shape('nested', { shapeType: 'group', parentId: 'shape:frame', x: 50, y: 60, rotation: 0.2 }),
    shape('label', { shapeType: 'text', parentId: 'shape:nested', x: 10, y: 15, text: '保留' }),
    shape('above', { parentId: 'shape:parent' })
  ])
  const before = structuredClone(snapshot)
  const result = executeCanvasCommands(snapshot, [{ type: 'remove_frames', ids: ['shape:frame'] }])
  const records = result.snapshot.store
  assert.equal(records['shape:frame'], undefined)
  for (const id of ['shape:background', 'shape:nested', 'shape:label']) close(pose(records, id), pose(before.store, id))
  for (const id of ['shape:background', 'shape:nested']) assert.equal(records[id].parentId, 'shape:parent')
  assert.deepEqual(records['shape:label'], before.store['shape:label'])
  const stack = ['shape:below', 'shape:background', 'shape:nested', 'shape:above'].map(id => records[id].index)
  assert.deepEqual(stack, [...stack].sort())
  assert.deepEqual(Object.keys(result.changes.updated).sort(), ['shape:background', 'shape:nested'].sort())
  assert.deepEqual(result.changes.removed, { 'shape:frame': before.store['shape:frame'] })
  assert.deepEqual(snapshot, before)
  assert.deepEqual(result.results, [null])
})

test('一次移除多层画框只移除容器，保留子形状绑定，删除指向被移除画框的绑定', () => {
  const binding = (id, fromId, toId) => ({ type: 'put', record: { id, typeName: 'binding', type: 'arrow', fromId, toId, props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: true, snap: 'none' }, meta: {} } })
  const snapshot = initial([
    shape('below'), shape('outer', { shapeType: 'frame', x: 100, y: 150, rotation: 0.3 }),
    shape('inner', { shapeType: 'frame', parentId: 'shape:outer', x: -40, y: 80, rotation: 0.5 }),
    shape('child', { parentId: 'shape:inner', x: 20, y: 30 }), shape('arrow', { shapeType: 'arrow', parentId: 'shape:outer' }),
    shape('above'), shape('empty', { shapeType: 'frame' }),
    binding('binding:child', 'shape:arrow', 'shape:child'), binding('binding:frame', 'shape:arrow', 'shape:inner')
  ])
  for (const ids of [['shape:outer', 'shape:inner', 'shape:empty', 'shape:outer'], ['shape:inner', 'shape:outer', 'shape:empty']]) {
    const result = executeCanvasCommands(snapshot, [{ type: 'remove_frames', ids }]), records = result.snapshot.store
    for (const id of ['shape:outer', 'shape:inner', 'shape:empty', 'binding:frame']) assert.equal(records[id], undefined)
    assert.deepEqual(records['binding:child'], snapshot.store['binding:child'])
    for (const id of ['shape:child', 'shape:arrow']) { assert.equal(records[id].parentId, 'page:page'); close(pose(records, id), pose(snapshot.store, id)) }
    const stack = ['shape:below', 'shape:child', 'shape:arrow', 'shape:above'].map(id => records[id].index)
    assert.deepEqual(stack, [...stack].sort())
    assert.deepEqual(result.changes.added, {})
    const history = recordCanvasTransaction(undefined, 'U', result.changes)
    const undone = undoCanvasTransaction(result.snapshot, history, 'U')
    assert.deepEqual(undone.snapshot, snapshot)
    assert.deepEqual(redoCanvasTransaction(undone.snapshot, undone.history, 'U').snapshot, result.snapshot)
  }
})

test('移除画框与占位框替换对子形状的坐标、旋转逐值相同且层次一致', () => {
  const snapshot = initial([
    shape('frame', { shapeType: 'frame', x: 120, y: -50, rotation: 0.27, meta: { cowartAiDraftHolder: true } }),
    shape('background', { parentId: 'shape:frame', x: 12, y: 25 }), shape('label', { shapeType: 'text', parentId: 'shape:frame', x: 16, y: 35, rotation: -0.3 }),
    shape('above')
  ])
  const removed = executeCanvasCommands(snapshot, [{ type: 'remove_frames', ids: ['shape:frame'] }])
  const replaced = executeCanvasCommands(snapshot, [{ type: 'insert_html', args: { draftShapeId: 'shape:frame' }, html: { url: 'data:text/html,<h1>合成</h1>', assetUrl: '', contentHash: 'synthetic' } }])
  for (const id of ['shape:background', 'shape:label']) {
    const { index: removedIndex, ...removedRecord } = removed.snapshot.store[id]
    const { index: replacedIndex, ...replacedRecord } = replaced.snapshot.store[id]
    assert.deepEqual(removedRecord, replacedRecord)
    // 分数索引会带随机抖动；比较它表达的顺序，不比较两次生成的编号。
    for (const index of [removedIndex, replacedIndex]) assert.ok(index > snapshot.store['shape:frame'].index && index < snapshot.store['shape:above'].index)
  }
  for (const result of [removed, replaced]) assert.ok(result.snapshot.store['shape:background'].index < result.snapshot.store['shape:label'].index)
})

test('移除画框的无效 ID 或部分移动后校验失败时整批保持原样', () => {
  const snapshot = initial([
    shape('frame', { shapeType: 'frame', x: 1e308 }),
    shape('first', { parentId: 'shape:frame' }), shape('overflow', { parentId: 'shape:frame', x: 1e308 }), shape('normal')
  ]), before = structuredClone(snapshot)
  for (const ids of [null, [], ['shape:missing'], ['page:page'], ['shape:normal'], ['shape:frame', 1], ['shape:frame']]) {
    assert.throws(() => executeCanvasCommands(snapshot, [{ type: 'remove_frames', ids }]), error => error instanceof CanvasEditError && error.code === 'invalid-input')
  }
  const valid = initial([shape('frame', { shapeType: 'frame' }), shape('child', { parentId: 'shape:frame' })])
  assert.throws(() => executeCanvasCommands(valid, [{ type: 'remove_frames', ids: ['shape:frame'] }, { type: 'update', id: 'shape:missing', changes: { x: 5 } }]), CanvasEditError)
  assert.ok(valid.store['shape:frame'])
  assert.equal(valid.store['shape:child'].parentId, 'shape:frame')
  assert.deepEqual(snapshot, before)
})
