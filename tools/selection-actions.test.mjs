import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { canvasActions, planCanvasAction } from '../engine/index.js'
import { selectionFixture, shape } from './selection-fixture.mjs'

const key = (f, key, extra = {}, phase = 'down') => f.input({ type: `key_${phase}`, key, ...extra })

test('纯动作表只规划已有命令，不改输入，空目标不可用', () => {
  const record = { id: 'shape:a', typeName: 'shape', type: 'geo', parentId: 'page:page' }
  const records = { getRecord: id => id === record.id ? record : null, childIds: () => [] }
  const context = { records, pageId: 'page:page', selectedIds: ['shape:a'] }
  assert.equal(new Set(canvasActions.map(a => a.id)).size, canvasActions.length)
  const before = structuredClone(record)
  assert.deepEqual(planCanvasAction('nudge-right', context).commands, [{ type: 'nudge_shapes', ids: [record.id], delta: { x: 1, y: 0 } }])
  assert.equal(planCanvasAction('align-left', context).available, false)
  assert.equal(planCanvasAction('delete', { ...context, selectedIds: [] }).available, false)
  assert.deepEqual(record, before)
})

test('菜单动作复用一次事务，组合/混选解组/锁定/删除更新选择', async () => {
  const f = await selectionFixture()
  try {
    f.interaction.select('all')
    f.interaction.setInputContext({ owner: 'menu' })
    const grouped = await f.interaction.runAction('group')
    assert.equal(grouped.status, 'applied'); assert.equal(f.commits.length, 1)
    const [group] = f.selected(); assert.equal(f.session.store.get(group).type, 'group')
    await f.interaction.runAction('ungroup')
    assert.deepEqual(f.selected().sort(), ['shape:a', 'shape:b', 'shape:c'])
    assert.equal(f.commits.length, 2)
    await f.interaction.runAction('toggle-lock'); assert.deepEqual(f.selected(), [])
    await f.interaction.runAction('unlock-all'); assert.deepEqual(f.selected(), [])
    f.interaction.select('all'); await f.interaction.runAction('delete')
    assert.deepEqual(f.selected(), []); assert.equal(f.session.store.allRecords().filter(r => r.typeName === 'shape').length, 0)
    assert.equal(f.commits.length, 5)
  } finally { f.close() }
})

test('微移按住只预览，松键只提交一次；分开按两次提交两次', async () => {
  const f = await selectionFixture([shape('a', 100, 100)])
  try {
    await f.click(120, 120)
    key(f, 'ArrowRight'); assert.equal(f.session.store.get('shape:a').x, 101); assert.equal(f.commits.length, 0)
    for (let i = 0; i < 3; i++) key(f, 'ArrowRight', { repeat: true })
    assert.equal(f.session.store.get('shape:a').x, 104); assert.equal(f.commits.length, 0)
    await key(f, 'ArrowRight', {}, 'up'); assert.equal(f.commits.length, 1)
    key(f, 'ArrowDown', { shiftKey: true }); await key(f, 'ArrowDown', {}, 'up')
    assert.equal(f.session.store.get('shape:a').y, 110)
    key(f, 'ArrowRight'); await key(f, 'ArrowRight', {}, 'up')
    key(f, 'ArrowRight'); await key(f, 'ArrowRight', {}, 'up')
    assert.equal(f.commits.length, 4); assert.equal(f.session.store.get('shape:a').x, 106)
  } finally { f.close() }
})

test('Option+A特殊字符仍对齐；Shift H/V、旋转逗号、对象缩放各只生效一次', async () => {
  const f = await selectionFixture([shape('a', 100, 100, { props: { w: 40, h: 60, fill: 'solid' } }), shape('b', 300, 100), shape('c', 200, 220)], { reduceMotion: true, toolIds: ['select', 'hand', 'draw', 'highlight', 'geo', 'frame', 'ai-image'] })
  try {
    f.interaction.select('all')
    await key(f, 'å', { code: 'KeyA', altKey: true })
    for (const id of f.selected()) assert.equal(f.session.store.get(id).x, 100)
    assert.equal(f.commits.length, 1); assert.equal(f.state().toolId, 'select')
    await key(f, 'H', { shiftKey: true }); assert.equal(f.commits.length, 2); assert.equal(f.state().toolId, 'select')
    await key(f, '<', { code: 'Comma', shiftKey: true }); assert.equal(f.commits.length, 3); assert.equal(f.state().mode, 'idle')
    await key(f, '+', { code: 'Equal', ctrlKey: true, altKey: true, shiftKey: true })
    assert.equal(f.commits.length, 4); assert.equal(f.state().camera.z, 1)
    f.interaction.select('clear')
    await key(f, 'V', { shiftKey: true }); await key(f, '+', { code: 'Equal', ctrlKey: true, altKey: true, shiftKey: true })
    assert.equal(f.state().toolId, 'select'); assert.equal(f.state().camera.z, 1); assert.equal(f.commits.length, 4)
  } finally { f.close() }
})

