import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction, createEditorSession, CanvasEditError } from '../engine/index.js'
import { getShapeBounds, getShapePageBounds, shapeToPagePoint, hitTestCanvas } from '../renderer/geometry.js'
import { memoryHost, snapshotOf as sessionSnapshot } from './fixtures/editor-session-fixture.mjs'

const shape = (id, fields = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'geo', ...fields })
const initial = commands => executeCanvasCommands(createCanvasSnapshot(), commands).snapshot
function close(actual, expected) {
  for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} 应接近 ${expected[key]}`)
}
function reversible(before, result) {
  const history = recordCanvasTransaction(undefined, 'synthetic', result.changes)
  const undone = undoCanvasTransaction(result.snapshot, history, 'synthetic')
  assert.deepEqual(undone.snapshot, before)
  assert.deepEqual(redoCanvasTransaction(undone.snapshot, undone.history, 'synthetic').snapshot, result.snapshot)
}

for (const rotatedParent of [false, true]) test(`组合解组保留全部记录与画布位置：${rotatedParent ? '旋转父容器' : '根级'}`, () => {
  const parentId = rotatedParent ? 'shape:parent' : undefined
  const before = initial([
    ...(rotatedParent ? [shape('parent', { shapeType: 'frame', x: 80, y: -50, rotation: 0.37 })] : []),
    shape('a', { parentId, x: 20, y: 30, props: { w: 60, h: 40 }, meta: { note: '保留' } }),
    shape('between', { parentId, x: 90, y: 100 }),
    shape('b', { parentId, x: 150, y: 80, rotation: 0.2, props: { w: 50, h: 30 } }),
    shape('above', { parentId, x: 400, y: 300 }),
  ])
  const grouped = executeCanvasCommands(before, [{ type: 'group_shapes', ids: ['shape:b', 'shape:a', 'shape:a'], groupId: 'shape:group' }])
  const group = grouped.snapshot.store['shape:group']
  assert.equal(grouped.results[0].groupId, group.id)
  assert.equal(group.type, 'group')
  assert.equal(group.parentId, before.store['shape:a'].parentId)
  assert.equal(group.index, before.store['shape:b'].index)
  assert.deepEqual(group.props, {})
  for (const id of ['shape:a', 'shape:b']) {
    assert.equal(grouped.snapshot.store[id].parentId, group.id)
    close(getShapePageBounds(grouped.snapshot, id), getShapePageBounds(before, id))
  }
  reversible(before, grouped)
  const ungrouped = executeCanvasCommands(grouped.snapshot, [{ type: 'ungroup_shapes', ids: [group.id] }])
  assert.deepEqual(ungrouped.snapshot, before)
  reversible(grouped.snapshot, ungrouped)
})

test('跨旋转父容器的组合放在共同祖先下，画布位置与各自旋转保持', () => {
  const before = initial([
    shape('f1', { shapeType: 'frame', x: 100, y: 80, rotation: 0.3 }),
    shape('f2', { shapeType: 'frame', x: 500, y: 120, rotation: -0.4 }),
    shape('a', { parentId: 'shape:f1', x: 20, y: 30 }),
    shape('b', { parentId: 'shape:f2', x: 40, y: 20 }),
  ])
  const grouped = executeCanvasCommands(before, [{ type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:cross' }])
  assert.equal(grouped.snapshot.store['shape:cross'].parentId, 'page:page')
  for (const id of ['shape:a', 'shape:b']) {
    close(shapeToPagePoint(grouped.snapshot, id, { x: 0, y: 0 }), shapeToPagePoint(before, id, { x: 0, y: 0 }))
    close(getShapePageBounds(grouped.snapshot, id), getShapePageBounds(before, id))
  }
  reversible(before, grouped)
})

test('组外框实时取全部子孙的画布外框并集，移动不改组的原点', () => {
  const before = initial([shape('a', { x: 20, y: 30, props: { w: 60, h: 40 } }), shape('b', { x: 150, y: 80, props: { w: 50, h: 30 } })])
  const grouped = executeCanvasCommands(before, [{ type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }]).snapshot
  assert.equal(getShapeBounds(grouped.store['shape:g']), null)
  close(getShapePageBounds(grouped, 'shape:g'), { x: 20, y: 30, w: 180, h: 80 })
  const moved = executeCanvasCommands(grouped, [{ type: 'update', id: 'shape:a', changes: { x: -30, y: -20 } }])
  assert.deepEqual(moved.snapshot.store['shape:g'], grouped.store['shape:g'])
  close(getShapePageBounds(moved.snapshot, 'shape:g'), { x: -10, y: 10, w: 210, h: 100 })
  reversible(grouped, moved)
})

test('子形状删除或换父后统一清理单子组与空组，撤销准确恢复整次变化', () => {
  const before = initial([shape('a', { x: 20, y: 30 }), shape('b', { x: 150, y: 80 })])
  const grouped = executeCanvasCommands(before, [{ type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }]).snapshot
  const single = executeCanvasCommands(grouped, [{ type: 'delete', ids: ['shape:a'] }])
  assert.equal(single.snapshot.store['shape:g'], undefined)
  assert.deepEqual(single.snapshot.store['shape:b'], before.store['shape:b'])
  reversible(grouped, single)
  const empty = executeCanvasCommands(grouped, [{ type: 'delete', ids: ['shape:a', 'shape:b'] }])
  assert.equal(empty.snapshot.store['shape:g'], undefined)
  reversible(grouped, empty)
  const movedOut = executeCanvasCommands(grouped, [{ type: 'update', id: 'shape:a', changes: { parentId: 'page:page', x: 700 } }])
  assert.equal(movedOut.snapshot.store['shape:g'], undefined)
  assert.deepEqual(movedOut.snapshot.store['shape:b'], before.store['shape:b'])
  reversible(grouped, movedOut)
})

for (const rotatedParent of [false, true]) test(`画框恰好适配内容，子形状画布位置保持：${rotatedParent ? '旋转父容器' : '根级'}`, () => {
  const before = initial([
    ...(rotatedParent ? [shape('parent', { shapeType: 'frame', x: -40, y: 100, rotation: -0.27 })] : []),
    shape('frame', { shapeType: 'frame', parentId: rotatedParent ? 'shape:parent' : undefined, x: 100, y: 150, rotation: 0.43 }),
    shape('a', { parentId: 'shape:frame', x: -20, y: 10, props: { w: 100, h: 20 } }),
    shape('b', { parentId: 'shape:frame', x: 80, y: 60, props: { w: 30, h: 40 } }),
  ])
  const fitted = executeCanvasCommands(before, [{ type: 'fit_frame_to_content', ids: ['shape:frame'] }])
  const frame = fitted.snapshot.store['shape:frame']
  assert.equal(frame.props.w, 130)
  assert.equal(frame.props.h, 90)
  assert.equal(frame.rotation, before.store['shape:frame'].rotation)
  close(shapeToPagePoint(fitted.snapshot, frame.id, { x: 0, y: 0 }), shapeToPagePoint(before, frame.id, { x: -20, y: 10 }))
  for (const id of ['shape:a', 'shape:b']) close(getShapePageBounds(fitted.snapshot, id), getShapePageBounds(before, id))
  reversible(before, fitted)
  assert.deepEqual(executeCanvasCommands(fitted.snapshot, [{ type: 'fit_frame_to_content', ids: [frame.id] }]).changes, { added: {}, updated: {}, removed: {} })
})

test('旋转的嵌套组取全部子孙范围并集，命中查询返回实际子形状', () => {
  const before = initial([
    shape('outer', { shapeType: 'group', x: 100, y: -50, rotation: 0.3 }),
    shape('inner', { shapeType: 'group', parentId: 'shape:outer', x: 20, y: 40, rotation: -0.7 }),
    shape('a', { parentId: 'shape:inner', x: -10, y: -20, rotation: 0.2, props: { w: 30, h: 20, fill: 'solid' } }),
    shape('b', { parentId: 'shape:outer', x: 200, y: 100, props: { w: 40, h: 10 } }),
  ])
  const a = getShapePageBounds(before, 'shape:a'), b = getShapePageBounds(before, 'shape:b')
  const expected = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }
  expected.w = Math.max(a.x + a.w, b.x + b.w) - expected.x
  expected.h = Math.max(a.y + a.h, b.y + b.h) - expected.y
  close(getShapePageBounds(before, 'shape:outer'), expected)
  close(getShapePageBounds(before, 'shape:inner'), a)
  const center = shapeToPagePoint(before, 'shape:a', { x: 15, y: 10 })
  assert.equal(hitTestCanvas(before, center), 'shape:a')
})

test('活存储每帧同样清理失去子形状的组，不读取完整快照；取消和提交保留事务语义', async t => {
  const before = initial([shape('a'), shape('b', { x: 250 })])
  const grouped = executeCanvasCommands(before, [{ type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }]).snapshot
  const host = memoryHost(grouped), session = await createEditorSession({ transport: host.transport, actor: 'synthetic' })
  t.after(() => session.dispose())
  const getSnapshot = session.store.getStoreSnapshot
  session.beginGesture()
  session.store.getStoreSnapshot = () => { throw new Error('不应复制整份快照') }
  session.preview([{ type: 'delete', ids: ['shape:a'] }])
  assert.equal(session.store.has('shape:g'), false)
  assert.deepEqual(session.store.get('shape:b'), before.store['shape:b'])
  session.store.getStoreSnapshot = getSnapshot
  session.cancelGesture()
  assert.deepEqual(sessionSnapshot(session), grouped)
  session.beginGesture()
  session.preview([{ type: 'delete', ids: ['shape:a', 'shape:b'] }])
  await session.commitGesture()
  assert.equal(host.commits.length, 1)
  assert.equal(host.current().snapshot.store['shape:g'], undefined)
})

test('统一收尾失败时纯事务和活存储整帧回滚，不泄漏已删除的形状', async t => {
  const before = initial([
    shape('g', { shapeType: 'group', x: 1e308 }),
    shape('a', { parentId: 'shape:g' }), shape('b', { parentId: 'shape:g', x: 1e308 }),
  ])
  const commands = [{ type: 'delete', ids: ['shape:a'] }]
  assert.throws(() => executeCanvasCommands(before, commands), CanvasEditError)
  const host = memoryHost(before), session = await createEditorSession({ transport: host.transport, actor: 'synthetic' })
  t.after(() => session.dispose())
  session.beginGesture()
  assert.throws(() => session.preview(commands), CanvasEditError)
  assert.deepEqual(sessionSnapshot(session), before)
})

test('嵌套组收尾可再次检查父组，清空内组后不遗留单子父组', () => {
  const before = initial([
    shape('outer', { shapeType: 'group', x: 100, y: 200, rotation: 0.3 }),
    shape('removed', { parentId: 'shape:outer' }),
    shape('kept', { parentId: 'shape:outer', x: 300, y: 40 }),
    shape('inner', { shapeType: 'group', parentId: 'shape:outer', x: 10, y: 20 }),
    shape('a', { parentId: 'shape:inner' }), shape('b', { parentId: 'shape:inner', x: 150 }),
  ])
  const result = executeCanvasCommands(before, [{ type: 'delete', ids: ['shape:removed', 'shape:a', 'shape:b'] }])
  assert.equal(result.snapshot.store['shape:inner'], undefined)
  assert.equal(result.snapshot.store['shape:outer'], undefined)
  assert.equal(result.snapshot.store['shape:kept'].parentId, 'page:page')
  close(getShapePageBounds(result.snapshot, 'shape:kept'), getShapePageBounds(before, 'shape:kept'))
  reversible(before, result)
})

test('收尾等待整批完成，替换组内子形状不提前解组，无关原始空组不变', () => {
  const before = initial([
    shape('empty', { shapeType: 'group' }), shape('raw-single', { shapeType: 'group' }),
    shape('single-child', { parentId: 'shape:raw-single' }),
    shape('a'), shape('b', { x: 200 }),
  ])
  const grouped = executeCanvasCommands(before, [{ type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }]).snapshot
  const result = executeCanvasCommands(grouped, [{ type: 'delete', ids: ['shape:a'] }, shape('replacement', { parentId: 'shape:g' })])
  assert.ok(result.snapshot.store['shape:g'])
  assert.deepEqual(result.snapshot.store['shape:b'], grouped.store['shape:b'])
  for (const id of ['shape:empty', 'shape:raw-single', 'shape:single-child']) assert.deepEqual(result.snapshot.store[id], before.store[id])
  reversible(grouped, result)
})

test('锁定祖先下的形状不参与组合，选中父子时不重复移动子形状；参数错误整批回滚', () => {
  const before = initial([
    shape('locked', { shapeType: 'frame' }), shape('locked-child', { parentId: 'shape:locked' }),
    shape('frame', { shapeType: 'frame', x: 100 }), shape('child', { parentId: 'shape:frame', x: 20 }),
    shape('a', { x: 400 }), shape('b', { x: 600 }),
    { type: 'update', id: 'shape:locked', changes: { isLocked: true } },
  ])
  const noOp = executeCanvasCommands(before, [{ type: 'group_shapes', ids: ['shape:locked-child', 'shape:a'] }])
  assert.deepEqual(noOp.snapshot, before)
  const grouped = executeCanvasCommands(before, [{ type: 'group_shapes', ids: ['shape:frame', 'shape:child', 'shape:a', 'shape:locked-child'], groupId: 'shape:g' }])
  assert.deepEqual(grouped.snapshot.store['shape:child'], before.store['shape:child'])
  assert.deepEqual(grouped.snapshot.store['shape:locked-child'], before.store['shape:locked-child'])
  assert.equal(grouped.snapshot.store['shape:frame'].parentId, 'shape:g')
  reversible(before, grouped)
  for (const command of [
    { type: 'ungroup_shapes', ids: ['shape:a'] }, { type: 'fit_frame_to_content', ids: ['shape:a'] },
    { type: 'group_shapes', ids: ['shape:a', 'shape:missing'] },
    { type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:a' },
  ]) assert.throws(() => executeCanvasCommands(before, [shape('temporary'), command]), CanvasEditError)
  assert.deepEqual(executeCanvasCommands(before, [{ type: 'fit_frame_to_content', ids: ['shape:locked'] }]).snapshot, before)
})

test('同父正负小数坐标的组合解组逐值还原；组或子形状移动后按当前位置解组', () => {
  const before = initial([shape('a', { x: -100.1, y: -200.2 }), shape('b', { x: 0.3, y: 0.4 })])
  const grouped = executeCanvasCommands(before, [{ type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }]).snapshot
  assert.deepEqual(executeCanvasCommands(grouped, [{ type: 'ungroup_shapes', ids: ['shape:g'] }]).snapshot, before)
  for (const id of ['shape:g', 'shape:b']) {
    const moved = executeCanvasCommands(grouped, [{ type: 'update', id, changes: { x: 150 } }]).snapshot
    const ungrouped = executeCanvasCommands(moved, [{ type: 'ungroup_shapes', ids: ['shape:g'] }])
    close(getShapePageBounds(ungrouped.snapshot, 'shape:b'), getShapePageBounds(moved, 'shape:b'))
    reversible(moved, ungrouped)
  }
})

test('单批先组合再删子形状也参与收尾：纯事务和活存储一致', async t => {
  const before = initial([shape('a'), shape('b', { x: 250 })])
  for (const ids of [['shape:a'], ['shape:a', 'shape:b']]) {
    const commands = [{ type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }, { type: 'delete', ids }]
    const result = executeCanvasCommands(before, commands)
    assert.equal(result.snapshot.store['shape:g'], undefined)
    if (ids.length === 1) assert.deepEqual(result.snapshot.store['shape:b'], before.store['shape:b'])
    reversible(before, result)
    const host = memoryHost(before), session = await createEditorSession({ transport: host.transport, actor: 'synthetic' })
    t.after(() => session.dispose())
    session.beginGesture()
    session.preview(commands)
    assert.deepEqual(sessionSnapshot(session), result.snapshot)
    session.cancelGesture()
    assert.deepEqual(sessionSnapshot(session), before)
  }
})

for (const operation of ['front', 'back']) test(`组${operation}后解组，子形状保持组当前所在层级`, () => {
  const before = initial([shape('below'), shape('a'), shape('b'), shape('above')])
  const grouped = executeCanvasCommands(before, [{ type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }]).snapshot
  const moved = executeCanvasCommands(grouped, [{ type: 'reorder_shapes', ids: ['shape:g'], operation }]).snapshot
  const result = executeCanvasCommands(moved, [{ type: 'ungroup_shapes', ids: ['shape:g'] }])
  const order = Object.values(result.snapshot.store).filter(record => record.typeName === 'shape').sort((a, b) => a.index < b.index ? -1 : 1).map(record => record.id)
  assert.deepEqual(order, (operation === 'front' ? ['below', 'above', 'a', 'b'] : ['a', 'b', 'below', 'above']).map(id => `shape:${id}`))
  reversible(moved, result)
})
