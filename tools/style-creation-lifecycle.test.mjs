import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'
import { createCanvasInteraction, executeCanvasCommands } from '../engine/index.js'

const content = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

for (const entry of ['text', 'note', 'double']) test(`下一对象透明度0的${entry}仍可完成首次输入，撤销不遗留手势`, async () => {
  const f = await creationFixture()
  try {
    await f.interaction.setStyles({ opacity: 0, color: 'red' })
    if (entry === 'double') { await f.click(300, 300); await f.click(300, 300) }
    else { f.interaction.setTool(entry); await f.click(300, 300) }
    const id = f.interaction.state.get().textEditing?.id
    assert.ok(id)
    assert.equal(f.session.store.get(id).opacity, 0)
    f.interaction.editText({ type: 'update', content: content('Hidden draft') })
    await f.interaction.editText({ type: 'finish' })
    assert.equal(f.session.state.get().isGestureActive, false)
    assert.equal(f.current().store[id].opacity, 0)
    assert.equal(f.commits.length, 1)
    await f.session.undo(); assert.equal(f.shapes().length, 0)
    await f.session.redo(); assert.equal(f.current().store[id].opacity, 0)
    assert.equal(f.interaction.editText({ type: 'begin', id }), false, '保存后的隐藏对象仍不可重新选中编辑')
  } finally { f.close() }
})

test('同画板两交互默认互不影响；换工具、取消、撤销保留，销毁重建重置', async () => {
  const f = await creationFixture()
  let other, rebuilt
  try {
    other = createCanvasInteraction({ session: f.session, toolIds: ['select', 'geo', 'highlight'], viewport: { w: 1280, h: 800 }, edgeScrolling: false })
    await f.interaction.setStyles({ color: 'red', geo: 'octagon', opacity: .5 })
    assert.equal(other.getStyles().next.color, 'black')
    assert.equal(other.getStyles().next.geo, 'rectangle')
    f.interaction.setTool('hand'); f.interaction.setTool('geo')
    f.pointer('down', 300, 250); f.pointer('move', 500, 400); f.key('Escape')
    assert.equal(f.shapes().length, 0)
    assert.equal(f.commits.length, 0)
    assert.equal(f.interaction.getStyles().next.geo, 'octagon')
    await f.click(700, 500)
    const saved = f.shapes()[0]
    await f.session.undo()
    assert.equal(f.interaction.getStyles().next.color, 'red')
    await f.session.redo(); assert.deepEqual(f.shapes(), [saved])
    f.interaction.dispose()
    rebuilt = createCanvasInteraction({ session: f.session, toolIds: ['select', 'geo'], edgeScrolling: false })
    assert.deepEqual([rebuilt.getStyles().next.geo, rebuilt.getStyles().next.color, rebuilt.getStyles().next.opacity], ['rectangle', 'black', 1])
    assert.deepEqual(f.shapes(), [saved])
    assert.ok(f.commits.every(c => !/styles|recentTool|toolLocked/.test(JSON.stringify(c.commands))))
    assert.throws(() => f.interaction.setCreationOptions({ geo: 'star' }), /关闭/)
  } finally { other?.dispose(); rebuilt?.dispose(); f.close() }
})

test('创建保存失败回滚预览但保留本窗口默认，重试不漏写透明度', async () => {
  let fail = true
  const f = await creationFixture({ beforeCommit: () => { if (fail) throw new Error('Synthetic creation failure') } })
  try {
    await f.interaction.setStyles({ color: 'red', opacity: .25, geo: 'trapezoid' })
    f.interaction.setTool('geo')
    await assert.rejects(f.click(300, 250), /Synthetic creation failure/)
    assert.deepEqual(f.current(), f.initial)
    assert.equal(f.previewShapes().length, 0)
    assert.equal(f.interaction.getStyles().next.geo, 'trapezoid')
    fail = false
    await f.click(700, 500)
    assert.deepEqual([f.shapes()[0].props.geo, f.shapes()[0].props.color, f.shapes()[0].opacity], ['trapezoid', 'red', .25])
    await f.session.undo(); assert.equal(f.shapes().length, 0)
  } finally { f.close() }
})

test('独立create_shape与外部导入命令沿显式文档规则，不读取窗口默认', async () => {
  const f = await creationFixture()
  try {
    await f.interaction.setStyles({ color: 'red', geo: 'pentagon', font: 'mono', opacity: .25 })
    const commands = [
      { type: 'create_shape', id: 'shape:plain', shapeType: 'geo' },
      { type: 'create_shape', id: 'shape:import', shapeType: 'text', text: 'Imported', x: 400, props: { font: 'serif', color: 'blue' } },
    ]
    const standalone = executeCanvasCommands(f.initial, commands).snapshot
    await f.remote(commands)
    for (const id of ['shape:plain', 'shape:import']) {
      assert.deepEqual(f.current().store[id].props, standalone.store[id].props)
      assert.equal(f.current().store[id].opacity, standalone.store[id].opacity)
    }
    const shape = f.current().store['shape:plain']
    assert.deepEqual([shape.props.geo, shape.props.color, shape.props.font, shape.props.dash, shape.opacity], ['rectangle', 'black', 'sans', 'solid', 1])
    assert.equal(f.current().store['shape:import'].props.color, 'blue')
    assert.equal(f.interaction.getStyles().next.geo, 'pentagon')
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

for (const tool of ['geo', 'frame', 'arrow', 'line', 'draw', 'highlight']) test(`${tool}可用透明度0创建，隐藏不遗留活动手势`, async () => {
  const f = await creationFixture()
  try {
    await f.interaction.setStyles({ opacity: 0 })
    f.interaction.setTool(tool)
    f.pointer('down', 300, 250); f.pointer('move', 500, 400); await f.pointer('up', 500, 400)
    assert.equal(f.shapes().length, 1)
    assert.equal(f.shapes()[0].opacity, 0)
    assert.equal(f.session.state.get().isGestureActive, false)
    assert.equal(f.commits.length, 1)
    await f.session.undo(); assert.equal(f.shapes().length, 0)
    await f.session.redo(); assert.equal(f.shapes()[0].opacity, 0)
  } finally { f.close() }
})

for (const tool of ['text', 'note']) test(`${tool}取消首次输入保留默认且不保存隐藏草稿`, async () => {
  const f = await creationFixture()
  try {
    await f.interaction.setStyles({ opacity: 0, color: 'red', font: 'mono' })
    f.interaction.setTool(tool); await f.click(300, 250)
    f.interaction.editText({ type: 'update', content: content('Cancelled') })
    f.interaction.editText({ type: 'cancel' })
    assert.equal(f.previewShapes().length, 0)
    assert.equal(f.session.state.get().isGestureActive, false)
    assert.equal(f.commits.length, 0)
    assert.deepEqual([f.interaction.getStyles().next.opacity, f.interaction.getStyles().next.color], [0, 'red'])
  } finally { f.close() }
})
