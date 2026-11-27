import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'

const content = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

test('几何起手采用适用默认，一次手势保存透明度且不泄漏其他类型字段', async () => {
  const f = await creationFixture()
  try {
    await f.interaction.setStyles({ color: 'red', opacity: .37, geo: 'pentagon', fill: 'pattern', dash: 'dotted', size: 'xl', font: 'mono', align: 'end', verticalAlign: 'start', spline: 'cubic', arrowKind: 'elbow' })
    f.interaction.setTool('geo')
    f.pointer('down', 300, 250)
    f.pointer('move', 500, 400)
    const preview = f.previewShapes()[0]
    assert.deepEqual([preview.props.geo, preview.props.color, preview.props.fill, preview.props.dash, preview.props.size, preview.props.font, preview.props.align, preview.props.verticalAlign, preview.opacity], ['pentagon', 'red', 'pattern', 'dotted', 'xl', 'mono', 'end', 'start', .37])
    assert.equal(Object.hasOwn(preview.props, 'spline'), false)
    assert.equal(Object.hasOwn(preview.props, 'kind'), false)
    assert.equal(f.commits.length, 0)
    assert.equal((await f.interaction.setStyles({ color: 'blue' })).reason, 'pointer-gesture')
    await f.pointer('up', 600, 450)
    const saved = f.shapes()[0]
    assert.equal(saved.props.color, 'red')
    assert.equal(saved.opacity, .37)
    assert.equal(f.commits.length, 1)
    await f.session.undo(); assert.equal(f.shapes().length, 0)
    await f.session.redo(); assert.deepEqual(f.shapes(), [saved])
  } finally { f.close() }
})

for (const entry of ['click', 'drag', 'toolbar', 'double']) test(`文字${entry}起手采用默认，首次输入同事务且排版样式保留`, async () => {
  const f = await creationFixture()
  try {
    await f.interaction.setStyles({ color: 'violet', size: 'l', font: 'serif', textAlign: 'end', opacity: .5, fill: 'solid', align: 'start' })
    if (entry === 'double') { await f.click(300, 250); await f.click(300, 250) }
    else {
      if (entry === 'toolbar') f.interaction.beginToolDrag({ toolId: 'text' })
      else f.interaction.setTool('text')
      f.pointer('down', 300, 250)
      f.pointer('move', entry === 'click' ? 300 : 600, 250)
      await f.pointer('up', entry === 'click' ? 300 : 600, 250)
    }
    const id = f.interaction.state.get().textEditing.id
    const preview = f.session.store.get(id)
    assert.deepEqual([preview.props.color, preview.props.size, preview.props.font, preview.props.textAlign, preview.opacity], ['violet', 'l', 'serif', 'end', .5])
    assert.equal(Object.hasOwn(preview.props, 'fill'), false)
    assert.equal(Object.hasOwn(preview.props, 'align'), false)
    assert.equal(preview.props.autoSize, entry !== 'drag')
    if (entry === 'drag') assert.equal(preview.props.w, 300)
    f.interaction.editText({ type: 'update', content: content('Styled words') })
    await f.interaction.editText({ type: 'finish' })
    assert.equal(f.commits.length, 1)
    const saved = f.shapes()[0]
    assert.equal(saved.props.font, 'serif')
    assert.equal(saved.opacity, .5)
    await f.session.undo(); assert.equal(f.shapes().length, 0)
    await f.session.redo(); assert.deepEqual(f.shapes(), [saved])
  } finally { f.close() }
})

for (const geo of ['rectangle', 'ellipse', 'triangle', 'diamond', 'hexagon', 'oval', 'rhombus', 'star', 'cloud', 'heart', 'x-box', 'check-box', 'arrow-left', 'arrow-right', 'arrow-up', 'arrow-down', 'pentagon', 'octagon', 'rhombus-2', 'trapezoid']) test(`样式入口设${geo}后G及工具栏创建保持同一默认`, async () => {
  const f = await creationFixture()
  try {
    await f.interaction.setStyles({ geo, color: 'green', font: 'sans' })
    assert.equal(f.interaction.state.get().creation.geo, geo)
    f.key('g'); await f.click(350, 250)
    assert.equal(f.shapes()[0].props.geo, geo)
    f.interaction.beginToolDrag({ toolId: 'geo', geo })
    f.pointer('down', 10, 10); f.pointer('move', 950, 600); await f.pointer('up', 950, 600)
    const second = f.shapes()[1]
    assert.deepEqual([second.props.geo, second.props.color, second.props.font], [geo, 'green', 'sans'])
    assert.equal(second.props.w, geo === 'cloud' ? 300 : 200)
    assert.equal(second.props.h, geo === 'cloud' ? 180 : geo === 'star' ? 190 : 200)
    assert.equal(f.interaction.getStyles().next.geo, geo)
    assert.equal(f.commits.length, 2)
  } finally { f.close() }
})

