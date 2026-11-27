import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'

test('原生观察的全部离散选项可用于适用子集，线点、笔迹段、标签色及其他字段不被重写', async () => {
  const f = await creationFixture({ commands: ['geo', 'text', 'note', 'arrow', 'line', 'image', 'frame'].map((shapeType, i) => ({ type: 'create_shape', id: `shape:${shapeType}`, shapeType, x: i * 300, text: ['geo', 'text', 'note', 'arrow'].includes(shapeType) ? 'Long label' : undefined, props: shapeType === 'arrow' ? { bend: 30 } : {}, meta: { retained: shapeType } })) })
  try {
    for (const type of ['draw', 'highlight']) { f.interaction.setTool(type); f.pointer('down', 100, 600); f.pointer('move', 180, 650); await f.pointer('up', 240, 610) }
    f.interaction.setTool('select'); f.interaction.select('all')
    const colored = ['geo', 'text', 'note', 'arrow', 'line', 'draw', 'highlight']
    const cases = [
      ['color', 'color', colored, ['black', 'grey', 'light-violet', 'violet', 'blue', 'light-blue', 'yellow', 'orange', 'green', 'light-green', 'light-red', 'red', 'white']],
      ['opacity', null, [...colored, 'image', 'frame'], [.1, .25, .5, .75, 1, .37]],
      ['fill', 'fill', ['geo', 'draw', 'arrow'], ['none', 'semi', 'solid', 'pattern', 'lined-fill', 'fill']],
      ['dash', 'dash', ['geo', 'draw', 'arrow', 'line'], ['draw', 'dashed', 'dotted', 'solid']],
      ['size', 'size', colored, ['s', 'm', 'l', 'xl']],
      ['font', 'font', ['geo', 'text', 'note', 'arrow'], ['draw', 'sans', 'serif', 'mono']],
      ['textAlign', 'textAlign', ['text'], ['start', 'middle', 'end']],
      ['align', 'align', ['geo', 'note'], ['start', 'middle', 'end']],
      ['verticalAlign', 'verticalAlign', ['geo', 'note'], ['start', 'middle', 'end']],
      ['geo', 'geo', ['geo'], ['rectangle', 'ellipse', 'triangle', 'diamond', 'hexagon', 'oval', 'rhombus', 'star', 'cloud', 'heart', 'x-box', 'check-box', 'arrow-left', 'arrow-right', 'arrow-up', 'arrow-down', 'pentagon', 'octagon', 'rhombus-2', 'trapezoid']],
      ['arrowKind', 'kind', ['arrow'], ['arc', 'elbow']],
      ['arrowheadStart', 'arrowheadStart', ['arrow'], ['none', 'arrow', 'triangle', 'square', 'dot', 'diamond', 'inverted', 'bar']],
      ['arrowheadEnd', 'arrowheadEnd', ['arrow'], ['none', 'arrow', 'triangle', 'square', 'dot', 'diamond', 'inverted', 'bar']],
      ['spline', 'spline', ['line'], ['line', 'cubic']],
    ]
    for (const [key, field, types, values] of cases) for (const value of values) {
      const before = f.current(), count = f.commits.length
      await f.interaction.setStyles({ [key]: value })
      for (const record of Object.values(before.store)) {
        const expected = record.typeName === 'shape' && types.includes(record.type) ? field ? { ...record, props: { ...record.props, [field]: value } } : { ...record, opacity: value } : record
        assert.deepEqual(f.current().store[record.id], expected, `${key}=${value} (${record.type})`)
      }
      if (f.commits.length !== count) { assert.equal(f.commits.length, count + 1); await f.session.undo(); assert.deepEqual(f.current(), before); await f.session.redo() }
      const savedCount = f.commits.length
      await f.interaction.setStyles({ [key]: value })
      assert.equal(f.commits.length, savedCount, `${key}相同值不写空历史`)
    }
  } finally { f.close() }
})

test('透明度允许0（旧面板最低10%的有意差异），隐藏仍可一次撤销恢复', async () => {
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:a', shapeType: 'image' }] })
  try {
    const before = f.current()
    f.interaction.select('all')
    await f.interaction.setStyles({ opacity: 0 })
    assert.equal(f.current().store['shape:a'].opacity, 0)
    assert.equal(f.interaction.getStyles().next.opacity, 0)
    assert.deepEqual(f.interaction.state.get().selectedIds, [], '沿用不可见对象不可选择的规则')
    assert.equal(f.commits.length, 1)
    await f.session.undo()
    assert.deepEqual(f.current(), before)
    assert.equal(f.interaction.getStyles().next.opacity, 0)
  } finally { f.close() }
})

test('无选择改样式只改本窗口默认，不写画板、不增加撤销；描述不可变', async () => {
  const f = await creationFixture(), other = await creationFixture()
  try {
    const before = f.current()
    const initial = f.interaction.getStyles()
    assert.equal(initial.selectionCount, 0)
    assert.equal(initial.source, 'next')
    assert.equal(initial.styles.color.value, 'black')
    await f.interaction.setStyles({ color: 'red', opacity: .37, arrowKind: 'elbow' })
    const styles = f.interaction.getStyles()
    assert.equal(styles.next.color, 'red')
    assert.equal(styles.next.opacity, .37)
    assert.equal(styles.styles.arrowKind.value, 'elbow')
    assert.equal(f.interaction.state.get().styles.next.color, 'red')
    assert.equal(other.interaction.getStyles().next.color, 'black')
    assert.deepEqual(f.current(), before)
    assert.equal(f.commits.length, 0)
    await assert.rejects(f.session.undo(), /没有可撤销/)
    assert.throws(() => { styles.next.color = 'blue' }, TypeError)
    assert.throws(() => { styles.styles.opacity.choices.push(.37) }, TypeError)
    assert.deepEqual(styles.styles.opacity.choices, [.1, .25, .5, .75, 1])
  } finally { f.close(); other.close() }
})

