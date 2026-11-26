import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { createCanvasSnapshot } from '../model/index.js'
import * as engine from '../engine/index.js'

const shape = (id, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'geo', ...extra })

function edit(snapshot, history, actor, commands) {
  const result = engine.executeCanvasCommands(snapshot, commands)
  return { ...result, history: engine.recordCanvasTransaction(history, actor, result.changes) }
}

function expectConflict(snapshot, history, actor, direction = 'undo') {
  const before = structuredClone({ snapshot, history })
  const operation = direction === 'undo' ? engine.undoCanvasTransaction : engine.redoCanvasTransaction
  assert.throws(() => operation(snapshot, history, actor), error => error instanceof engine.CanvasEditError && error.code === 'conflict' && error.message.length > 0)
  assert.deepEqual({ snapshot, history }, before, '拒绝时不改画板和历史')
}

test('单人连续编辑、撤销与重做可往返，历史能经 JSON 保存', () => {
  const initial = createCanvasSnapshot()
  const first = edit(initial, undefined, 'U', [shape('one')])
  const final = edit(first.snapshot, first.history, 'U', [{ type: 'update', id: 'shape:one', changes: { x: 40 } }])
  const once = engine.undoCanvasTransaction(final.snapshot, JSON.parse(JSON.stringify(final.history)), 'U')
  assert.deepEqual(once.snapshot, first.snapshot)
  assert.deepEqual(once.changes.updated['shape:one'], [...final.changes.updated['shape:one']].reverse())
  const twice = engine.undoCanvasTransaction(once.snapshot, once.history, 'U')
  assert.deepEqual(twice.snapshot, initial)
  const redoOnce = engine.redoCanvasTransaction(twice.snapshot, twice.history, 'U')
  const redoTwice = engine.redoCanvasTransaction(redoOnce.snapshot, redoOnce.history, 'U')
  assert.deepEqual(redoTwice.snapshot, final.snapshot)
  expectConflict(twice.snapshot, twice.history, 'U')
  expectConflict(redoTwice.snapshot, redoTwice.history, 'U', 'redo')
})

test('三名操作者交错编辑，各自撤销只影响自己的记录', () => {
  let state = { snapshot: createCanvasSnapshot(), history: undefined }
  const initial = structuredClone(state.snapshot)
  for (const actor of ['U', 'AI甲', 'AI乙']) state = edit(state.snapshot, state.history, actor, [shape(actor)])
  for (const actor of ['AI甲', 'U', 'AI乙']) {
    const result = engine.undoCanvasTransaction(state.snapshot, state.history, actor)
    assert.deepEqual(Object.keys(result.changes.removed), [`shape:${actor}`])
    state = result
  }
  assert.deepEqual(state.snapshot, initial)
})

test('记录被别人改过时拒绝旧撤销，最近操作者可正常撤销', () => {
  const initial = engine.executeCanvasCommands(createCanvasSnapshot(), [shape('shared')]).snapshot
  const first = edit(initial, undefined, 'AI甲', [{ type: 'update', id: 'shape:shared', changes: { x: 20 } }])
  const last = edit(first.snapshot, first.history, 'U', [{ type: 'update', id: 'shape:shared', changes: { x: 80 } }])
  expectConflict(last.snapshot, last.history, 'AI甲')
  const undone = engine.undoCanvasTransaction(last.snapshot, last.history, 'U')
  assert.deepEqual(undone.snapshot, first.snapshot)
  assert.deepEqual(engine.undoCanvasTransaction(undone.snapshot, undone.history, 'AI甲').snapshot, initial)
})

test('别人加入框内的子形状不随创建者的撤销一起删除', () => {
  const frame = edit(createCanvasSnapshot(), undefined, 'AI甲', [shape('frame', { shapeType: 'frame' })])
  const child = edit(frame.snapshot, frame.history, 'AI乙', [shape('child', { parentId: 'shape:frame' })])
  expectConflict(child.snapshot, child.history, 'AI甲')
})

test('别人新增到该形状的绑定不随创建者的撤销一起删除', () => {
  const frame = edit(createCanvasSnapshot(), undefined, 'AI甲', [shape('frame', { shapeType: 'frame' })])
  const binding = { id: 'binding:new', typeName: 'binding', type: 'arrow', fromId: 'shape:arrow', toId: 'shape:frame', props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: true, snap: 'none' }, meta: {} }
  const linked = edit(frame.snapshot, frame.history, 'AI乙', [shape('arrow', { shapeType: 'arrow' }), { type: 'put', record: binding }])
  expectConflict(linked.snapshot, linked.history, 'AI甲')
  const unlinked = engine.undoCanvasTransaction(linked.snapshot, linked.history, 'AI乙')
  const removedFrame = engine.undoCanvasTransaction(unlinked.snapshot, unlinked.history, 'AI甲')
  const restoredFrame = engine.redoCanvasTransaction(removedFrame.snapshot, removedFrame.history, 'AI甲')
  assert.deepEqual(engine.redoCanvasTransaction(restoredFrame.snapshot, restoredFrame.history, 'AI乙').snapshot, linked.snapshot)
})