for (const [tool, dimensions, identity] of [
  ['frame', [320, 180], null],
  ['ai-image', [512, 683], 'cowartAiImageHolder'],
  ['ai-draft', [1024, 576], 'cowartAiDraftHolder'],
  ['ai-film', [1024, 576], 'cowartAiFilmHolder'],
  ['ai-slides', [1048, 600], 'cowartAiSlides'],
]) for (const entry of ['click', 'drag', 'toolbar']) test(`${tool}/${entry}只接整体透明度，保留身份、名称及尺寸`, async () => {
  const f = await creationFixture()
  try {
    await f.interaction.setStyles({ color: 'red', opacity: .25, size: 'xl', font: 'mono', fill: 'solid' })
    if (entry === 'toolbar') f.interaction.beginToolDrag({ toolId: tool })
    else f.interaction.setTool(tool)
    f.pointer('down', 300, 250)
    if (entry !== 'click') f.pointer('move', 600, 450)
    await f.pointer('up', entry === 'click' ? 300 : 600, entry === 'click' ? 250 : 450)
    const shape = f.shapes()[0]
    assert.equal(shape.type, 'frame')
    assert.equal(shape.opacity, .25)
    assert.equal(shape.props.color, identity ? 'blue' : 'black')
    assert.deepEqual([shape.props.w, shape.props.h], entry === 'drag' ? [300, 200] : dimensions)
    assert.equal(Object.hasOwn(shape.props, 'font'), false)
    assert.equal(Object.hasOwn(shape.props, 'fill'), false)
    if (identity) { assert.equal(shape.meta[identity], true); assert.match(shape.props.name, /^AI /) }
    else assert.equal(shape.props.name, '')
    const meta = structuredClone(shape.meta)
    await f.session.undo(); assert.equal(f.shapes().length, 0)
    await f.session.redo(); assert.deepEqual(f.shapes()[0].meta, meta)
  } finally { f.close() }
})

test('AI图片快捷键在中心即时创建也取整体透明度且保留#195尺寸规则', async () => {
  const f = await creationFixture()
  try {
    await f.interaction.setStyles({ opacity: .75, color: 'red' })
    await f.key('a')
    const shape = f.shapes()[0]
    assert.deepEqual([shape.type, shape.props.color, shape.opacity, shape.props.w, shape.props.h], ['frame', 'blue', .75, 512, 683])
    assert.equal(shape.meta.cowartAiImageHolder, true)
    assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

for (const tool of ['note', 'line', 'arrow']) test(`工具栏拖入${tool}采用当前适用样式，退出时只提交一次`, async () => {
  const f = await creationFixture()
  try {
    await f.interaction.setStyles({ color: 'blue', opacity: .75, size: 'l', font: 'mono', align: 'end', verticalAlign: 'start', dash: 'dashed', spline: 'cubic', arrowKind: 'elbow', arrowheadEnd: 'diamond' })
    f.interaction.beginToolDrag({ toolId: tool })
    f.pointer('down', 10, 10); f.pointer('move', 500, 400)
    const preview = f.previewShapes()[0]
    assert.deepEqual([preview.props.color, preview.props.size, preview.opacity], ['blue', 'l', .75])
    assert.equal(f.commits.length, 0)
    await f.pointer('up', 500, 400)
    if (tool === 'note') {
      assert.deepEqual([preview.props.font, preview.props.align, preview.props.verticalAlign], ['mono', 'end', 'start'])
      f.interaction.editText({ type: 'update', content: content('Toolbar note') })
      await f.interaction.editText({ type: 'finish' })
    } else if (tool === 'line') assert.equal(preview.props.spline, 'cubic')
    else assert.deepEqual([preview.props.font, preview.props.kind, preview.props.arrowheadEnd], ['mono', 'elbow', 'diamond'])
    assert.equal(f.commits.length, 1)
    assert.equal(f.shapes()[0].opacity, .75)
    await f.session.undo(); assert.equal(f.shapes().length, 0)
  } finally { f.close() }
})