test('输入上下文门禁及程序调用拒绝：文字、指针、提交中，不排队', async () => {
  let release
  const f = await selectionFixture(undefined, { beforeCommit: () => new Promise(resolve => { release = resolve }) })
  try {
    await f.click(120, 120)
    for (const owner of ['form', 'menu', 'text-editing']) {
      f.interaction.setInputContext({ owner }); key(f, 'Delete'); key(f, 'ArrowRight'); await key(f, 'ArrowRight', {}, 'up')
      assert.equal(f.commits.length, 0); assert.ok(f.session.store.has('shape:a'))
    }
    assert.equal((await f.interaction.runAction('delete')).reason, 'text-editing')
    f.interaction.setInputContext({ owner: 'canvas' }); f.pointer('down', 120, 120)
    assert.equal((await f.interaction.runAction('delete')).reason, 'pointer-gesture')
    key(f, 'Escape')
    const saving = f.interaction.runAction('nudge-right')
    assert.equal((await f.interaction.runAction('delete')).reason, 'submitting')
    for (let i = 0; i < 10 && !release; i++) await Promise.resolve()
    release(); await saving
    assert.equal(f.commits.length, 1); assert.ok(f.session.store.has('shape:a'))
  } finally { f.close() }
})

test('方向微移取消、切工具和失焦回滚，Space方向只平移，画笔空闲Esc保留选择', async () => {
  const f = await selectionFixture([shape('a', 100, 100)], { toolIds: ['select', 'hand', 'draw', 'highlight'], reduceMotion: true })
  try {
    await f.click(120, 120)
    for (const cancel of [() => key(f, 'Escape'), () => f.interaction.setTool('hand'), () => f.interaction.setInputContext({ owner: 'form' })]) {
      f.interaction.setTool('select'); f.interaction.setInputContext({ owner: 'canvas' })
      key(f, 'ArrowRight'); cancel(); await key(f, 'ArrowRight', {}, 'up')
      assert.equal(f.session.store.get('shape:a').x, 100); assert.equal(f.commits.length, 0)
    }
    f.interaction.setInputContext({ owner: 'canvas' }); f.interaction.setTool('select')
    key(f, 'ArrowRight'); key(f, ' '); key(f, 'ArrowRight'); await key(f, 'ArrowRight', {}, 'up'); key(f, ' ', {}, 'up')
    assert.equal(f.session.store.get('shape:a').x, 100); assert.equal(f.commits.length, 0)
    for (const tool of ['draw', 'highlight']) { f.interaction.setTool(tool); key(f, 'Escape'); assert.equal(f.state().toolId, 'select'); assert.deepEqual(f.selected(), ['shape:a']) }
  } finally { f.close() }
})

test('最后一次微移后远端改变父框坐标基准，直接松键也拒绝保存旧基准', async () => {
  const f = await selectionFixture([shape('frame', 500, 100, { shapeType: 'frame', props: { w: 300, h: 300 } }), shape('child', 20, 30, { parentId: 'shape:frame' })])
  try {
    await f.click(530, 140); assert.deepEqual(f.selected(), ['shape:child'])
    key(f, 'ArrowRight'); assert.equal(f.session.store.get('shape:child').x, 21)
    await f.remote([{ type: 'update', id: 'shape:frame', changes: { rotation: 0.4 } }])
    assert.throws(() => key(f, 'ArrowRight', {}, 'up'), error => error.code === 'conflict')
    assert.equal(f.commits.length, 0); assert.equal(f.session.store.get('shape:child').x, 20)
    assert.equal(f.session.store.get('shape:frame').rotation, 0.4)
    assert.equal(f.session.state.get().isGestureActive, false)
  } finally { f.close() }
})

test('实际手形或画笔工具下方向键保留对象和选择，回选择工具恢复微移', async () => {
  const f = await selectionFixture([shape('a', 100, 100)], { toolIds: ['select', 'hand', 'draw', 'highlight'] })
  try {
    await f.click(120, 120)
    for (const tool of ['hand', 'draw', 'highlight']) {
      f.interaction.setTool(tool); key(f, 'ArrowRight'); await key(f, 'ArrowRight', {}, 'up')
      assert.equal(f.session.store.get('shape:a').x, 100); assert.equal(f.commits.length, 0); assert.deepEqual(f.selected(), ['shape:a'])
    }
    f.interaction.setTool('select'); key(f, 'ArrowRight'); await key(f, 'ArrowRight', {}, 'up')
    assert.equal(f.session.store.get('shape:a').x, 101); assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

test('动作可用条件沿用旧版：堆排和分布至少三项，双选仍可拉伸和紧凑排布', async () => {
  const f = await selectionFixture([shape('a', 100, 100), shape('b', 300, 150)])
  try {
    f.interaction.select('all')
    const values = new Map(f.interaction.getActions().map(action => [action.id, action.available]))
    for (const id of ['stack-x', 'stack-y', 'distribute-x', 'distribute-y']) assert.equal(values.get(id), false, id)
    for (const id of ['stretch-x', 'stretch-y', 'pack']) assert.equal(values.get(id), true, id)
    assert.equal((await f.interaction.runAction('stack-x')).reason, 'unavailable'); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})