test('删除后的 ID 被复用、或事务后的记录消失，均拒绝撤销', () => {
  const created = edit(createCanvasSnapshot(), undefined, 'AI甲', [shape('shared')])
  const deleted = edit(created.snapshot, created.history, 'AI甲', [{ type: 'delete', ids: ['shape:shared'] }])
  const reused = edit(deleted.snapshot, deleted.history, 'U', [shape('shared', { x: 99 })])
  expectConflict(reused.snapshot, reused.history, 'AI甲')
  expectConflict(deleted.snapshot, created.history, 'AI甲')
})

test('倒放导致父子关系失效时整次拒绝', () => {
  const original = engine.executeCanvasCommands(createCanvasSnapshot(), [shape('frame', { shapeType: 'frame' }), shape('child', { parentId: 'shape:frame' })]).snapshot
  const moved = edit(original, undefined, 'AI甲', [{ type: 'update', id: 'shape:child', changes: { parentId: 'page:page' } }])
  const deletedParent = edit(moved.snapshot, moved.history, 'AI乙', [{ type: 'delete', ids: ['shape:frame'] }])
  expectConflict(deletedParent.snapshot, deletedParent.history, 'AI甲')
})

test('新编辑只清空自己的重做，操作者字符串不作为对象属性解释', () => {
  let state = { snapshot: createCanvasSnapshot(), history: undefined }
  for (const actor of ['__proto__', 'constructor']) state = edit(state.snapshot, state.history, actor, [shape(actor)])
  for (const actor of ['__proto__', 'constructor']) state = engine.undoCanvasTransaction(state.snapshot, state.history, actor)
  state = edit(state.snapshot, state.history, '__proto__', [shape('replacement')])
  expectConflict(state.snapshot, state.history, '__proto__', 'redo')
  state = engine.redoCanvasTransaction(state.snapshot, state.history, 'constructor')
  assert.ok(state.snapshot.store['shape:constructor'])
  assert.ok(state.snapshot.store['shape:replacement'])
})

test('历史采用调用方实际保存后的 changes，且记录和输入没有共享引用', () => {
  const result = engine.executeCanvasCommands(createCanvasSnapshot(), [shape('saved')])
  result.changes.added['shape:saved'].meta.savedUrl = 'assets/synthetic.png'
  result.snapshot.store['shape:saved'].meta.savedUrl = 'assets/synthetic.png'
  const before = structuredClone(result.changes)
  const history = engine.recordCanvasTransaction(undefined, 'U', result.changes)
  result.changes.added['shape:saved'].meta.savedUrl = 'changed-after-recording'
  const undone = engine.undoCanvasTransaction(result.snapshot, history, 'U')
  assert.deepEqual(undone.changes.removed['shape:saved'], before.added['shape:saved'])
  assert.equal(undone.snapshot.store['shape:saved'], undefined)
})

test('撤销和重做整体恢复超过 600 条记录的级联删除，一条冲突则全部拒绝', () => {
  const commands = [shape('large-frame', { shapeType: 'frame' }), ...Array.from({ length: 610 }, (_, i) => shape(`large-${i}`, { parentId: 'shape:large-frame' }))]
  let original = createCanvasSnapshot()
  for (let i = 0; i < commands.length; i += 500) original = engine.executeCanvasCommands(original, commands.slice(i, i + 500)).snapshot
  const deleted = edit(original, undefined, 'AI甲', [{ type: 'delete', ids: ['shape:large-frame'] }])
  assert.ok(Object.keys(deleted.changes.removed).length > 600)
  const undone = engine.undoCanvasTransaction(deleted.snapshot, deleted.history, 'AI甲')
  assert.deepEqual(undone.snapshot, original)
  assert.deepEqual(engine.redoCanvasTransaction(undone.snapshot, undone.history, 'AI甲').snapshot, deleted.snapshot)
  const reused = engine.executeCanvasCommands(deleted.snapshot, [shape('large-frame', { shapeType: 'frame', x: 5 })])
  expectConflict(reused.snapshot, deleted.history, 'AI甲')
  assert.throws(() => engine.executeCanvasCommands(original, Array(20001).fill({ type: 'delete', ids: [] })), error => error instanceof engine.CanvasEditError && /20000/.test(error.message), '公开命令上限仍然生效')
})

test('别人在撤销后修改记录或加入子形状，重做也不能覆盖或级联删除', () => {
  const created = engine.executeCanvasCommands(createCanvasSnapshot(), [shape('frame', { shapeType: 'frame' })]).snapshot
  const deleted = edit(created, undefined, 'AI甲', [{ type: 'delete', ids: ['shape:frame'] }])
  const undone = engine.undoCanvasTransaction(deleted.snapshot, deleted.history, 'AI甲')
  const child = edit(undone.snapshot, undone.history, 'AI乙', [shape('child', { parentId: 'shape:frame' })])
  expectConflict(child.snapshot, child.history, 'AI甲', 'redo')
  const changed = edit(undone.snapshot, undone.history, 'AI乙', [{ type: 'update', id: 'shape:frame', changes: { props: { name: '乙的框' } } }])
  expectConflict(changed.snapshot, changed.history, 'AI甲', 'redo')
})

