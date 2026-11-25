import '../tools/test-sandbox.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction, CanvasEditError } from '../engine/index.js'

const id = name => `shape:${name}`
const shape = (name, extra = {}) => ({ type: 'create_shape', id: id(name), shapeType: 'geo', ...extra })
const run = (snapshot, ...commands) => executeCanvasCommands(snapshot, commands)
const emptyChanges = { added: {}, updated: {}, removed: {} }

function seed(names = ['A', 'B', 'C', 'D', 'E']) {
  return executeCanvasCommands(createCanvasSnapshot(), names.map(name => shape(name))).snapshot
}

function order(snapshot, parentId = 'page:page') {
  return Object.values(snapshot.store).filter(record => record.typeName === 'shape' && record.parentId === parentId).sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : 0).map(record => record.id)
}

function reorder(snapshot, names, operation) {
  return run(snapshot, { type: 'reorder_shapes', ids: names.map(id), operation })
}

test('四种层级操作维持目标间顺序，前后移只越过一个未列出的同级形状', () => {
  const initial = seed()
  const before = structuredClone(initial)
  for (const [operation, names, expected] of [
    ['front', ['C', 'A'], ['B', 'D', 'E', 'A', 'C']],
    ['back', ['D', 'B'], ['B', 'D', 'A', 'C', 'E']],
    ['forward', ['A', 'C'], ['B', 'A', 'D', 'C', 'E']],
    ['backward', ['C', 'E'], ['A', 'C', 'B', 'E', 'D']],
    ['forward', ['A', 'B'], ['C', 'A', 'B', 'D', 'E']],
    ['backward', ['D', 'E'], ['A', 'B', 'D', 'E', 'C']],
    ['forward', ['A', 'D', 'E'], ['B', 'A', 'C', 'D', 'E']],
    ['backward', ['A', 'B', 'E'], ['A', 'B', 'C', 'E', 'D']],
  ]) {
    const result = reorder(initial, names, operation)
    assert.deepEqual(order(result.snapshot), expected.map(id), `${operation}: ${names}`)
    assert.deepEqual(result.changes.added, {})
    assert.deepEqual(result.changes.removed, {})
    for (const recordId of Object.keys(result.changes.updated)) assert.ok(names.map(id).includes(recordId), '不改其他形状的层级')
    const indices = order(result.snapshot).map(recordId => result.snapshot.store[recordId].index)
    assert.equal(new Set(indices).size, indices.length)
  }
  assert.deepEqual(initial, before)
})

test('不同父容器分别排序，父容器和子形状同时列出也互不串层', () => {
  const initial = executeCanvasCommands(createCanvasSnapshot(), [shape('F', { shapeType: 'frame' }), shape('G', { shapeType: 'group' }), ...['A', 'B', 'C'].map(name => shape(name, { parentId: id('F') })), ...['X', 'Y', 'Z'].map(name => shape(name, { parentId: id('G') }))]).snapshot
  const result = reorder(initial, ['F', 'A', 'Y'], 'front')
  assert.deepEqual(order(result.snapshot), ['G', 'F'].map(id))
  assert.deepEqual(order(result.snapshot, id('F')), ['B', 'C', 'A'].map(id))
  assert.deepEqual(order(result.snapshot, id('G')), ['X', 'Z', 'Y'].map(id))
  for (const record of Object.values(result.snapshot.store).filter(record => record.typeName === 'shape')) assert.equal(record.parentId, initial.store[record.id].parentId)
})

test('已经到达层级边界、全体同级或空列表时不产生变化', () => {
  const initial = seed()
  for (const [operation, names] of [['front', ['D', 'E']], ['back', ['A', 'B']], ['forward', ['E']], ['backward', ['A']], ['front', ['A', 'B', 'C', 'D', 'E']], ['back', []]]) {
    const result = reorder(initial, names, operation)
    assert.deepEqual(result.snapshot, initial)
    assert.deepEqual(result.changes, emptyChanges)
  }
})

test('层级索引很接近时依然唯一，重复 ID 不会移动两层', () => {
  const initial = seed(['A', 'B', 'C'])
  initial.store[id('A')].index = 'a1'
  initial.store[id('B')].index = 'a10V'
  initial.store[id('C')].index = 'a11'
  const result = reorder(initial, ['A', 'A'], 'forward')
  assert.deepEqual(order(result.snapshot), ['B', 'A', 'C'].map(id))
  assert.ok(result.snapshot.store[id('A')].index > 'a10V' && result.snapshot.store[id('A')].index < 'a11')
})

