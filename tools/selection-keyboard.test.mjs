import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { selectionFixture, shape } from './selection-fixture.mjs'

const group = { type: 'group_shapes', ids: ['shape:b', 'shape:c'], groupId: 'shape:g' }
const commands = [shape('a', 100, 100), shape('b', 600, 300), shape('c', 760, 300), group]
const key = (f, name, extra = {}, type = 'down') => f.input({ type: `key_${type}`, key: name, ...extra })

test('Mod+A 选当前组；Esc 空闲时逐层退出并清除，活动手势时只取消预览', async () => {
  const f = await selectionFixture(commands)
  try {
    assert.equal(key(f, 'a', { metaKey: true }), true); assert.deepEqual(f.selected(), ['shape:a', 'shape:g'])
    assert.equal(key(f, 'Escape'), true); assert.deepEqual(f.selected(), [])
    await f.click(620, 320); key(f, 'Enter'); assert.deepEqual(f.selected(), ['shape:g'])
    assert.equal(key(f, 'Enter', {}, 'up'), true); assert.deepEqual(f.selected(), ['shape:b', 'shape:c'])
    key(f, 'a', { ctrlKey: true }); assert.deepEqual(f.selected(), ['shape:b', 'shape:c'])
    key(f, 'Escape'); assert.deepEqual(f.selected(), ['shape:g']); assert.equal(f.state().focusedGroupId, 'page:page')
    key(f, 'Escape'); assert.deepEqual(f.selected(), [])
    await f.click(120, 120)
    f.pointer('down', 130, 130); f.pointer('move', 150, 140)
    key(f, 'a', { metaKey: true }); assert.deepEqual(f.selected(), ['shape:a'])
    key(f, 'Escape'); assert.equal(f.state().mode, 'idle'); assert.deepEqual(f.selected(), ['shape:a'])
    assert.equal(f.session.store.get('shape:a').x, 100)
    key(f, 'Escape'); assert.deepEqual(f.selected(), [])
    assert.deepEqual(f.current(), f.initial); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('Tab 在按下时拦截，重复按下和松键各推进；未归本工具的松键不推进，空选择让出焦点导航', async () => {
  const f = await selectionFixture()
  try {
    assert.notEqual(key(f, 'Tab'), true)
    assert.notEqual(key(f, 'Tab', {}, 'up'), true)
    await f.click(120, 120)
    assert.equal(key(f, 'Tab'), true); assert.deepEqual(f.selected(), ['shape:a'])
    assert.equal(key(f, 'Tab', { repeat: true }), true); assert.deepEqual(f.selected(), ['shape:b'])
    assert.equal(key(f, 'Tab', {}, 'up'), true); assert.deepEqual(f.selected(), ['shape:c'])
    key(f, 'Tab', {}, 'up'); assert.deepEqual(f.selected(), ['shape:c'])
    key(f, 'Tab', { shiftKey: true }); key(f, 'Tab', { shiftKey: true }, 'up'); assert.deepEqual(f.selected(), ['shape:b'])
    key(f, 'Tab'); f.interaction.setTool('hand'); key(f, 'Tab', {}, 'up'); assert.deepEqual(f.selected(), ['shape:b'])
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('Mod 方向及父子键只改变选择和必要的视角，不动记录', async () => {
  const f = await selectionFixture(commands)
  try {
    await f.click(120, 120)
    assert.equal(key(f, 'ArrowRight', { metaKey: true }), true); assert.deepEqual(f.selected(), ['shape:g'])
    assert.equal(key(f, 'ArrowDown', { metaKey: true, shiftKey: true }), true); assert.deepEqual(f.selected(), ['shape:b'])
    key(f, 'ArrowRight', { ctrlKey: true }); assert.deepEqual(f.selected(), ['shape:c'])
    key(f, 'ArrowUp', { metaKey: true, shiftKey: true }); assert.deepEqual(f.selected(), ['shape:g'])
    assert.deepEqual(f.current(), f.initial); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('涂抹尾迹由注入帧老化，收成单点后停止帧请求；选中结果保留至松手', async () => {
  const f = await selectionFixture()
  try {
    f.pointer('down', 50, 130, { altKey: true }); f.pointer('move', 200, 130, { altKey: true }); f.pointer('move', 450, 130, { altKey: true })
    assert.ok(f.state().overlays.find(o => o.kind === 'scribble').points.length > 1)
    assert.equal(f.state().needsFrame, true)
    f.input({ type: 'frame', time: 200 })
    assert.equal(f.state().overlays.find(o => o.kind === 'scribble').points.length, 1)
    assert.equal(f.state().needsFrame, false); assert.deepEqual(f.selected(), ['shape:a', 'shape:b'])
    await f.pointer('up', 450, 130, { altKey: true })
    assert.equal(f.state().scribble, null); assert.equal(f.state().needsFrame, false); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('宿主同步阻止已处理 Mod+A/Tab 的浏览器默认行为；普通字符和空选择 Tab 仍交浏览器', async () => {
  const { attachPreviewInput } = await import('./renderer-preview/input.js')
  const f = await selectionFixture(), host = new EventTarget(), errors = []
  const controls = attachPreviewInput(host, f.interaction, { onError: error => errors.push(error) })
  const send = (key, extra = {}, type = 'keydown') => {
    const event = Object.assign(new Event(type, { cancelable: true }), { key, ...extra }); host.dispatchEvent(event); return event
  }
  try {
    assert.equal(send('Tab').defaultPrevented, false)
    assert.equal(send('a', { metaKey: true }).defaultPrevented, true); assert.equal(f.selected().length, 3)
    assert.equal(send('Tab').defaultPrevented, true)
    assert.equal(send('Tab', {}, 'keyup').defaultPrevented, true); assert.deepEqual(f.selected(), ['shape:b'])
    assert.equal(send('q').defaultPrevented, false)
    assert.deepEqual(errors, []); assert.equal(f.commits.length, 0)
  } finally { controls.dispose(); f.close() }
})

test('快捷键关闭时保留 Escape 取消通路，空闲清选择交给总开关停用', async () => {
  const { createSelectionShortcuts } = await import('../engine/interaction/selection-shortcuts.js')
  const actions = [], state = { mode: 'idle', selectedIds: ['shape:a'], shortcutsEnabled: false }
  let active = false
  const keys = createSelectionShortcuts({ session: { state: { get: () => ({ isGestureActive: active }) } }, index: { getRecord: () => ({ type: 'geo' }) }, read: () => state, select: action => { actions.push(action); return true } })
  const escape = { type: 'key_down', key: 'Escape' }
  assert.equal(keys.handle(escape), false); assert.deepEqual(actions, [])
  active = true; assert.equal(keys.handle(escape), false, '继续下传给活动工具取消，而非截断 Escape')
  active = false; state.shortcutsEnabled = true
  assert.equal(keys.handle(escape), true); assert.deepEqual(actions, ['clear'])
})

test('提交中的点击不参与连击，完成后的第一次组点击保持单击', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const f = await selectionFixture(commands, { beforeCommit: () => gate })
  try {
    f.pointer('down', 120, 120); f.pointer('move', 150, 140)
    const saving = f.pointer('up', 150, 140)
    for (let i = 0; i < 10 && !f.session.state.get().isSubmitting; i++) await Promise.resolve()
    assert.equal(f.session.state.get().isSubmitting, true)
    f.pointer('down', 620, 320); await f.pointer('up', 620, 320)
    release(); await saving
    f.pointer('down', 620, 320); await f.pointer('up', 620, 320)
    assert.deepEqual(f.selected(), ['shape:g']); assert.equal(f.state().focusedGroupId, 'page:page')
    assert.equal(f.commits.length, 1)
  } finally { release(); f.close() }
})