test('一次事务的多条变化中有一条冲突，其他可倒放的记录也保持原状', () => {
  const first = edit(createCanvasSnapshot(), undefined, 'U', [shape('one'), shape('two')])
  const other = edit(first.snapshot, first.history, 'AI乙', [{ type: 'update', id: 'shape:two', changes: { meta: { nested: { changed: true } } } }])
  expectConflict(other.snapshot, other.history, 'U')
})

test('倒放的记录也通过数据模型校验，坏属性不进入画板', () => {
  const current = engine.executeCanvasCommands(createCanvasSnapshot(), [shape('valid')]).snapshot
  const after = current.store['shape:valid']
  const before = { ...after, x: 'invalid' }
  const history = engine.recordCanvasTransaction(undefined, 'U', { added: {}, updated: { [after.id]: [before, after] }, removed: {} })
  expectConflict(current, history, 'U')
})

test('每人历史有独立上限，新空事务不清空重做记录', () => {
  let state = edit(createCanvasSnapshot(), undefined, 'other', [shape('other')])
  for (let i = 0; i < 250; i++) state = edit(state.snapshot, state.history, 'U', [shape(`limit-${i}`)])
  const count = state.history.actors.find(entry => entry.actor === 'U').undo.length
  assert.ok(count > 1 && count < 250, '历史有界且保留多次事务')
  assert.equal(state.history.actors.find(entry => entry.actor === 'other').undo.length, 1)
  const latest = structuredClone(state.snapshot)
  for (let i = 0; i < count; i++) state = engine.undoCanvasTransaction(state.snapshot, state.history, 'U')
  expectConflict(state.snapshot, state.history, 'U')
  state.history = engine.recordCanvasTransaction(state.history, 'U', { added: {}, updated: {}, removed: {} })
  for (let i = 0; i < count; i++) state = engine.redoCanvasTransaction(state.snapshot, state.history, 'U')
  assert.deepEqual(state.snapshot, latest)
  assert.ok(engine.undoCanvasTransaction(state.snapshot, state.history, 'other').snapshot.store['shape:limit-0'])
})

test('记录入口拒绝不完整或不能经 JSON 保存的历史和变化，不修改输入', () => {
  const changes = engine.executeCanvasCommands(createCanvasSnapshot(), [shape('input')]).changes
  const history = engine.recordCanvasTransaction(undefined, 'U', changes)
  const before = structuredClone({ history, changes })
  for (const actor of [null, 7, {}]) assert.throws(() => engine.recordCanvasTransaction(history, actor, changes), engine.CanvasEditError)
  for (const invalid of [{}, { ...changes, added: [] }, { ...changes, updated: { 'shape:input': [changes.added['shape:input']] } }, { ...changes, removed: changes.added }]) {
    assert.throws(() => engine.recordCanvasTransaction(history, 'U', invalid), engine.CanvasEditError)
  }
  const unsupported = structuredClone(changes)
  unsupported.added['shape:input'].meta.notJson = undefined
  assert.throws(() => engine.recordCanvasTransaction(history, 'U', unsupported), engine.CanvasEditError)
  assert.throws(() => engine.recordCanvasTransaction({ actors: [{ actor: 'U', undo: {}, redo: [] }] }, 'U', changes), engine.CanvasEditError)
  assert.deepEqual({ history, changes }, before)
})

test('开发模式下所有返回数据可修改，且不与输入或相邻返回字段共享引用', () => {
  const script = `
    import assert from 'node:assert/strict'
    import { createCanvasSnapshot } from './model/index.js'
    import { executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction } from './engine/index.js'
    const initial = createCanvasSnapshot()
    const created = executeCanvasCommands(initial, [{ type: 'create_shape', id: 'shape:dev', shapeType: 'geo' }])
    const history = recordCanvasTransaction(undefined, '', created.changes)
    const inputs = structuredClone({ initial, created, history })
    const undone = undoCanvasTransaction(created.snapshot, history, '')
    const redone = redoCanvasTransaction(undone.snapshot, undone.history, '')
    const beforeUndo = structuredClone(undone)
    redone.snapshot.store['shape:dev'].props.w = 20
    assert.equal(redone.changes.added['shape:dev'].props.w, 200)
    redone.changes.added['shape:dev'].props.w = 30
    assert.equal(redone.history.actors[0].undo[0].added['shape:dev'].props.w, 200)
    redone.history.actors[0].undo[0].added['shape:dev'].props.w = 40
    assert.deepEqual(undone, beforeUndo)
    undone.changes.removed['shape:dev'].props.w = 50
    assert.equal(undone.history.actors[0].redo[0].removed['shape:dev'].props.w, 200)
    undone.history.actors[0].redo[0].removed['shape:dev'].props.w = 60
    assert.deepEqual({ initial, created, history }, inputs)
  `
  const result = spawnSync(process.execPath, ['--import', './tools/test-sandbox.mjs', '--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), env: { ...process.env, NODE_ENV: 'development' }, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