test('所有目标组合都保持两组各自顺序，每次前后移恰好跨过一个可跨过的邻居', () => {
  const names = ['A', 'B', 'C', 'D', 'E']
  const initial = seed(names)
  for (let mask = 0; mask < 2 ** names.length; mask++) {
    const selected = names.filter((_, i) => mask & (1 << i))
    const selectedIds = new Set(selected.map(id))
    const unselected = names.filter(name => !selected.includes(name)).map(id)
    for (const operation of ['front', 'forward', 'backward', 'back']) {
      const result = reorder(initial, [...selected].reverse(), operation)
      const actual = order(result.snapshot)
      assert.deepEqual(actual.filter(recordId => selectedIds.has(recordId)), selected.map(id))
      assert.deepEqual(actual.filter(recordId => !selectedIds.has(recordId)), unselected)
      assert.equal(new Set(actual.map(recordId => result.snapshot.store[recordId].index)).size, names.length)
      for (const name of selected) {
        const oldBefore = names.slice(0, names.indexOf(name)).filter(item => !selected.includes(item)).length
        const newBefore = actual.slice(0, actual.indexOf(id(name))).filter(recordId => !selectedIds.has(recordId)).length
        const expected = operation === 'front' ? unselected.length : operation === 'back' ? 0 : operation === 'forward' ? Math.min(oldBefore + 1, unselected.length) : Math.max(oldBefore - 1, 0)
        assert.equal(newBefore, expected, `${operation}: ${selected}; ${name}`)
      }
    }
  }
})

test('混合锁定状态统一锁定，全锁时统一解锁，全部解锁包含各父容器子形状', () => {
  const initial = executeCanvasCommands(seed(['A', 'B']), [shape('F', { shapeType: 'frame' }), shape('child', { parentId: id('F') }), { type: 'update', id: id('A'), changes: { isLocked: true } }, { type: 'update', id: id('child'), changes: { isLocked: true } }]).snapshot
  const locked = run(initial, { type: 'toggle_lock', ids: ['A', 'B', 'A'].map(id) })
  assert.equal(locked.snapshot.store[id('A')].isLocked, true)
  assert.equal(locked.snapshot.store[id('B')].isLocked, true)
  assert.deepEqual(Object.keys(locked.changes.updated), [id('B')])
  const unlocked = run(locked.snapshot, { type: 'toggle_lock', ids: ['A', 'B'].map(id) })
  assert.equal(unlocked.snapshot.store[id('A')].isLocked, false)
  assert.equal(unlocked.snapshot.store[id('B')].isLocked, false)
  assert.equal(unlocked.snapshot.store[id('child')].isLocked, true)
  const all = run(locked.snapshot, { type: 'unlock_all' })
  for (const record of Object.values(all.snapshot.store).filter(record => record.typeName === 'shape')) assert.equal(record.isLocked, false)
  assert.deepEqual(run(all.snapshot, { type: 'unlock_all' }).changes, emptyChanges)
})

test('微移按画布方向换算父链旋转，忽略父链平移和形状自身旋转', () => {
  const initial = executeCanvasCommands(createCanvasSnapshot(), [
    shape('F', { shapeType: 'frame', rotation: Math.PI / 2, x: 300, y: 200 }),
    shape('G', { shapeType: 'group', parentId: id('F'), rotation: Math.PI / 6, x: 100, y: 80 }),
    shape('nested', { parentId: id('G'), x: 20, y: 30, rotation: Math.PI / 4 }),
    shape('child', { parentId: id('F'), x: 3, y: 5 }),
    shape('root', { x: 8, y: 9, rotation: Math.PI / 3 }),
  ]).snapshot
  const before = structuredClone(initial)
  const result = run(initial, { type: 'nudge_shapes', ids: ['nested', 'child', 'root'].map(id), delta: { x: 10, y: 0 } })
  const nested = result.snapshot.store[id('nested')]
  assert.ok(Math.abs(nested.x - 15) < 1e-10)
  assert.ok(Math.abs(nested.y - (30 - 5 * Math.sqrt(3))) < 1e-10)
  assert.ok(Math.abs(result.snapshot.store[id('child')].x - 3) < 1e-10)
  assert.ok(Math.abs(result.snapshot.store[id('child')].y + 5) < 1e-10)
  assert.equal(result.snapshot.store[id('root')].x, 18)
  assert.equal(result.snapshot.store[id('root')].y, 9)
  for (const name of ['nested', 'child', 'root']) assert.equal(result.snapshot.store[id(name)].rotation, initial.store[id(name)].rotation)
  assert.deepEqual(initial, before)
})

