import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { selectionFixture, shape } from './selection-fixture.mjs'

const commands = [shape('a', 100, 100), shape('b', 600, 300), shape('c', 760, 300), { type: 'group_shapes', ids: ['shape:b', 'shape:c'], groupId: 'shape:g' }]
const key = (f, name, extra = {}, type = 'down') => f.input({ type: `key_${type}`, key: name, ...extra })
const scope = f => ({ ids: f.selected(), group: f.state().focusedGroupId, camera: f.state().camera })

for (const owner of ['form', 'menu', 'text-editing']) test(`${owner} 内全选、Esc、Tab、Enter 不进入选择工具，回到画布后恢复`, async () => {
  const f = await selectionFixture(commands)
  try {
    await f.doubleClick(620, 320)
    const before = scope(f)
    f.interaction.setInputContext({ owner })
    for (const [name, extra] of [['a', { metaKey: true }], ['a', { ctrlKey: true }], ['Escape', {}], ['Tab', {}], ['Enter', {}]]) {
      assert.equal(key(f, name, extra), false); assert.equal(key(f, name, extra, 'up'), false)
      assert.deepEqual(scope(f), before)
    }
    f.interaction.setInputContext({ owner: 'canvas' })
    assert.equal(key(f, 'a', { metaKey: true }), true); assert.deepEqual(f.selected(), ['shape:b', 'shape:c'])
    key(f, 'Escape'); assert.deepEqual(f.selected(), ['shape:g']); assert.equal(f.state().focusedGroupId, 'page:page')
    assert.deepEqual(f.current(), f.initial); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

for (const flag of [{ isComposing: true }, { keyCode: 229 }]) test(`组字按键 ${Object.keys(flag)[0]} 不触发选择，且清理待松开的 Tab`, async () => {
  const f = await selectionFixture(commands)
  try {
    await f.click(120, 120)
    key(f, 'Tab')
    const before = scope(f)
    for (const name of ['a', 'Escape', 'Tab', 'Enter']) assert.equal(key(f, name, { metaKey: name === 'a', ...flag }), false)
    assert.deepEqual(scope(f), before)
    key(f, 'Tab', {}, 'up'); assert.deepEqual(scope(f), before)
    assert.equal(key(f, 'a', { metaKey: true }), true); assert.deepEqual(f.selected(), ['shape:a', 'shape:g'])
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('快捷键关闭阻止全选与空闲 Esc，活动 Esc 仍取消；重新开启恢复且不残留 Enter', async () => {
  const f = await selectionFixture(commands)
  try {
    await f.click(620, 320); key(f, 'Enter')
    f.interaction.setShortcutsEnabled(false)
    assert.equal(key(f, 'a', { metaKey: true }), false)
    key(f, 'Escape'); assert.deepEqual(f.selected(), ['shape:g'])
    f.interaction.setShortcutsEnabled(true)
    key(f, 'Enter', {}, 'up'); assert.equal(f.state().focusedGroupId, 'page:page')
    await f.click(120, 120); f.interaction.setShortcutsEnabled(false)
    f.pointer('down', 130, 130); f.pointer('move', 160, 150)
    assert.equal(f.state().mode, 'dragging')
    key(f, 'Escape'); assert.equal(f.state().mode, 'idle'); assert.equal(f.session.store.get('shape:a').x, 100)
    await f.pointer('up', 160, 150); assert.deepEqual(f.selected(), ['shape:a'])
    f.interaction.setShortcutsEnabled(true); key(f, 'a', { metaKey: true }); assert.deepEqual(f.selected(), ['shape:a', 'shape:g'])
    key(f, 'Escape'); assert.deepEqual(f.selected(), []); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

for (const context of [{ owner: 'form' }, { owner: 'menu' }, { owner: 'text-editing' }, { owner: 'canvas', isComposing: true }]) test(`Tab/Enter 按下后转入 ${JSON.stringify(context)} 再回来，松键不推进或进入组`, async () => {
  const f = await selectionFixture(commands)
  try {
    for (const name of ['Tab', 'Enter']) {
      await f.click(name === 'Tab' ? 120 : 620, name === 'Tab' ? 120 : 320)
      const before = scope(f)
      assert.equal(key(f, name), true)
      f.interaction.setInputContext(context)
      f.interaction.setInputContext({ owner: 'canvas' })
      key(f, name, {}, 'up'); assert.deepEqual(scope(f), before)
      key(f, name); key(f, name, {}, 'up')
      if (name === 'Tab') assert.notDeepEqual(f.selected(), before.ids)
      else assert.equal(f.state().focusedGroupId, 'shape:g')
      key(f, 'Escape'); key(f, 'Escape')
    }
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('逗号虚拟指针也经过共用计数：两次完整点击进入组，失焦取消未松开的手势', async () => {
  const f = await selectionFixture(commands)
  try {
    f.pointer('move', 620, 320, { buttons: 0 })
    key(f, ','); await key(f, ',', {}, 'up'); assert.deepEqual(f.selected(), ['shape:g'])
    key(f, ','); await key(f, ',', {}, 'up'); assert.equal(f.state().focusedGroupId, 'shape:g'); assert.deepEqual(f.selected(), ['shape:b'])
    key(f, 'Escape'); key(f, 'Escape')
    f.pointer('move', 120, 120, { buttons: 0 }); key(f, ',')
    f.pointer('move', 150, 130, { buttons: 0 }); assert.equal(f.state().mode, 'dragging')
    f.interaction.setInputContext({ owner: 'form' }); assert.equal(f.state().mode, 'idle'); assert.equal(f.session.store.get('shape:a').x, 100)
    f.interaction.setInputContext({ owner: 'canvas' }); key(f, ',', {}, 'up')
    assert.equal(f.state().mode, 'idle'); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('画布 double_click 不作为组双击；小地图专用的原生事件不泄漏到选择', async () => {
  const f = await selectionFixture(commands)
  try {
    await f.click(620, 320)
    f.input({ type: 'double_click', point: { x: 620, y: 320 } })
    assert.equal(f.state().focusedGroupId, 'page:page'); assert.deepEqual(f.selected(), ['shape:g'])
    await f.doubleClick(620, 320)
    assert.equal(f.state().focusedGroupId, 'shape:g')
  } finally { f.close() }
})

test('逗号活动手势的 Esc 只取消预览，不额外清选择或退出当前组', async () => {
  const f = await selectionFixture(commands)
  try {
    await f.doubleClick(620, 320)
    const before = scope(f)
    f.pointer('move', 630, 330, { buttons: 0 }); key(f, ',')
    key(f, 'Escape'); key(f, ',', {}, 'up')
    assert.deepEqual(scope(f), before); assert.equal(f.state().mode, 'idle'); assert.equal(f.commits.length, 0)
    key(f, 'Escape'); assert.equal(f.state().focusedGroupId, 'page:page')
  } finally { f.close() }
})

for (const end of ['focus', 'Escape']) test(`逗号按下被 ${end} 取消，400ms内普通点击保持单击`, async () => {
  const f = await selectionFixture(commands)
  try {
    f.pointer('move', 620, 320, { buttons: 0 }); key(f, ',')
    if (end === 'focus') { f.interaction.setInputContext({ owner: 'form' }); f.interaction.setInputContext({ owner: 'canvas' }) }
    else key(f, 'Escape')
    key(f, ',', {}, 'up')
    f.pointer('down', 620, 320); await f.pointer('up', 620, 320)
    assert.equal(f.state().focusedGroupId, 'page:page'); assert.deepEqual(f.selected(), ['shape:g'])
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('普通指针 Esc 取消后，400ms内同点单击不进入组', async () => {
  const f = await selectionFixture(commands)
  try {
    f.pointer('down', 620, 320); key(f, 'Escape'); await f.pointer('up', 620, 320)
    f.pointer('down', 620, 320); await f.pointer('up', 620, 320)
    assert.equal(f.state().focusedGroupId, 'page:page'); assert.deepEqual(f.selected(), ['shape:g'])
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})
