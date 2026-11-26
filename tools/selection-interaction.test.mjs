import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands } from '../engine/index.js'

async function setup(commands = []) {
  const initial = executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:a', shapeType: 'geo', x: 20, y: 20, props: { w: 100, h: 80, fill: 'solid' } },
    { type: 'create_shape', id: 'shape:b', shapeType: 'geo', x: 200, y: 20, props: { w: 100, h: 80, fill: 'solid' } },
    ...commands,
  ]).snapshot
  let current = initial, revision = 0
  const commits = []
  const session = await createEditorSession({ actor: 'selection', transport: {
    read: async () => ({ snapshot: current, revision: String(revision) }), subscribe: () => () => {},
    commit: async request => {
      assert.equal(request.expectedRevision, String(revision)); commits.push(request)
      const result = executeCanvasCommands(current, request.commands)
      current = result.snapshot
      return { ...result, revision: String(++revision) }
    },
  } })
  const interaction = createCanvasInteraction({ session })
  let time = 0
  const key = input => interaction.dispatch({ ...input, time: ++time })
  const pointer = (type, x, y, extra = {}) => interaction.dispatch({ type: `pointer_${type}`, time: ++time, point: { x, y }, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'up' ? 0 : 1, pressure: .5, ...extra })
  const click = async (x, y, extra) => { pointer('down', x, y, extra); await pointer('up', x, y, extra) }
  const close = () => { interaction.dispose(); session.dispose() }
  return { initial, session, interaction, pointer, click, commits, close, key, remote: async commands => { current = executeCanvasCommands(current, commands).snapshot; revision++; await session.refresh() }, current: () => current }
}

test('逐帧点选、Shift 加减选、空白清除与部分相交框选只改会话，不提交', async () => {
  const f = await setup()
  try {
    await f.click(50, 50); assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a'])
    await f.click(230, 50, { shiftKey: true }); assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a', 'shape:b'])
    await f.click(50, 50, { shiftKey: true }); assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:b'])
    await f.click(500, 500); assert.deepEqual(f.interaction.state.get().selectedIds, [])
    f.pointer('down', 0, 0); f.pointer('move', 30, 30)
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a'])
    assert.deepEqual(f.interaction.state.get().marquee, { x: 0, y: 0, w: 30, h: 30 })
    assert.ok(f.interaction.state.get().overlays.some(o => o.kind === 'marquee'))
    await f.pointer('up', 30, 30)
    f.pointer('down', 180, 0, { shiftKey: true }); f.pointer('move', 220, 40, { shiftKey: true }); await f.pointer('up', 220, 40, { shiftKey: true })
    assert.deepEqual(new Set(f.interaction.state.get().selectedIds), new Set(['shape:a', 'shape:b']))
    assert.equal(f.commits.length, 0)
    assert.deepEqual(f.current(), f.initial)
  } finally { f.close() }
})

