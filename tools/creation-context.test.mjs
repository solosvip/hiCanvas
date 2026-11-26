import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'

const keys = ['r', 'o', 'f', 'g', 'q', 'a']
const creationState = f => {
  const { toolId, creation, camera, mode, selectedIds } = f.interaction.state.get()
  return { toolId, creation, camera, mode, selectedIds }
}

for (const owner of ['form', 'menu', 'text-editing']) test(`${owner} 拦住全部创建快捷键，返回画布后恢复`, async () => {
  const f = await creationFixture()
  try {
    f.interaction.setInputContext({ owner })
    const before = creationState(f)
    for (const key of keys) {
      assert.equal(await f.key(key), false)
      assert.equal(await f.key(key, {}, 'key_up'), false)
      assert.deepEqual(creationState(f), before)
      assert.deepEqual(f.current(), f.initial)
      assert.equal(f.commits.length, 0)
    }
    f.interaction.setInputContext({ owner: 'canvas' })
    assert.equal(f.key('r'), true)
    assert.equal(f.interaction.state.get().toolId, 'geo')
    await f.key('a')
    assert.equal(f.shapes()[0].meta.cowartAiImageHolder, true)
    assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

for (const source of ['context', 'event', '229']) test(`组字 ${source} 优先于 R/O/F/G/Q/A，结束组字后恢复`, async () => {
  const f = await creationFixture()
  try {
    if (source === 'context') f.interaction.setInputContext({ owner: 'canvas', isComposing: true })
    const extra = source === 'event' ? { isComposing: true } : source === '229' ? { keyCode: 229 } : {}
    const before = creationState(f)
    for (const key of keys) {
      assert.equal(await f.key(key, extra), false)
      assert.deepEqual(creationState(f), before)
      assert.equal(f.commits.length, 0)
    }
    f.interaction.setInputContext({ owner: 'canvas' })
    assert.equal(f.key('o'), true)
    assert.equal(f.interaction.state.get().creation.geo, 'ellipse')
    assert.equal(f.interaction.state.get().toolId, 'geo')
  } finally { f.close() }
})

test('关闭快捷键拦住全部创建动作，重新开启恢复且不改变其他窗口', async () => {
  const f = await creationFixture(), other = await creationFixture()
  try {
    f.interaction.setShortcutsEnabled(false)
    const before = creationState(f)
    for (const key of keys) {
      assert.equal(await f.key(key), false)
      assert.deepEqual(creationState(f), before)
    }
    assert.equal(f.commits.length, 0)
    assert.equal(other.interaction.state.get().shortcutsEnabled, true)
    f.interaction.setShortcutsEnabled(true)
    assert.equal(f.key('f'), true)
    assert.equal(f.interaction.state.get().toolId, 'frame')
    assert.equal(f.key('q'), true)
    assert.equal(f.interaction.state.get().creation.toolLocked, true)
  } finally { f.close(); other.close() }
})

test('保存中先拒绝创建快捷键，撤销仍由运行时拒绝且保留正在保存的内容', async () => {
  let release
  const f = await creationFixture({ beforeCommit: () => new Promise(resolve => { release = resolve }) })
  let pending
  try {
    pending = f.key('a')
    assert.equal(f.session.state.get().isSubmitting, true)
    const before = creationState(f), records = f.session.store.getStoreSnapshot()
    for (const key of keys) {
      assert.equal(await f.key(key), undefined)
      assert.deepEqual(creationState(f), before)
      assert.deepEqual(f.session.store.getStoreSnapshot(), records)
    }
    await assert.rejects(f.key('z', { metaKey: true }))
    assert.equal(f.session.state.get().isSubmitting, true)
    assert.deepEqual(f.session.store.getStoreSnapshot(), records)
    assert.equal(f.commits.length, 1)
    release(); await pending; pending = null
    assert.equal(f.shapes().length, 1)
  } finally { release?.(); await pending; f.close() }
})

for (const modifier of ['metaKey', 'ctrlKey']) test(`${modifier}+Z 保留活动创建预览，松手后撤销重做仍是整次创建`, async () => {
  const f = await creationFixture()
  try {
    f.key('r'); f.pointer('down', 500, 350); f.pointer('move', 650, 430)
    const preview = f.previewShapes()
    await assert.rejects(f.key('z', { [modifier]: true }))
    assert.equal(f.session.state.get().isGestureActive, true)
    assert.deepEqual(f.previewShapes(), preview)
    assert.equal(f.commits.length, 0)
    await f.pointer('up', 650, 430)
    const saved = f.current()
    await f.key('z', { [modifier]: true })
    assert.deepEqual(f.current(), f.initial)
    await f.key('z', { [modifier]: true, shiftKey: true })
    assert.deepEqual(f.current(), saved)
  } finally { f.close() }
})

test('Mod+A 只委托选择，裸 A 只创建一个 AI 图片框', async () => {
  const f = await creationFixture()
  try {
    f.key('r'); await f.click(500, 350)
    const id = f.shapes()[0].id
    for (const modifier of ['metaKey', 'ctrlKey']) {
      assert.equal(f.key('a', { [modifier]: true }), true)
      assert.deepEqual(f.interaction.state.get().selectedIds, [id])
      assert.equal(f.commits.length, 1)
    }
    await f.key('a')
    assert.equal(f.shapes().length, 2)
    assert.equal(f.shapes().filter(s => s.meta.cowartAiImageHolder).length, 1)
    assert.equal(f.commits.length, 2)
  } finally { f.close() }
})

for (const source of ['canvas', 'toolbar', 'comma']) test(`${source} 创建在上下文切换、组字、禁用或指针取消后不遗留预览和待提交按下`, async () => {
  const f = await creationFixture()
  try {
    for (const reason of ['form', 'menu', 'text-editing', 'composition', 'disabled', 'pointer-cancel']) {
      f.interaction.setInputContext({ owner: 'canvas' }); f.interaction.setShortcutsEnabled(true)
      if (source === 'toolbar') f.interaction.beginToolDrag({ toolId: 'geo' })
      else f.interaction.setTool('geo')
      if (source === 'comma') { f.pointer('move', 500, 350, { buttons: 0 }); f.key(',') }
      else f.pointer('down', 500, 350)
      f.pointer('move', 650, 430)
      assert.equal(f.previewShapes().length, 1)
      assert.equal(f.session.state.get().isGestureActive, true)
      if (reason === 'pointer-cancel') f.pointer('cancel', 650, 430)
      else if (reason === 'disabled') f.interaction.setShortcutsEnabled(false)
      else f.interaction.setInputContext({ owner: reason === 'composition' ? 'canvas' : reason, isComposing: reason === 'composition' })
      assert.equal(f.session.state.get().isGestureActive, false)
      assert.equal(f.interaction.state.get().creation.dragFromToolbar, false)
      assert.equal(f.interaction.state.get().mode, 'idle')
      assert.deepEqual(f.current(), f.initial)
      assert.deepEqual(f.previewShapes(), [])
      f.interaction.setInputContext({ owner: 'canvas' }); f.interaction.setShortcutsEnabled(true)
      if (source === 'comma') await f.key(',', {}, 'key_up')
      else await f.pointer('up', 650, 430)
      assert.equal(f.commits.length, 0)
    }
    f.interaction.setTool('geo'); await f.click(700, 500)
    assert.equal(f.commits.length, 1)
  } finally { f.close() }
})