test('祖先与子孙同在列表时只移动最高层祖先，重复 ID 也只移一次', () => {
  const initial = executeCanvasCommands(createCanvasSnapshot(), [shape('F', { shapeType: 'frame', rotation: Math.PI / 2 }), shape('G', { shapeType: 'group', parentId: id('F'), x: 10 }), shape('child', { parentId: id('G'), x: 20 }), shape('other')]).snapshot
  const result = run(initial, { type: 'nudge_shapes', ids: ['child', 'G', 'F', 'other', 'F'].map(id), delta: { x: -3, y: 7 } })
  assert.deepEqual(Object.keys(result.changes.updated).sort(), ['F', 'other'].map(id).sort())
  for (const name of ['F', 'other']) {
    assert.equal(result.snapshot.store[id(name)].x, -3)
    assert.equal(result.snapshot.store[id(name)].y, 7)
  }
  for (const name of ['G', 'child']) assert.deepEqual(result.snapshot.store[id(name)], initial.store[id(name)])
  const nestedOnly = run(initial, { type: 'nudge_shapes', ids: ['child', 'G'].map(id), delta: { x: -3, y: 7 } })
  assert.deepEqual(Object.keys(nestedOnly.changes.updated), [id('G')])
  assert.ok(Math.abs(nestedOnly.snapshot.store[id('G')].x - 17) < 1e-10)
  assert.ok(Math.abs(nestedOnly.snapshot.store[id('G')].y - 3) < 1e-10)
})

test('锁定只是交互规则，微移和层级命令仍可显式修改已锁形状', () => {
  const initial = run(seed(['A', 'B']), { type: 'toggle_lock', ids: [id('A')] }).snapshot
  const result = run(initial, { type: 'nudge_shapes', ids: [id('A')], delta: { x: 2, y: -4 } }, { type: 'reorder_shapes', ids: [id('A')], operation: 'front' })
  assert.equal(result.snapshot.store[id('A')].x, 2)
  assert.equal(result.snapshot.store[id('A')].y, -4)
  assert.equal(result.snapshot.store[id('A')].isLocked, true)
  assert.deepEqual(order(result.snapshot), ['B', 'A'].map(id))
})

test('三类命令同批执行并可整体按操作者撤销和重做', () => {
  const initial = seed(['A', 'B', 'C'])
  const result = run(initial, { type: 'reorder_shapes', ids: [id('A')], operation: 'front' }, { type: 'toggle_lock', ids: [id('A'), id('B')] }, { type: 'nudge_shapes', ids: [id('A'), id('C')], delta: { x: 5, y: -8 } })
  const history = recordCanvasTransaction(undefined, 'AI甲', result.changes)
  const undone = undoCanvasTransaction(result.snapshot, history, 'AI甲')
  assert.deepEqual(undone.snapshot, initial)
  assert.deepEqual(redoCanvasTransaction(undone.snapshot, undone.history, 'AI甲').snapshot, result.snapshot)
})

test('别人占用了旧层级索引时撤销整次拒绝，不生成同级重复索引', () => {
  const initial = seed(['A', 'B', 'C'])
  initial.store[id('A')].index = 'a1'
  initial.store[id('B')].index = 'a2'
  initial.store[id('C')].index = 'a3'
  const first = reorder(initial, ['A'], 'front')
  const history = recordCanvasTransaction(undefined, 'U', first.changes)
  const latest = run(first.snapshot, { type: 'update', id: id('C'), changes: { index: 'a1' } })
  const before = structuredClone({ snapshot: latest.snapshot, history })
  assert.throws(() => undoCanvasTransaction(latest.snapshot, history, 'U'), error => error instanceof CanvasEditError && error.code === 'conflict' && error.message.includes(id('A')) && error.message.includes(id('C')))
  assert.deepEqual({ snapshot: latest.snapshot, history }, before)
})

