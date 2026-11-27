import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawFixture } from './draw-fixture.mjs'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction } from '../engine/index.js'

const fixture = (commands = [], options = {}) => drawFixture(commands, { toolIds: ['select', 'hand', 'draw', 'eraser', 'laser'], ...options })
const trails = f => f.state().overlays.filter(item => item.kind === 'laser')

test('K进入并保持激光；一次点线手势只改会话覆盖层，不开始文档手势或提交', async () => {
  const f = await fixture()
  try {
    const before = f.session.store.getStoreSnapshot()
    f.key('k'); f.key('k'); f.key('Escape')
    assert.equal(f.state().toolId, 'laser')
    f.pointer('move', 100, 100); assert.deepEqual(trails(f), [])
    f.pointer('down', 100, 100)
    assert.equal(f.session.state.get().isGestureActive, false)
    f.pointer('move', 120, 110); await f.pointer('up', 120, 110)
    assert.deepEqual(trails(f)[0].points, [{ x: 100, y: 100 }, { x: 120, y: 110 }])
    assert.equal(f.state().mode, 'idle')
    assert.deepEqual(f.session.store.getStoreSnapshot(), before)
    assert.equal(f.commits.length, 0); assert.equal(f.depth(), 0)
    assert.equal(f.session.state.get().isGestureActive, false)
  } finally { f.close() }
})