test('拖动预览跟手，松手整次提交一次；提交只含净变化；Esc 和指针取消不保存', async () => {
  const f = await setup()
  try {
    await f.click(50, 50)
    f.pointer('down', 50, 50); f.pointer('move', 51, 50)
    assert.equal(f.session.store.get('shape:a').x, 20, '阈值内不移动')
    f.pointer('move', 70, 60); f.pointer('move', 80, 65)
    assert.equal(f.session.store.get('shape:a').x, 50)
    assert.equal(f.commits.length, 0)
    assert.equal(f.interaction.state.get().overlays.find(o => o.kind === 'selection').bounds.x, 50)
    await f.pointer('up', 80, 65)
    assert.equal(f.commits.length, 1)
    assert.equal(f.commits[0].commands.length, 1)
    assert.deepEqual(f.commits[0].commands[0].record, { ...f.initial.store['shape:a'], x: 50, y: 35 })
    assert.ok(f.commits[0].commands.every(c => !JSON.stringify(c).includes('selectedIds')))
    const saved = structuredClone(f.current())
    f.pointer('down', 80, 65); f.pointer('move', 150, 100)
    f.key({ type: 'key_down', key: 'Escape' })
    assert.deepEqual(f.session.store.getStoreSnapshot(), saved)
    f.pointer('down', 80, 65); f.pointer('move', 160, 100); f.pointer('cancel', 160, 100)
    assert.deepEqual(f.session.store.getStoreSnapshot(), saved)
    assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

test('悬停／框选／拖动不取完整快照；视角由交互模块持有，中键和滚轮不提交', async () => {
  const f = await setup()
  try {
    const snapshot = f.session.store.getStoreSnapshot
    f.session.store.getStoreSnapshot = () => { throw new Error('指针帧禁止整份快照') }
    f.pointer('move', 50, 50); assert.equal(f.interaction.state.get().hoveredId, 'shape:a')
    await f.click(50, 50)
    f.pointer('down', 50, 50); f.pointer('move', 70, 60)
    f.key({ type: 'key_down', key: 'Escape' })
    f.pointer('down', 0, 0, { button: 1 }); f.pointer('move', 100, 50, { button: 1 }); await f.pointer('up', 100, 50, { button: 1 })
    assert.deepEqual(f.interaction.state.get().camera, { x: 100, y: 50, z: 1 })
    f.key({ type: 'wheel', point: { x: 100, y: 50 }, delta: { x: 10, y: 20 } })
    assert.deepEqual(f.interaction.state.get().camera, { x: 90, y: 30, z: 1 })
    f.session.store.getStoreSnapshot = snapshot
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})


test('多选拖动只移动选中根目标，放大视角与旋转父坐标正确，锁定筛选归交互层', async () => {
  const f = await setup()
  try {
    await f.click(50, 50); await f.click(230, 50, { shiftKey: true })
    f.pointer('down', 50, 50); f.pointer('move', 80, 65); await f.pointer('up', 80, 65)
    assert.equal(f.current().store['shape:a'].x, 50)
    assert.equal(f.current().store['shape:b'].x, 230)
    assert.equal(f.commits.length, 1)
    assert.equal(f.commits[0].commands.length, 2)
  } finally { f.close() }
  const nested = await setup([
    { type: 'create_shape', id: 'shape:f', shapeType: 'frame', x: 200, y: 200, rotation: Math.PI / 2, props: { w: 400, h: 400 } },
    { type: 'update', id: 'shape:a', changes: { parentId: 'shape:f' } },
    { type: 'update', id: 'shape:b', changes: { isLocked: true } },
  ])
  try {
    nested.interaction.setCamera({ x: 0, y: 0, z: 2 })
    await nested.click(460, 100); assert.deepEqual(nested.interaction.state.get().selectedIds, [])
    nested.pointer('down', 300, 500); nested.pointer('move', 320, 510); await nested.pointer('up', 320, 510)
    assert.equal(nested.current().store['shape:a'].x, 25)
    assert.equal(nested.current().store['shape:a'].y, 10)
    assert.equal(nested.commits.length, 1)
  } finally { nested.close() }
})

test('分组命中提升由选择工具决定；索引更新后覆盖层跟随组成员变化', async () => {
  const f = await setup([{ type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }])
  try {
    await f.click(50, 50)
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:g'])
    const before = f.session.store.get('shape:g')
    f.pointer('down', 50, 50); f.pointer('move', 80, 65); await f.pointer('up', 80, 65)
    assert.equal(f.current().store['shape:g'].x, before.x + 30)
    assert.equal(f.current().store['shape:g'].y, before.y + 15)
    assert.equal(f.commits[0].commands.length, 1, '组及子形状不能被重复位移')
  } finally { f.close() }
})

test('往返拖动不保存空事务；取消框选恢复原选择；只响应活动指针，输入时间可直接注入', async () => {
  const f = await setup()
  try {
    await f.click(50, 50)
    f.pointer('down', 50, 50); f.pointer('move', 100, 80); f.pointer('move', 50, 50); await f.pointer('up', 50, 50)
    assert.equal(f.commits.length, 0)
    f.pointer('down', 0, 0); f.pointer('move', 220, 50)
    assert.equal(f.interaction.state.get().selectedIds.length, 2)
    f.key({ type: 'key_down', key: 'Escape' })
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a'])
    f.pointer('down', 50, 50); f.pointer('move', 150, 100, { pointerId: 2 }); await f.pointer('up', 150, 100, { pointerId: 2 })
    assert.equal(f.session.store.get('shape:a').x, 20)
    f.pointer('cancel', 50, 50)
    assert.throws(() => f.interaction.dispatch({ type: 'key_down', key: 'Escape', time: -1 }), /时间/)
    assert.throws(() => f.interaction.dispatch({ type: 'key_down', key: 'Escape', time: 0 }), /单调/)
  } finally { f.close() }
})


test('按下后第一帧预览前的远端改动不能被旧起点覆盖；无关记录变化可继续', async () => {
  const f = await setup()
  try {
    f.pointer('down', 50, 50)
    await f.remote([{ type: 'update', id: 'shape:a', changes: { x: 200 } }])
    assert.throws(() => f.pointer('move', 70, 50), error => error.code === 'conflict')
    await f.pointer('up', 70, 50)
    assert.equal(f.session.store.get('shape:a').x, 200)
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
  const g = await setup()
  try {
    g.pointer('down', 50, 50)
    await g.remote([{ type: 'update', id: 'shape:b', changes: { x: 400 } }])
    g.pointer('move', 70, 50); await g.pointer('up', 70, 50)
    assert.equal(g.current().store['shape:a'].x, 40)
    assert.equal(g.current().store['shape:b'].x, 400)
    assert.equal(g.commits.length, 1)
  } finally { g.close() }
})


test('多选后普通点已选成员在松手时收成单选，拖动时保留多选', async () => {
  const f = await setup()
  try {
    await f.click(50, 50); await f.click(230, 50, { shiftKey: true })
    f.pointer('down', 50, 50)
    assert.equal(f.interaction.state.get().selectedIds.length, 2)
    await f.pointer('up', 50, 50)
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a'])
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})