test('实际置前置后交错后，旧索引被占用的撤销拒绝且输入不变', () => {
  const script = `
    import assert from 'node:assert/strict'
    import { createCanvasSnapshot } from './model/index.js'
    import { executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction } from './engine/index.js'
    const initial = executeCanvasCommands(createCanvasSnapshot(), ['A','B','C'].map(name => ({ type: 'create_shape', id: 'shape:'+name, shapeType: 'geo' }))).snapshot
    for (const [i, name] of ['A','B','C'].entries()) initial.store['shape:'+name].index = 'a'+(i+1)
    const first = executeCanvasCommands(initial, [{ type:'reorder_shapes', ids:['shape:A'], operation:'front' }])
    const history = recordCanvasTransaction(undefined, 'U', first.changes)
    const last = executeCanvasCommands(first.snapshot, [{ type:'reorder_shapes', ids:['shape:C'], operation:'back' }])
    assert.equal(last.snapshot.store['shape:C'].index, 'a1')
    const before = structuredClone({ snapshot:last.snapshot, history })
    assert.throws(() => undoCanvasTransaction(last.snapshot, history, 'U'), error => error.code === 'conflict' && /shape:A/.test(error.message) && /shape:C/.test(error.message))
    assert.deepEqual({ snapshot:last.snapshot, history }, before)
  `
  const result = spawnSync(process.execPath, ['--import', './tools/test-sandbox.mjs', '--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('撤销后别人占用目标索引，重做整次拒绝，恢复删除形状时也检查', () => {
  const initial = seed(['A', 'B'])
  const first = reorder(initial, ['A'], 'front')
  const history = recordCanvasTransaction(undefined, 'U', first.changes)
  const undone = undoCanvasTransaction(first.snapshot, history, 'U')
  const last = run(undone.snapshot, { type: 'update', id: id('B'), changes: { index: first.snapshot.store[id('A')].index } })
  const before = structuredClone({ snapshot: last.snapshot, history: undone.history })
  assert.throws(() => redoCanvasTransaction(last.snapshot, undone.history, 'U'), error => error.code === 'conflict' && error.message.includes(id('A')) && error.message.includes(id('B')))
  assert.deepEqual({ snapshot: last.snapshot, history: undone.history }, before)
  const deleted = run(initial, { type: 'delete', ids: [id('A')] })
  const deleteHistory = recordCanvasTransaction(undefined, 'U', deleted.changes)
  const taken = run(deleted.snapshot, { type: 'update', id: id('B'), changes: { index: initial.store[id('A')].index } })
  const takenBefore = structuredClone({ snapshot: taken.snapshot, history: deleteHistory })
  assert.throws(() => undoCanvasTransaction(taken.snapshot, deleteHistory, 'U'), error => error.code === 'conflict')
  assert.deepEqual({ snapshot: taken.snapshot, history: deleteHistory }, takenBefore)
})

test('恢复父容器按恢复后的同级检查，不拒绝别的容器或原事务内部的索引相同', () => {
  const initial = executeCanvasCommands(createCanvasSnapshot(), [shape('F', { shapeType: 'frame' }), shape('G', { shapeType: 'frame' }), shape('A', { parentId: id('F') }), shape('B', { parentId: id('G') })]).snapshot
  initial.store[id('A')].index = 'a1'
  initial.store[id('B')].index = 'a1'
  const moved = run(initial, { type: 'update', id: id('A'), changes: { parentId: id('G'), index: 'a2' } })
  const history = recordCanvasTransaction(undefined, 'U', moved.changes)
  assert.deepEqual(undoCanvasTransaction(moved.snapshot, history, 'U').snapshot, initial, '别的父容器相同索引不冲突')
  const occupied = run(moved.snapshot, shape('C', { parentId: id('F') }), { type: 'update', id: id('C'), changes: { index: 'a1' } })
  const before = structuredClone({ snapshot: occupied.snapshot, history })
  assert.throws(() => undoCanvasTransaction(occupied.snapshot, history, 'U'), error => error.code === 'conflict' && error.message.includes(id('C')))
  assert.deepEqual({ snapshot: occupied.snapshot, history }, before)
  const legacy = seed(['A', 'B'])
  legacy.store[id('A')].index = legacy.store[id('B')].index = 'a1'
  const changed = run(legacy, { type: 'update', id: id('A'), changes: { index: 'a2' } }, { type: 'update', id: id('B'), changes: { index: 'a3' } })
  const ownHistory = recordCanvasTransaction(undefined, 'U', changed.changes)
  assert.deepEqual(undoCanvasTransaction(changed.snapshot, ownHistory, 'U').snapshot, legacy, '同一次事务自己的记录一起恢复，不做全局唯一性校验')
})

test('空列表和零位移成功且不产生变化', () => {
  const initial = seed()
  const result = run(initial, { type: 'toggle_lock', ids: [] }, { type: 'nudge_shapes', ids: [], delta: { x: 3, y: 2 } }, { type: 'nudge_shapes', ids: [id('A')], delta: { x: 0, y: 0 } })
  assert.deepEqual(result.changes, emptyChanges)
  assert.deepEqual(result.snapshot, initial)
})

test('参数或目标无效时整批拒绝，包括前面的有效操作', () => {
  const initial = seed()
  const before = structuredClone(initial)
  const invalid = [
    { type: 'reorder_shapes', ids: [id('A')], operation: 'unknown' },
    ...['reorder_shapes', 'toggle_lock', 'nudge_shapes'].flatMap(type => [null, 'A', [7], ['page:page'], [id('missing')], [id('A'), id('missing')]].map(ids => ({ type, ids, operation: 'front', delta: { x: 1, y: 2 } }))),
    ...[null, {}, { x: 1 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: '1', y: 0 }].map(delta => ({ type: 'nudge_shapes', ids: [id('A')], delta })),
  ]
  for (const command of invalid) {
    assert.throws(() => run(initial, { type: 'toggle_lock', ids: [id('A')] }, command), error => error instanceof CanvasEditError && error.code === 'invalid-input')
    assert.deepEqual(initial, before)
  }
})

test('微移的计算结果溢出、父链循环或父容器缺失时不导出坏快照', () => {
  const large = executeCanvasCommands(createCanvasSnapshot(), [shape('large', { x: Number.MAX_VALUE })]).snapshot
  const before = structuredClone(large)
  assert.throws(() => run(large, { type: 'nudge_shapes', ids: [id('large')], delta: { x: Number.MAX_VALUE, y: 0 } }), CanvasEditError)
  assert.deepEqual(large, before)
  for (const parentId of [id('missing'), id('child')]) {
    const invalid = executeCanvasCommands(createCanvasSnapshot(), [shape('F', { shapeType: 'frame' }), shape('child', { parentId: id('F') })]).snapshot
    invalid.store[id('F')].parentId = parentId
    const original = structuredClone(invalid)
    assert.throws(() => run(invalid, { type: 'nudge_shapes', ids: [id('child')], delta: { x: 1, y: 2 } }), CanvasEditError)
    assert.deepEqual(invalid, original)
  }
})

test('开发模式的输入只读也能执行，输出与输入和 changes 不共享引用', () => {
  const script = `
    import assert from 'node:assert/strict'
    import { createCanvasSnapshot } from './model/index.js'
    import { executeCanvasCommands } from './engine/index.js'
    const initial = executeCanvasCommands(createCanvasSnapshot(), ['A','B'].map(name => ({ type: 'create_shape', id: 'shape:'+name, shapeType: 'geo' }))).snapshot
    const before = structuredClone(initial)
    const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze) } }
    freeze(initial)
    const result = executeCanvasCommands(initial, [{ type: 'reorder_shapes', ids: ['shape:A'], operation: 'front' }, { type: 'toggle_lock', ids: ['shape:A'] }, { type: 'nudge_shapes', ids: ['shape:A'], delta: { x: 3, y: 4 } }, { type: 'unlock_all' }])
    assert.deepEqual(initial, before)
    result.snapshot.store['shape:A'].meta.changed = true
    assert.equal(result.changes.updated['shape:A'][1].meta.changed, undefined)
    result.changes.updated['shape:A'][1].x = 90
    assert.equal(result.snapshot.store['shape:A'].x, 3)
  `
  const result = spawnSync(process.execPath, ['--import', './tools/test-sandbox.mjs', '--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), env: { ...process.env, NODE_ENV: 'development' }, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
