import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'

// Native legacy matrix, 2026-11-27. A field with the same name in a record
// (e.g. frame.color) does not imply that its style control applies.
const common = ['color', 'opacity', 'size']
const supported = {
  geo: [...common, 'fill', 'dash', 'font', 'align', 'verticalAlign', 'geo'],
  text: [...common, 'font', 'textAlign'],
  note: [...common, 'font', 'align', 'verticalAlign'],
  arrow: [...common, 'fill', 'dash', 'font', 'arrowKind', 'arrowheadStart', 'arrowheadEnd'],
  line: [...common, 'dash', 'spline'], draw: [...common, 'fill', 'dash'], highlight: common,
  frame: ['opacity'], image: ['opacity'], video: ['opacity'], embed: ['opacity'],
}
for (const [type, keys] of Object.entries(supported)) test(`${type}的样式查询仅报告原生支持项，读取不写文档`, async () => {
  const drawn = ['draw', 'highlight'].includes(type)
  const f = await creationFixture({ commands: drawn ? [] : [{ type: 'create_shape', id: 'shape:target', shapeType: type, text: ['geo', 'text', 'note', 'arrow'].includes(type) ? 'Label' : undefined }] })
  try {
    if (drawn) { f.interaction.setTool(type); f.pointer('down', 100, 100); f.pointer('move', 200, 150); await f.pointer('up', 200, 150); f.interaction.setTool('select') }
    f.interaction.select('all')
    const before = f.current(), commits = f.commits.length, query = f.interaction.getStyles()
    assert.equal(query.source, 'selection')
    assert.equal(query.selectionCount, 1)
    assert.deepEqual(Object.entries(query.styles).filter(([, value]) => value.state === 'shared').map(([key]) => key).sort(), [...keys].sort())
    for (const [key, value] of Object.entries(query.styles)) {
      assert.equal(value.supportedCount, keys.includes(key) ? 1 : 0)
      if (keys.includes(key)) assert.ok(Object.hasOwn(value, 'value'), key)
      else { assert.equal(value.state, 'unsupported'); assert.equal(Object.hasOwn(value, 'value'), false) }
    }
    assert.deepEqual(f.current(), before)
    assert.equal(f.commits.length, commits)
    assert.throws(() => { query.styles.opacity.value = .2 }, TypeError)
  } finally { f.close() }
})

test('组查询包含锁定的嵌套叶子，动作仅更新可编辑叶子；组自身透明度保持不变（与旧版一致）', async () => {
  const f = await creationFixture({ commands: [
    { type: 'create_shape', id: 'shape:group', shapeType: 'group' },
    { type: 'create_shape', id: 'shape:nested', shapeType: 'group', parentId: 'shape:group' },
    { type: 'create_shape', id: 'shape:a', shapeType: 'geo', parentId: 'shape:nested', props: { color: 'blue' } },
    { type: 'create_shape', id: 'shape:b', shapeType: 'text', parentId: 'shape:nested', text: 'Locked', x: 300, props: { color: 'green' } },
    { type: 'create_shape', id: 'shape:c', shapeType: 'line', parentId: 'shape:group', x: 700 },
    { type: 'update', id: 'shape:b', changes: { isLocked: true } },
    { type: 'update', id: 'shape:group', changes: { opacity: .7 } },
    { type: 'update', id: 'shape:nested', changes: { opacity: .8 } },
  ] })
  try {
    f.interaction.select('all')
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:group'])
    const original = f.current()
    const before = f.interaction.getStyles()
    assert.equal(before.styles.color.supportedCount, 3)
    assert.equal(before.styles.opacity.state, 'shared')
    assert.equal(before.styles.opacity.value, 1, '组自己的透明度不当作孩子的值')
    await f.interaction.setStyles({ color: 'red', opacity: .25 })
    const q = f.interaction.getStyles()
    assert.equal(q.styles.opacity.supportedCount, 3)
    assert.equal(q.styles.opacity.state, 'mixed')
    assert.equal(q.styles.color.state, 'mixed')
    assert.equal(Object.hasOwn(q.styles.color, 'value'), false)
    for (const id of ['shape:a', 'shape:c']) {
      assert.equal(f.current().store[id].opacity, .25)
      assert.equal(f.current().store[id].props.color, 'red')
    }
    for (const id of ['shape:group', 'shape:nested', 'shape:b']) assert.deepEqual(f.current().store[id], original.store[id])
    assert.equal(f.commits.length, 1)
    await f.session.undo()
    assert.deepEqual(f.current(), original)
    await f.session.redo()
    assert.equal(f.interaction.getStyles().styles.opacity.state, 'mixed')
  } finally { f.close() }
})

test('异值不假造统一值；部分支持按各自字段查询，选择本身不采纳下一默认', async () => {
  const f = await creationFixture({ commands: [
    { type: 'create_shape', id: 'shape:text', shapeType: 'text', props: { color: 'red', textAlign: 'end' } },
    { type: 'create_shape', id: 'shape:geo', shapeType: 'geo', x: 300, props: { color: 'blue', align: 'middle' } },
    { type: 'create_shape', id: 'shape:image', shapeType: 'image', x: 700 },
    { type: 'update', id: 'shape:geo', changes: { opacity: .25 } },
    { type: 'update', id: 'shape:text', changes: { opacity: .75 } },
  ] })
  try {
    f.interaction.select('all')
    const q = f.interaction.getStyles()
    assert.equal(q.selectionCount, 3)
    assert.equal(q.styles.color.state, 'mixed')
    assert.equal(q.styles.color.supportedCount, 2)
    assert.equal(Object.hasOwn(q.styles.color, 'value'), false)
    assert.equal(q.styles.opacity.state, 'mixed')
    assert.equal(Object.hasOwn(q.styles.opacity, 'value'), false)
    assert.equal(q.styles.textAlign.value, 'end')
    assert.equal(q.styles.textAlign.supportedCount, 1)
    assert.equal(q.styles.align.value, 'middle')
    assert.equal(q.styles.align.supportedCount, 1)
    assert.equal(q.styles.arrowKind.state, 'unsupported')
    f.interaction.select('clear')
    assert.equal(f.interaction.getStyles().next.color, 'black')
  } finally { f.close() }
})