test('按住超过8秒不丢旧点；松手完整等1200ms，再从起点收短，结束停止帧请求', async () => {
  const f = await fixture()
  try {
    f.key('k'); f.pointer('down', 100, 100, { time: 100 })
    for (let i = 1; i <= 8; i++) f.pointer('move', 100 + 20 * i, 100)
    const held = trails(f)[0]
    f.input({ type: 'frame', time: 8108 }); assert.deepEqual(trails(f)[0], held)
    assert.equal(f.state().needsFrame, false)
    f.pointer('up', 260, 100, { time: 9000 }); assert.equal(f.state().needsFrame, true)
    f.input({ type: 'frame', time: 10199 }); assert.deepEqual(trails(f)[0], held)
    f.input({ type: 'frame', time: 10200 })
    assert.deepEqual(trails(f)[0].points, held.points.slice(1))
    assert.equal(held.points.length, 9); assert.ok(Object.isFrozen(held.points[0]))
    f.input({ type: 'frame', time: 10334 }); assert.deepEqual(trails(f), [])
    assert.equal(f.state().needsFrame, false)
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('还在等待的旧段被新段延后，最后松手共享1200ms，多个ID按先后收短', async () => {
  const f = await fixture()
  try {
    f.key('k'); f.pointer('down', 100, 100)
    for (let i = 1; i <= 8; i++) f.pointer('move', 100 + 20 * i, 100)
    f.pointer('up', 260, 100, { time: 100 })
    const old = trails(f)[0]
    f.pointer('down', 100, 200, { time: 800 }); f.pointer('move', 260, 200)
    const ids = trails(f).map(s => s.id)
    assert.equal(new Set(ids).size, 2)
    f.input({ type: 'frame', time: 2000 }); assert.deepEqual(trails(f)[0], old)
    assert.equal(f.state().needsFrame, false)
    f.pointer('up', 260, 200, { time: 2100 })
    f.input({ type: 'frame', time: 3299 }); assert.deepEqual(trails(f).map(s => s.points.length), [9, 2])
    f.input({ type: 'frame', time: 3434 })
    assert.deepEqual(trails(f).map(s => s.id), ids.slice(1))
    assert.equal(trails(f)[0].points.length, 2)
    f.input({ type: 'frame', time: 3468 }); assert.deepEqual(trails(f), [])
  } finally { f.close() }
})

test('O1两次旧版正例：活动Esc清全部段，闲置Esc保持工具与尾迹', async () => {
  const f = await fixture()
  try {
    f.key('k'); f.pointer('down', 100, 100); f.pointer('up', 100, 100)
    const before = trails(f); f.key('Escape'); assert.deepEqual(trails(f), before)
    f.pointer('down', 100, 200); f.pointer('move', 200, 200)
    assert.equal(trails(f).length, 2)
    f.key('Escape'); assert.deepEqual(trails(f), [])
    assert.equal(f.state().toolId, 'laser'); assert.equal(f.state().needsFrame, false)
    await f.pointer('up', 200, 200); assert.deepEqual(trails(f), [])
  } finally { f.close() }
})

test('O2两次旧版正例：已收短旧段在新段按住时继续消退，不回到1200ms等待', async () => {
  const f = await fixture()
  try {
    f.key('k'); f.pointer('down', 100, 100)
    for (let i = 1; i <= 64; i++) f.pointer('move', 100 + i, 100)
    f.pointer('up', 164, 100, { time: 500 })
    f.input({ type: 'frame', time: 1700 }); assert.equal(trails(f)[0].points.length, 64)
    const oldId = trails(f)[0].id
    f.pointer('down', 100, 200, { time: 1710 }); f.pointer('move', 260, 200)
    assert.equal(trails(f).length, 2)
    f.input({ type: 'frame', time: 2300 })
    assert.equal(trails(f).length, 1); assert.notEqual(trails(f)[0].id, oldId)
    assert.equal(trails(f)[0].points.length, 2); assert.equal(f.state().needsFrame, false)
    f.pointer('up', 260, 200, { time: 2400 })
    f.input({ type: 'frame', time: 3599 }); assert.equal(trails(f)[0].points.length, 2)
    f.input({ type: 'frame', time: 3617 }); assert.deepEqual(trails(f), [])
  } finally { f.close() }
})

test('V结束活动段保留尾迹；重新进入K保留稳定ID，退出后仍按帧收尾', async () => {
  const f = await fixture()
  try {
    f.key('k'); f.pointer('down', 100, 100); f.pointer('move', 200, 100)
    const before = trails(f)[0]
    f.key('v', { time: 100 }); assert.equal(f.state().toolId, 'select')
    assert.deepEqual(trails(f)[0], before); assert.equal(f.state().needsFrame, true)
    f.key('k', { time: 200 }); assert.deepEqual(trails(f)[0], before)
    f.key('v', { time: 300 })
    f.input({ type: 'frame', time: 1317 }); assert.deepEqual(trails(f), [])
    assert.equal(f.state().toolId, 'select'); assert.equal(f.state().needsFrame, false)
  } finally { f.close() }
})

test('每段超过1024点隔点降采样保留首尾；最多32段淘汰最老完成段', async () => {
  const f = await fixture()
  try {
    f.key('k'); f.pointer('down', 0, 0)
    for (let i = 1; i < 1024; i++) f.pointer('move', i, 0)
    assert.equal(trails(f)[0].points.length, 1024)
    f.pointer('move', 1024, 0)
    assert.equal(trails(f)[0].points.length, 513)
    assert.deepEqual(trails(f)[0].points.slice(0, 2), [{ x: 0, y: 0 }, { x: 2, y: 0 }])
    assert.deepEqual(trails(f)[0].points.at(-1), { x: 1024, y: 0 })
    f.pointer('up', 1024, 0)
    const ids = [trails(f)[0].id]
    for (let i = 1; i < 35; i++) {
      f.pointer('down', i, 100); ids.push(trails(f).at(-1).id); f.pointer('up', i, 100)
      assert.ok(trails(f).length <= 32)
    }
    assert.deepEqual(trails(f).map(s => s.id), ids.slice(3))
    assert.equal(new Set(ids).size, 35)
  } finally { f.close() }
})

test('主指针拥有活动段；旁路指针/非主按钮不追加或结束；匹配cancel释放全部覆盖层', async () => {
  const f = await fixture()
  try {
    f.key('k'); f.pointer('down', 50, 50, { button: 2 }); assert.deepEqual(trails(f), [])
    f.pointer('down', 100, 100)
    const before = trails(f)
    f.key('k'); f.pointer('down', 999, 999, { pointerId: 2 })
    f.pointer('move', 999, 999, { pointerId: 2 }); f.pointer('up', 999, 999, { pointerId: 2 })
    f.pointer('cancel', 999, 999, { pointerId: 2 }); assert.deepEqual(trails(f), before)
    assert.equal(f.state().mode, 'lasering')
    f.pointer('cancel', 100, 100); assert.deepEqual(trails(f), [])
    assert.equal(f.state().needsFrame, false); assert.equal(f.state().mode, 'idle')
  } finally { f.close() }
})

test('K沿用输入归属/IME/禁用/工具开放守卫，工具切入和闲置Esc保留选区', async () => {
  const f = await fixture([{ type: 'create_shape', id: 'shape:a', shapeType: 'geo', x: 100, y: 100, props: { w: 100, h: 80, fill: 'solid' } }])
  try {
    f.pointer('down', 150, 140); f.pointer('up', 150, 140)
    const selected = [...f.state().selectedIds]
    assert.deepEqual(selected, ['shape:a'])
    for (const context of [{ owner: 'form' }, { owner: 'text-editing' }, { owner: 'menu' }, { owner: 'canvas', isComposing: true }]) {
      f.interaction.setInputContext(context); f.key('k'); assert.equal(f.state().toolId, 'select')
    }
    f.interaction.setInputContext({ owner: 'canvas' })
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
      f.key('k', extra); assert.equal(f.state().toolId, 'select')
    }
    f.interaction.setShortcutsEnabled(false); f.key('k'); assert.equal(f.state().toolId, 'select')
    f.interaction.setShortcutsEnabled(true); f.key('k'); f.key('Escape')
    assert.equal(f.state().toolId, 'laser'); assert.deepEqual(f.state().selectedIds, selected)
  } finally { f.close() }
  const limited = await fixture([], { toolIds: ['select'] })
  try { limited.key('k'); assert.equal(limited.state().toolId, 'select') } finally { limited.close() }
})

test('D哨兵后激光不占撤销、不截断重做；远端记录更新不取消纯会话轨迹', async () => {
  const f = await fixture()
  try {
    f.key('d'); f.pointer('down', 50, 50); f.pointer('move', 100, 100); await f.pointer('up', 100, 100)
    const sentinel = f.shapes()[0], before = f.session.store.getStoreSnapshot()
    f.key('k'); f.pointer('down', 200, 200); f.pointer('up', 200, 200)
    const id = trails(f)[0].id
    assert.deepEqual(f.session.store.getStoreSnapshot(), before); assert.equal(f.depth(), 1)
    await f.key('z', { metaKey: true }); assert.deepEqual(f.shapes(), [])
    f.pointer('down', 220, 220); f.pointer('up', 220, 220)
    await f.key('z', { metaKey: true, shiftKey: true }); assert.deepEqual(f.shapes()[0], sentinel)
    assert.equal(trails(f)[0].id, id); assert.equal(f.commits.length, 1)
    await f.remote([{ type: 'create_shape', id: 'shape:remote', shapeType: 'geo' }])
    assert.equal(trails(f)[0].id, id); assert.equal(trails(f).length, 2)
  } finally { f.close() }
})

test('世界坐标不随滚轮相机变动；尾迹帧不打断其他工具的文档手势或待保存事务', async () => {
  const f = await fixture()
  try {
    f.interaction.setCamera({ x: 10, y: 20, z: 2 }); f.key('k')
    f.pointer('down', 100, 100); f.pointer('move', 200, 100)
    const first = trails(f)[0].points[0]
    assert.deepEqual(first, { x: 40, y: 30 })
    f.input({ type: 'wheel', point: { x: 200, y: 100 }, delta: { x: 100, y: 0 } })
    assert.deepEqual(trails(f)[0].points[0], first); assert.equal(f.state().mode, 'lasering')
    f.key('d', { time: 100 }); const release = f.hold()
    f.pointer('down', 50, 50); f.pointer('move', 80, 80)
    f.input({ type: 'frame', time: 1100 }); assert.equal(f.state().mode, 'drawing')
    const saved = f.pointer('up', 80, 80)
    try {
      assert.equal(f.session.state.get().isSubmitting, true)
      f.input({ type: 'frame', time: 1317 }); assert.deepEqual(trails(f), [])
      f.key('k'); assert.equal(f.state().toolId, 'draw')
    } finally { release(); await saved }
    f.interaction.dispose(); assert.equal(f.state().needsFrame, false)
  } finally { f.close() }
})

test('激光按住时撤销等待远端响应，松手仍结束纯会话段，不留下永远按住的轨迹', async () => {
  const snapshot = createCanvasSnapshot()
  let resume
  const gate = new Promise(resolve => { resume = resolve })
  const session = await createEditorSession({ actor: 'laser-busy', transport: {
    read: async () => ({ snapshot, revision: '0' }), subscribe: () => () => {},
    undo: async () => { await gate; return { snapshot, revision: '1', changes: { added: {}, updated: {}, removed: {} }, results: [] } },
    commit: async () => { throw Error('激光提交了文档') },
  } })
  const interaction = createCanvasInteraction({ session, toolIds: ['select', 'laser'], edgeScrolling: false })
  let time = 0, undo
  const input = value => interaction.dispatch({ ...value, time: ++time })
  try {
    input({ type: 'key_down', key: 'k' })
    input({ type: 'pointer_down', pointerId: 1, button: 0, point: { x: 100, y: 100 } })
    undo = input({ type: 'key_down', key: 'z', metaKey: true })
    assert.equal(session.state.get().isSubmitting, true)
    input({ type: 'pointer_up', pointerId: 1, point: { x: 120, y: 100 } })
    assert.equal(interaction.state.get().mode, 'idle')
    time = 1300; interaction.dispatch({ type: 'frame', time })
    assert.deepEqual(interaction.state.get().overlays, []); assert.equal(interaction.state.get().needsFrame, false)
    resume(); await undo
    const beforeMove = interaction.state.get().overlays
    input({ type: 'pointer_move', pointerId: 1, point: { x: 999, y: 999 } })
    assert.deepEqual(interaction.state.get().overlays, beforeMove)
    assert.deepEqual(session.store.getStoreSnapshot(), snapshot)
  } finally { resume(); await undo; interaction.dispose(); session.dispose() }
})
