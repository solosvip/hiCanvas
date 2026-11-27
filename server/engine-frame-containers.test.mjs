import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction } from '../engine/index.js'
import { getShapePageBounds, shapeToPagePoint } from '../renderer/geometry.js'
import { fixture } from './test-helpers.mjs'

const shape = (id, fields = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'geo', ...fields })
const frame = (id, fields = {}) => shape(id, { shapeType: 'frame', props: { w: 360, h: 260 }, ...fields })
const initial = commands => executeCanvasCommands(createCanvasSnapshot(), commands).snapshot
const close = (actual, expected) => { for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-7, `${key}: ${actual[key]} != ${expected[key]}`) }
function undo(before, result) {
  assert.deepEqual(undoCanvasTransaction(result.snapshot, recordCanvasTransaction(undefined, 'frames', result.changes), 'frames').snapshot, before)
}

test('共享换父命令跨旋转父链保留画布姿态、整棵组及层序，一次撤销完整恢复', () => {
  const before = initial([
    frame('outer', { x: 100, y: 50, rotation: .3 }),
    frame('target', { x: 500, y: 200, rotation: -.4 }),
    shape('a', { parentId: 'shape:outer', x: 30, y: 40, rotation: .2 }),
    shape('b', { parentId: 'shape:outer', x: 100, y: 80 }),
    { type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' },
    { type: 'update', id: 'shape:b', changes: { isLocked: true } },
    shape('existing', { parentId: 'shape:target' }),
  ])
  const result = executeCanvasCommands(before, [{ type: 'reparent_shapes', ids: ['shape:g', 'shape:a', 'shape:g'], parentId: 'shape:target' }])
  assert.deepEqual(result.results[0].shapeIds, ['shape:g'])
  assert.equal(result.snapshot.store['shape:g'].parentId, 'shape:target')
  assert.ok(result.snapshot.store['shape:g'].index > before.store['shape:existing'].index)
  for (const id of ['shape:a', 'shape:b']) {
    assert.deepEqual(result.snapshot.store[id], before.store[id])
    close(getShapePageBounds(result.snapshot, id), getShapePageBounds(before, id))
  }
  undo(before, result)
  const noop = executeCanvasCommands(result.snapshot, [{ type: 'reparent_shapes', ids: ['shape:g'], parentId: 'shape:target' }])
  assert.deepEqual(noop.changes, { added: {}, updated: {}, removed: {} })
  const exited = executeCanvasCommands(result.snapshot, [{ type: 'reparent_shapes', ids: ['shape:g'], parentId: 'page:page' }])
  close(shapeToPagePoint(exited.snapshot, 'shape:a', { x: 0, y: 0 }), shapeToPagePoint(before, 'shape:a', { x: 0, y: 0 }))
})

test('跨父级收纳按原画布绘制层序排序，不按同名局部index或ID猜顺序', () => {
  const before = initial([frame('back'), frame('front'), frame('target'), shape('z', { parentId: 'shape:back' }), shape('a', { parentId: 'shape:front' })])
  const result = executeCanvasCommands(before, [{ type: 'reparent_shapes', ids: ['shape:a', 'shape:z'], parentId: 'shape:target' }])
  assert.ok(result.snapshot.store['shape:z'].index < result.snapshot.store['shape:a'].index)
  undo(before, result)
})

for (const axis of ['x', 'y', 'both']) for (const rotation of [0, .37]) test(`适配 ${axis}，旋转 ${rotation}：所有孩子含锁项画布位置保持，整次撤销`, () => {
  const before = initial([
    frame('parent', { x: 50, y: 70, rotation: -.2 }),
    frame('f', { parentId: 'shape:parent', x: 220, y: 180, rotation }),
    shape('a', { parentId: 'shape:f', x: -30, y: -20, props: { w: 120, h: 60 } }),
    shape('b', { parentId: 'shape:f', x: 220, y: 160, props: { w: 100, h: 70 } }),
    { type: 'update', id: 'shape:b', changes: { isLocked: true } },
  ])
  const result = executeCanvasCommands(before, [{ type: 'fit_frame_to_content', ids: ['shape:f'], padding: 10, axis }])
  const f = result.snapshot.store['shape:f']
  close(f.props, { w: axis === 'y' ? 360 : 370, h: axis === 'x' ? 260 : 270 })
  for (const id of ['shape:a', 'shape:b']) close(getShapePageBounds(result.snapshot, id), getShapePageBounds(before, id))
  undo(before, result)
})

test('适配缺省仍为两轴零留白，空框不变，无效axis整批拒绝', () => {
  const before = initial([frame('f'), shape('a', { parentId: 'shape:f', x: 20, y: 30, props: { w: 40, h: 60 } }), frame('empty')])
  const fitted = executeCanvasCommands(before, [{ type: 'fit_frame_to_content', ids: ['shape:f', 'shape:empty'] }])
  close(fitted.snapshot.store['shape:f'].props, { w: 40, h: 60 })
  assert.deepEqual(fitted.snapshot.store['shape:empty'], before.store['shape:empty'])
  assert.throws(() => executeCanvasCommands(before, [{ type: 'fit_frame_to_content', ids: ['shape:f'], axis: 'z' }]))
})

for (const reason of ['cycle', 'locked', 'stale']) test(`真实工作区整批拒绝 ${reason}，不泄漏前序写入或消耗撤销历史`, async t => {
  const { workspace } = await fixture(t), { id } = await workspace.open()
  const opened = await workspace.read(id)
  const baseline = await workspace.submitCommands(id, opened.revision, 'frames', () => [
    frame('outer'), frame('inner', { parentId: 'shape:outer' }), shape('a'),
    ...(reason === 'locked' ? [{ type: 'update', id: 'shape:inner', changes: { isLocked: true } }] : []),
  ])
  const before = await workspace.read(id)
  await assert.rejects(workspace.submitCommands(id, reason === 'stale' ? opened.revision : before.revision, 'frames', () => [
    { type: 'update', id: 'shape:a', changes: { x: 999 } },
    { type: 'reparent_shapes', ids: [reason === 'cycle' ? 'shape:outer' : 'shape:a'], parentId: 'shape:inner' },
  ]))
  assert.deepEqual(await workspace.read(id), before)
  // The failed transaction must leave both undo and redo stacks untouched.
  const undone = await workspace.undo(id, before.revision, 'frames')
  assert.deepEqual(undone.snapshot, opened.snapshot)
  const redone = await workspace.redo(id, undone.revision, 'frames')
  assert.deepEqual(redone.snapshot, baseline.snapshot)
})