test('其他手势和裁剪中的样式动作不可用，不取消原有手势', async () => {
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:a', shapeType: 'geo', props: { fill: 'solid' } }] })
  try {
    f.interaction.select('all')
    f.pointer('down', 100, 80); f.pointer('move', 130, 100)
    const preview = f.session.store.get('shape:a')
    assert.equal((await f.interaction.setStyles({ color: 'red' })).reason, 'pointer-gesture')
    assert.deepEqual(f.session.store.get('shape:a'), preview)
    assert.equal(f.session.state.get().isGestureActive, true)
    await f.pointer('up', 130, 100)
    assert.equal(f.commits.length, 1)
  } finally { f.close() }
  const g = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:i', shapeType: 'image' }] })
  try {
    g.interaction.select('all')
    g.interaction.cropImage({ type: 'start', id: 'shape:i' })
    assert.equal((await g.interaction.setStyles({ opacity: .5 })).reason, 'cropping')
    assert.equal(g.interaction.state.get().croppingId, 'shape:i')
    assert.equal(g.commits.length, 0)
  } finally { g.close() }
})

test('适用子集一次保存和撤销；字段映射保持标签色及无关记录，撤销不回退会话默认', async () => {
  const f = await creationFixture({ commands: [
    { type: 'create_shape', id: 'shape:a', shapeType: 'geo', text: 'Alpha', props: { color: 'blue', labelColor: 'black' }, meta: { custom: 'keep' } },
    { type: 'create_shape', id: 'shape:b', shapeType: 'text', text: 'Beta', x: 400, props: { color: 'green' } },
    { type: 'create_shape', id: 'shape:c', shapeType: 'image', x: 900 },
  ] })
  try {
    f.interaction.select('all')
    const selected = f.interaction.state.get().selectedIds, original = f.current()
    await f.interaction.setStyles({ color: 'red', fill: 'pattern', textAlign: 'end', align: 'start', opacity: .37 })
    assert.equal(f.commits.length, 1)
    const saved = f.current().store
    assert.deepEqual(saved['shape:a'], { ...original.store['shape:a'], opacity: .37, props: { ...original.store['shape:a'].props, color: 'red', fill: 'pattern', align: 'start' } })
    assert.deepEqual(saved['shape:b'], { ...original.store['shape:b'], opacity: .37, props: { ...original.store['shape:b'].props, color: 'red', textAlign: 'end' } })
    assert.deepEqual(saved['shape:c'], { ...original.store['shape:c'], opacity: .37 })
    assert.deepEqual(f.interaction.state.get().selectedIds, selected)
    assert.equal(f.interaction.getStyles().styles.color.value, 'red')
    await f.session.undo()
    assert.deepEqual(f.current(), original)
    assert.equal(f.interaction.getStyles().next.color, 'red')
    await f.session.redo()
    assert.deepEqual(f.current().store, saved)
    await f.interaction.setStyles({ color: 'red', opacity: .37 })
    assert.equal(f.commits.length, 1, '相同值不增加空历史')
  } finally { f.close() }
})

test('整份patch先验证，非法值不部分写入；空动作和不适用动作没有历史', async () => {
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:a', shapeType: 'geo' }] })
  try {
    f.interaction.select('all')
    const before = f.current(), defaults = f.interaction.getStyles().next
    for (const patch of [null, [], { color: 'red', font: 'unknown' }, { color: 'red', opacity: NaN }, { opacity: Infinity }, { opacity: -.1 }, { opacity: 1.01 }, { opacity: '0.5' }, { color: 'red', x: 42 }, { kind: 'elbow' }, { constructor: 'red' }]) {
      await assert.rejects(f.interaction.setStyles(patch), /样式/)
      assert.deepEqual(f.current(), before)
      assert.deepEqual(f.interaction.getStyles().next, defaults)
    }
    await f.interaction.setStyles({})
    await f.interaction.setStyles({ arrowKind: 'elbow' })
    assert.deepEqual(f.current(), before)
    assert.deepEqual(f.interaction.getStyles().next, defaults)
    assert.equal(f.commits.length, 0)
    await assert.rejects(f.session.undo(), /没有可撤销/)
  } finally { f.close() }
})

test('保存失败恢复选择和文档，不采纳默认；成功前也不暴露半成功默认', async () => {
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const waiting = new Promise(resolve => { release = resolve })
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:a', shapeType: 'geo' }], beforeCommit: async () => { entered(); await waiting; throw new Error('synthetic style failure') } })
  try {
    f.interaction.select('all')
    const before = f.current(), defaults = f.interaction.getStyles().next
    const pending = f.interaction.setStyles({ color: 'red' })
    await started
    assert.equal((await f.interaction.setStyles({ fill: 'solid' })).reason, 'submitting')
    assert.equal(f.session.store.get('shape:a').props.color, 'red')
    assert.deepEqual(f.interaction.getStyles().next, defaults)
    release()
    await assert.rejects(pending, /synthetic style failure/)
    assert.deepEqual(f.current(), before)
    assert.equal(f.session.store.get('shape:a').props.color, 'black')
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a'])
    assert.deepEqual(f.interaction.getStyles().next, defaults)
  } finally { release(); f.close() }
})
