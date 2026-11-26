import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction, CanvasEditError } from '../engine/index.js'
import { fixture, subject, scale } from './scale-fixtures.mjs'

const cases = [
  ['line', { points: { a1: { id: 'a1', index: 'a1', x: 0, y: 0 }, a2: { id: 'a2', index: 'a2', x: 200, y: 100 } }, spline: 'cubic', color: 'black', dash: 'solid', size: 'm', scale: 1 }, shape => [shape.props.points.a2.x, shape.props.points.a2.y], [400, 150], [400, 200]],
  ['arrow', { end: { x: 200, y: 100 }, bend: 50 }, shape => [shape.props.end.x, shape.props.end.y], [400, 150], [400, 200]],
  ['draw', {}, shape => [shape.props.scaleX, shape.props.scaleY], [2, 1.5], [2, 2]],
  ['highlight', {}, shape => [shape.props.scaleX, shape.props.scaleY], [2, 1.5], [2, 2]],
  ['note', {}, shape => [shape.props.scale, shape.props.growY], [1, 0], [1, 0]],
  ['bookmark', {}, shape => [shape.props.w, shape.props.h], [300, 155], [300, 155]],
  ['embed', { w: 320, h: 240, url: 'https://example.invalid/fixture' }, shape => [shape.props.w, shape.props.h], [640, 360], [640, 480]],
  ['video', {}, shape => [shape.props.w, shape.props.h], [640, 270], [640, 360]],
  ['frame', { w: 320, h: 240 }, shape => [shape.props.w, shape.props.h], [640, 360], [640, 480]],
]
for (const [type, props, values, free, locked] of cases) for (const context of ['single', 'group', 'mixed']) test(`${type}/${context}：两模式、比例覆盖与撤销重做均保留记录契约`, () => {
  const group = context === 'group', peer = context === 'mixed'
  const before = fixture(type, props, { group, peer }), original = structuredClone(before)
  const ids = group ? ['shape:group'] : peer ? [subject, 'shape:peer'] : [subject]
  for (const mode of ['resize_bounds', 'scale_shape']) for (const lockAspectRatio of [false, true]) {
    const result = scale(before, { x: 2, y: 1.5 }, { ids, mode, lockAspectRatio })
    const shape = result.snapshot.store[subject]
    assert.deepEqual(values(shape), lockAspectRatio ? locked : free)
    assert.equal(shape.type, type); assert.equal(shape.parentId, before.store[subject].parentId)
    assert.equal(shape.opacity, 1); assert.deepEqual(shape.meta, before.store[subject].meta)
    if (group) assert.deepEqual(result.snapshot.store['shape:group'], before.store['shape:group'])
    if (!result.results[0].shapeIds.length) { assert.deepEqual(result.snapshot, before); continue }
    const history = recordCanvasTransaction(undefined, 'scaling-matrix', result.changes)
    const undone = undoCanvasTransaction(result.snapshot, history, 'scaling-matrix')
    assert.deepEqual(undone.snapshot, before)
    assert.deepEqual(redoCanvasTransaction(undone.snapshot, undone.history, 'scaling-matrix').snapshot, result.snapshot)
  }
  assert.deepEqual(before, original)
})

test('新类型仍拒绝非法倍率、模式和手柄，整批失败不泄漏前序修改', () => {
  const before = fixture('draw'), original = structuredClone(before)
  for (const options of [ { scale: { x: 0, y: 1 } }, { scale: { x: Infinity, y: 1 } }, { scale: { x: 1, y: NaN } }, { mode: 'other' }, { handle: 'other' }, { lockAspectRatio: 1 } ]) {
    assert.throws(() => executeCanvasCommands(before, [
      { type: 'update', id: subject, changes: { x: 999 } },
      { type: 'scale_shapes', ids: [subject], origin: { x: 0, y: 0 }, scale: { x: 2, y: 2 }, ...options },
    ]), error => error instanceof CanvasEditError && Boolean(error.message))
    assert.deepEqual(before, original)
  }
})
