import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction, CanvasEditError } from '../engine/index.js'
import { getShapePageBounds } from '../renderer/geometry.js'

const run = (snapshot, ...commands) => executeCanvasCommands(snapshot, commands)
const shape = (name, extra = {}) => ({ type: 'create_shape', id: `shape:${name}`, shapeType: 'geo', props: { geo: 'rectangle', w: 100, h: 80 }, ...extra })
const seed = commands => run(createCanvasSnapshot(), ...commands).snapshot
const order = (snapshot, parentId = 'page:page') => Object.values(snapshot.store).filter(s => s.typeName === 'shape' && s.parentId === parentId).sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : 0).map(s => s.id.slice(6)).join('')
const noChanges = { added: {}, updated: {}, removed: {} }

function reversible(before, result) {
  const history = recordCanvasTransaction(undefined, 'actions-test', result.changes)
  const undone = undoCanvasTransaction(result.snapshot, history, 'actions-test')
  assert.deepEqual(undone.snapshot, before)
  assert.deepEqual(redoCanvasTransaction(undone.snapshot, undone.history, 'actions-test').snapshot, result.snapshot)
}

// 离屏旧版原生 Alt+[ / Alt+]：只越过碰到任一选中形状的同级对象，保持两组各自顺序。
const observedOrders = [
  ['分离阻挡', 'ab', [100, 500, 150, 550], 'cabd', 'abcd'],
  ['共享阻挡', 'ab', [100, 220, 150, 800], 'cabd', 'abcd', { c: 300 }],
  ['交错分离', 'ac', [100, 150, 500, 550], 'badc', 'acbd'],
  ['交错共享', 'ac', [100, 900, 120, 140], 'bdac', 'abcd'],
  ['全部相交', 'ac', [100, 150, 140, 200], 'badc', 'acbd'],
  ['反向选择', 'ca', [100, 150, 140, 200], 'badc', 'acbd'],
  ['后移阻挡', 'cd', [150, 550, 100, 500], 'abcd', 'acdb'],
  ['选择外框空隙不算重叠', 'ab', [100, 500, 300, 900], 'abcd', 'abcd'],
  ['跳过空隙再碰到', 'ab', [100, 500, 300, 550], 'cdab', 'abcd'],
  ['保持已选顺序', 'ac', [100, 900, 500, 150], 'bdac', 'abcd'],
  ['另一已选对象也是阻挡依据', 'ac', [100, 550, 500, 900], 'bacd', 'acbd'],
  ['边缘接触', 'a', [100, 200, 800, 1000], 'bacd', 'abcd'],
]
for (const [name, selected, positions, forward, backward, widths = {}] of observedOrders) test(`重叠层序旧版样本：${name}`, () => {
  const before = seed([...'abcd'].map((id, i) => shape(id, { x: positions[i], y: 100, props: { geo: 'rectangle', w: widths[id] ?? 100, h: 80 } })))
  for (const [operation, expected] of [['forward', forward], ['backward', backward]]) {
    const result = run(before, { type: 'reorder_shapes', ids: [...selected].map(id => `shape:${id}`), operation, mode: 'overlapping' })
    assert.equal(order(result.snapshot), expected, operation)
    for (const id of Object.keys(result.changes.updated)) assert.ok(selected.includes(id.slice(6)))
    if (expected === 'abcd') assert.deepEqual(result.changes, noChanges)
    else reversible(before, result)
  }
})

test('重叠模式用画布旋转外框、包含角接触和锁定阻挡，但不跨父容器', () => {
  const created = seed([
    shape('frame', { shapeType: 'frame', x: 500, y: 300, rotation: 0.4, props: { w: 800, h: 500 } }),
    shape('a', { parentId: 'shape:frame', x: 100, y: 100 }),
    shape('b', { parentId: 'shape:frame', x: 200, y: 180 }),
    shape('c', { parentId: 'shape:frame', x: 700, y: 100 }),
    shape('outside', { x: 100, y: 100 }),
  ])
  const before = run(created, { type: 'toggle_lock', ids: ['shape:b'] }).snapshot
  const result = run(before, { type: 'reorder_shapes', ids: ['shape:a'], operation: 'forward', mode: 'overlapping' })
  assert.equal(order(result.snapshot, 'shape:frame'), 'bac')
  assert.deepEqual(result.snapshot.store['shape:outside'], before.store['shape:outside'])
  assert.equal(result.snapshot.store['shape:b'].isLocked, true)
  reversible(before, result)
})

test('层序可选模式不改变默认相邻、置顶和置底', () => {
  const before = seed([shape('a'), shape('b', { x: 500 }), shape('c', { x: 1000 })])
  for (const operation of ['forward', 'backward', 'front', 'back']) {
    const command = { type: 'reorder_shapes', ids: ['shape:b'], operation }
    // MIT 的索引分配含随机后缀，比较实际顺序和其余完整记录，不要求独立调用字节相同。
    const semantic = result => ({ order: order(result.snapshot), records: Object.values(result.snapshot.store).map(({ index, ...record }) => record) })
    assert.deepEqual(semantic(run(before, command)), semantic(run(before, { ...command, mode: 'adjacent' })))
    if (['front', 'back'].includes(operation)) assert.deepEqual(semantic(run(before, command)), semantic(run(before, { ...command, mode: 'overlapping' })))
  }
})

for (const nested of [false, true]) test(`适配框留白50，内容画布坐标和旋转不变：${nested ? '旋转父框' : '根级'}`, () => {
  const before = seed([
    ...(nested ? [shape('parent', { shapeType: 'frame', x: -40, y: 100, rotation: -0.27, props: { w: 800, h: 600 } })] : []),
    shape('frame', { shapeType: 'frame', parentId: nested ? 'shape:parent' : undefined, x: 750, y: 100, rotation: nested ? 0.43 : 0, props: { w: 300, h: 300 } }),
    shape('a', { parentId: 'shape:frame', x: 50, y: 70, props: { w: 60, h: 40 } }),
  ])
  const result = run(before, { type: 'fit_frame_to_content', ids: ['shape:frame'], padding: 50 })
  const frame = result.snapshot.store['shape:frame'], child = result.snapshot.store['shape:a']
  assert.equal(frame.props.w, 160); assert.equal(frame.props.h, 140)
  assert.equal(child.x, 50); assert.equal(child.y, 50)
  assert.equal(frame.rotation, before.store[frame.id].rotation)
  if (!nested) { assert.equal(frame.x, 750); assert.equal(frame.y, 120) }
  const a = getShapePageBounds(before, child.id), b = getShapePageBounds(result.snapshot, child.id)
  for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(a[key] - b[key]) < 1e-9, key)
  reversible(before, result)
  assert.deepEqual(run(result.snapshot, { type: 'fit_frame_to_content', ids: [frame.id], padding: 50 }).changes, noChanges)
  const command = { type: 'fit_frame_to_content', ids: [frame.id] }
  assert.deepEqual(run(before, command), run(before, { ...command, padding: 0 }))
})

test('层序模式和画框留白无效或溢出时整批拒绝', () => {
  const before = seed([shape('frame', { shapeType: 'frame', props: { w: 300, h: 300 } }), shape('a', { parentId: 'shape:frame' })])
  const original = structuredClone(before)
  for (const command of [
    ...[null, 'other', 1, {}].map(mode => ({ type: 'reorder_shapes', ids: ['shape:a'], operation: 'forward', mode })),
    ...[null, -1, NaN, Infinity, '50', Number.MAX_VALUE].map(padding => ({ type: 'fit_frame_to_content', ids: ['shape:frame'], padding })),
  ]) {
    assert.throws(() => run(before, { type: 'toggle_lock', ids: ['shape:a'] }, command), CanvasEditError)
    assert.deepEqual(before, original)
  }
})
