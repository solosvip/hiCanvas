import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { toRichText } from '@tldraw/tlschema'
import { creationFixture } from './creation-test-fixture.mjs'

// Offscreen native legacy observation, 2026-11-26: editing Alpha Beta with
// three typing bursts and two 1.1s pauses is one undo after Escape saves it.
test('普通文字的连续输入只在退出时保存一次，整次撤销和重做', async () => {
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:text', shapeType: 'text', text: 'Alpha Beta' }] })
  try {
    f.interaction.editText({ type: 'begin', id: 'shape:text' })
    assert.equal(f.interaction.state.get().textEditing.id, 'shape:text')
    for (const text of ['one', 'onetwo', 'onetwothree']) f.interaction.editText({ type: 'update', content: toRichText(text) })
    assert.equal(f.commits.length, 0)
    assert.equal(f.session.store.get('shape:text').props.richText.content[0].content[0].text, 'onetwothree')
    await f.interaction.editText({ type: 'finish' })
    assert.equal(f.commits.length, 1)
    assert.equal(f.interaction.state.get().textEditing, null)
    await f.session.undo()
    assert.equal(f.current().store['shape:text'].props.richText.content[0].content[0].text, 'Alpha Beta')
    await f.session.redo()
    assert.equal(f.current().store['shape:text'].props.richText.content[0].content[0].text, 'onetwothree')
  } finally { f.close() }
})

test('自动大小动作可独立撤销，编辑期间切换宽度和输入仍是同一次事务', async () => {
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:text', shapeType: 'text', text: 'Alpha Beta', props: { w: 200, autoSize: false } }] })
  try {
    await f.interaction.editText({ type: 'auto-size', id: 'shape:text', enabled: true })
    assert.equal(f.current().store['shape:text'].props.autoSize, true)
    await f.session.undo()
    assert.equal(f.current().store['shape:text'].props.autoSize, false)
    f.interaction.editText({ type: 'begin', id: 'shape:text' })
    await f.interaction.editText({ type: 'auto-size', id: 'shape:text', enabled: true })
    f.interaction.editText({ type: 'update', content: toRichText('Edited') })
    await f.key('Escape')
    assert.equal(f.current().store['shape:text'].props.autoSize, true)
    await f.session.undo()
    assert.equal(f.current().store['shape:text'].props.autoSize, false)
    assert.equal(f.current().store['shape:text'].props.richText.content[0].content[0].text, 'Alpha Beta')
  } finally { f.close() }
})

test('字号字体及适用对齐经公开动作保存；编辑内改样式和文字合为一次撤销', async () => {
  for (const [shapeType, alignments] of [['text', { textAlign: 'end' }], ['geo', { align: 'start', verticalAlign: 'end' }], ['arrow', {}]]) {
    const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:target', shapeType, text: 'original' }] })
    try {
      const original = f.current().store['shape:target']
      for (const [size, font] of [['s', 'draw'], ['m', 'sans'], ['l', 'serif'], ['xl', 'mono']]) {
        await f.interaction.editText({ type: 'style', id: 'shape:target', changes: { size, font, ...alignments } })
        const props = f.current().store['shape:target'].props
        assert.deepEqual(Object.fromEntries(Object.keys({ size, font, ...alignments }).map(key => [key, props[key]])), { size, font, ...alignments })
      }
      assert.throws(() => f.interaction.editText({ type: 'style', id: 'shape:target', changes: { h: 500 } }))
      assert.throws(() => f.interaction.editText({ type: 'style', id: 'shape:target', changes: { font: 'unknown' } }))
      for (let i = 0; i < 4; i++) await f.session.undo()
      assert.deepEqual(f.current().store['shape:target'], original)
      f.interaction.editText({ type: 'begin', id: 'shape:target' })
      f.interaction.editText({ type: 'update', content: toRichText('new content') })
      await f.interaction.editText({ type: 'style', id: 'shape:target', changes: { font: 'mono', size: 'xl', ...alignments } })
      await f.interaction.editText({ type: 'finish' })
      await f.session.undo()
      assert.deepEqual(f.current().store['shape:target'], original)
    } finally { f.close() }
  }
})

test('样式API在活动文字中保持草稿光标，不另开手势，成功后采纳默认且整次只撤销一次', async () => {
  for (const shapeType of ['text', 'geo', 'note', 'arrow', 'frame']) {
    const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:target', shapeType, text: shapeType === 'frame' ? undefined : 'original', props: shapeType === 'frame' ? { name: 'original' } : {} }] })
    try {
      const original = f.current()
      f.interaction.editText({ type: 'begin', id: 'shape:target' })
      const content = text => shapeType === 'frame' ? text : toRichText(text)
      f.interaction.editText({ type: 'update', content: content('draft'), selection: { from: 2, to: 2 } })
      const before = f.interaction.state.get().textEditing
      const patch = shapeType === 'frame' ? { opacity: .25 } : { color: 'red', opacity: .25, font: 'mono', size: 'xl' }
      assert.equal((await f.interaction.setStyles(patch)).status, 'preview')
      const editing = f.interaction.state.get().textEditing
      assert.equal(editing.epoch, before.epoch)
      assert.deepEqual(editing.content, before.content)
      assert.deepEqual(editing.selection, before.selection)
      assert.equal(f.interaction.state.get().inputContext.owner, 'text-editing')
      assert.equal(f.commits.length, 0)
      assert.equal(f.interaction.getStyles().next.opacity, 1)
      f.interaction.editText({ type: 'update', content: content('continued'), selection: { from: 3, to: 3 } })
      await f.interaction.editText({ type: 'finish' })
      const saved = f.current()
      assert.equal(saved.store['shape:target'].opacity, .25)
      if (shapeType !== 'frame') {
        assert.equal(saved.store['shape:target'].props.color, 'red')
        assert.equal(saved.store['shape:target'].props.font, 'mono')
      }
      assert.equal(f.interaction.getStyles().next.opacity, .25)
      assert.equal(f.commits.length, 1)
      await f.session.undo()
      assert.deepEqual(f.current(), original)
      assert.equal(f.interaction.getStyles().next.opacity, .25)
      await f.session.redo()
      assert.deepEqual(f.current(), saved)
    } finally { f.close() }
  }
})

test('取消文字与样式一起还原，不采纳默认；失败保留草稿直到成功保存', async () => {
  let fail = true
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:text', shapeType: 'text', text: 'original' }], beforeCommit: async () => { if (fail) throw new Error('synthetic style edit failure') } })
  try {
    const original = f.current()
    f.interaction.editText({ type: 'begin', id: 'shape:text' })
    f.interaction.editText({ type: 'update', content: toRichText('discarded') })
    await f.interaction.setStyles({ color: 'red', font: 'mono' })
    f.interaction.editText({ type: 'cancel' })
    assert.deepEqual(f.current(), original)
    assert.equal(f.session.store.get('shape:text').props.color, 'black')
    assert.equal(f.interaction.getStyles().next.color, 'black')
    assert.equal(f.commits.length, 0)
    f.interaction.editText({ type: 'begin', id: 'shape:text' })
    f.interaction.editText({ type: 'update', content: toRichText('kept') })
    await f.interaction.setStyles({ color: 'red', font: 'mono' })
    await assert.rejects(f.interaction.editText({ type: 'finish' }), /synthetic style edit failure/)
    assert.equal(f.interaction.getStyles().next.color, 'black')
    assert.equal(f.interaction.state.get().textEditing.content.content[0].content[0].text, 'kept')
    fail = false
    await f.interaction.editText({ type: 'finish' })
    assert.equal(f.current().store['shape:text'].props.color, 'red')
    assert.equal(f.current().store['shape:text'].props.font, 'mono')
    assert.equal(f.interaction.getStyles().next.color, 'red')
    await f.session.undo()
    assert.deepEqual(f.current(), original)
  } finally { f.close() }
})

test('按ID设置未选中文字的样式失败时，恢复原选择而非替换成动作目标', async () => {
  const f = await creationFixture({ commands: [
    { type: 'create_shape', id: 'shape:selected', shapeType: 'geo', x: 100, y: 100, props: { fill: 'solid' } },
    { type: 'create_shape', id: 'shape:target', shapeType: 'text', text: 'Target', x: 600 },
  ], beforeCommit: async () => { throw new Error('synthetic targeted style failure') } })
  try {
    await f.click(150, 150)
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:selected'])
    await assert.rejects(f.interaction.editText({ type: 'style', id: 'shape:target', changes: { font: 'mono' } }), /synthetic targeted style failure/)
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:selected'])
    assert.equal(f.current().store['shape:target'].props.font, 'sans')
    assert.equal(f.interaction.getStyles().next.font, 'draw')
  } finally { f.close() }
})

test('远端只改位置时重放文字与样式；改同一个样式字段则保留草稿并停止自动覆盖', async () => {
  for (const kind of ['position', 'style']) {
    const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:text', shapeType: 'text', text: 'original' }] })
    try {
      f.interaction.editText({ type: 'begin', id: 'shape:text' })
      f.interaction.editText({ type: 'update', content: toRichText('local draft'), selection: { from: 3, to: 3 } })
      await f.interaction.setStyles({ color: 'red', font: 'mono' })
      await f.remote([{ type: 'update', id: 'shape:text', changes: kind === 'position' ? { x: 300 } : { props: { color: 'blue' } } }])
      if (kind === 'position') {
        await f.interaction.editText({ type: 'finish' })
        assert.equal(f.current().store['shape:text'].x, 300)
        assert.equal(f.current().store['shape:text'].props.color, 'red')
        assert.equal(f.current().store['shape:text'].props.font, 'mono')
        assert.equal(f.current().store['shape:text'].props.richText.content[0].content[0].text, 'local draft')
        assert.equal(f.commits[0].expectedRevision, '1')
      } else {
        assert.equal(f.interaction.state.get().textEditing.conflict?.type, 'style')
        assert.equal((await f.interaction.setStyles({ color: 'green' })).reason, 'conflict')
        assert.equal(await f.interaction.editText({ type: 'finish' }), false)
        assert.equal(f.current().store['shape:text'].props.color, 'blue')
        assert.equal(f.interaction.state.get().textEditing.content.content[0].content[0].text, 'local draft')
        assert.deepEqual(f.interaction.state.get().textEditing.selection, { from: 3, to: 3 })
        assert.equal(f.interaction.getStyles().next.color, 'black')
        assert.equal(f.commits.length, 0)
      }
    } finally { f.close() }
  }
})

test('活动文字已预览样式后远端锁住自身或祖先，保留草稿而不重放到锁定目标', async () => {
  for (const locked of ['shape:text', 'shape:parent']) {
    const f = await creationFixture({ commands: [
      { type: 'create_shape', id: 'shape:parent', shapeType: 'frame' },
      { type: 'create_shape', id: 'shape:text', shapeType: 'text', parentId: 'shape:parent', text: 'original' },
    ] })
    try {
      f.interaction.editText({ type: 'begin', id: 'shape:text' })
      f.interaction.editText({ type: 'update', content: toRichText('local draft') })
      await f.interaction.setStyles({ color: 'red' })
      await f.remote([{ type: 'update', id: locked, changes: { isLocked: true } }])
      assert.equal(await f.interaction.editText({ type: 'finish' }), false)
      assert.equal(f.current().store['shape:text'].props.color, 'black')
      assert.equal(f.current().store[locked].isLocked, true)
      assert.equal(f.interaction.state.get().textEditing.content.content[0].content[0].text, 'local draft')
      assert.equal(f.interaction.getStyles().next.color, 'black')
      assert.equal(f.commits.length, 0)
    } finally { f.close() }
  }
})

test('活动编辑可把自己的透明度预览设0再恢复，不因此结束输入事务', async () => {
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:text', shapeType: 'text', text: 'original' }] })
  try {
    f.interaction.editText({ type: 'begin', id: 'shape:text' })
    await f.interaction.setStyles({ opacity: 0 })
    assert.equal(f.session.store.get('shape:text').opacity, 0)
    await f.interaction.setStyles({ opacity: .5 })
    assert.equal(f.session.store.get('shape:text').opacity, .5)
    f.interaction.editText({ type: 'update', content: toRichText('continued') })
    await f.interaction.editText({ type: 'finish' })
    assert.equal(f.commits.length, 1)
    assert.equal(f.current().store['shape:text'].opacity, .5)
  } finally { f.close() }
})

test('拒绝无效标题后仍能保存原草稿，保存中关闭不会访问已销毁的文字会话', async () => {
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:frame', shapeType: 'frame', props: { name: 'original' } }] })
  try {
    f.interaction.editText({ type: 'begin', id: 'shape:frame' })
    f.interaction.editText({ type: 'update', content: 'valid draft' })
    assert.throws(() => f.interaction.editText({ type: 'update', content: 42 }))
    assert.equal(f.interaction.state.get().textEditing.content, 'valid draft')
    await f.interaction.editText({ type: 'finish' })
    assert.equal(f.current().store['shape:frame'].props.name, 'valid draft')
  } finally { f.close() }
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const waiting = new Promise(resolve => { release = resolve })
  const g = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:text', shapeType: 'text', text: 'original' }], beforeCommit: async () => { entered(); await waiting } })
  g.interaction.editText({ type: 'begin', id: 'shape:text' })
  g.interaction.editText({ type: 'update', content: toRichText('draft') })
  const finish = g.interaction.editText({ type: 'finish' })
  await started
  g.close(); release()
  await assert.rejects(finish, error => error.code === 'disposed')
})

test('画框标题点中由宿主测量注入，缩放后仍可双击进入单行name编辑', async () => {
  const f = await creationFixture({ camera: { x: 0, y: 0, z: 2 }, measureFrameTitle: text => text === 'Board' ? 80 : 100, commands: [{ type: 'create_shape', id: 'shape:frame', shapeType: 'frame', x: 200, y: 200, props: { w: 300, h: 200, name: 'Board' } }] })
  try {
    await f.click(430, 382); await f.click(430, 382)
    assert.equal(f.interaction.state.get().textEditing.id, 'shape:frame')
    assert.equal(f.interaction.state.get().textEditing.kind, 'frame')
    f.interaction.editText({ type: 'update', content: 'Changed' })
    await f.key('Escape')
    assert.equal(f.current().store['shape:frame'].props.name, 'Changed')
    assert.equal(f.current().store['shape:frame'].props.richText, undefined)
  } finally { f.close() }
})

test('被父画框裁掉的标题不抢走空白双击的文字创建', async () => {
  const f = await creationFixture({ camera: { x: 0, y: 100, z: 1 }, measureFrameTitle: () => 80, commands: [
    { type: 'create_shape', id: 'shape:parent', shapeType: 'frame', props: { w: 500, h: 500 } },
    { type: 'create_shape', id: 'shape:child', shapeType: 'frame', parentId: 'shape:parent', x: 100, y: 10, props: { w: 200, h: 200, name: 'Clipped' } },
  ] })
  try {
    await f.click(110, 90); await f.click(110, 90)
    const editing = f.interaction.state.get().textEditing
    assert.equal(editing.kind, 'text')
    assert.notEqual(editing.id, 'shape:child')
    assert.equal(f.session.store.get(editing.id).parentId, f.session.store.get('shape:parent').parentId)
  } finally { f.close() }
})

test('盖在画框标题上面的可见形状优先获得双击编辑', async () => {
  const f = await creationFixture({ measureFrameTitle: () => 80, commands: [
    { type: 'create_shape', id: 'shape:frame', shapeType: 'frame', x: 200, y: 200, props: { w: 300, h: 200, name: 'Covered' } },
    { type: 'create_shape', id: 'shape:cover', shapeType: 'geo', x: 200, y: 160, props: { w: 100, h: 50, fill: 'solid' } },
  ] })
  try {
    await f.click(220, 180); await f.click(220, 180)
    assert.equal(f.interaction.state.get().textEditing.id, 'shape:cover')
  } finally { f.close() }
})

test('选择工具双击与Enter进入编辑；组字不完成，Esc和ModEnter保存，外部点击接续选择', async () => {
  const f = await creationFixture({ commands: [
    { type: 'create_shape', id: 'shape:geo', shapeType: 'geo', x: 200, y: 200, props: { w: 250, h: 250 } },
    { type: 'create_shape', id: 'shape:other', shapeType: 'geo', x: 700, y: 200, props: { fill: 'solid' } },
  ] })
  try {
    await f.click(300, 300); await f.click(300, 300)
    assert.equal(f.interaction.state.get().textEditing.id, 'shape:geo')
    assert.equal(f.interaction.state.get().inputContext.owner, 'text-editing')
    f.interaction.editText({ type: 'update', content: toRichText('汉字') })
    f.key('Enter', { metaKey: true, isComposing: true })
    f.key('Escape', { keyCode: 229 })
    assert.equal(f.commits.length, 0)
    await f.key('Enter', { metaKey: true })
    assert.equal(f.commits.length, 1)
    assert.equal(f.interaction.state.get().textEditing, null)
    await f.key('Enter')
    assert.equal(f.interaction.state.get().textEditing.id, 'shape:geo')
    f.interaction.editText({ type: 'update', content: toRichText('outside saves') })
    const down = f.pointer('down', 750, 250)
    const up = f.pointer('up', 750, 250)
    await Promise.all([down, up])
    assert.equal(f.commits.length, 2)
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:other'])
    assert.equal(f.interaction.state.get().textEditing, null)
  } finally { f.close() }
})

test('空白双击直接写字；Alt双击只互换矩形与勾号框，保留对象和其他属性', async () => {
  const f = await creationFixture()
  try {
    await f.click(450, 350); await f.click(450, 350)
    const id = f.interaction.state.get().textEditing.id
    assert.deepEqual([f.session.store.get(id).x, f.session.store.get(id).y], [450, 350])
    assert.equal(f.session.store.get(id).props.font, 'draw')
    f.interaction.editText({ type: 'update', content: toRichText('new text') })
    await f.key('Escape')
    assert.equal(f.shapes().length, 1)
    assert.equal(f.commits.length, 1)
    await f.session.undo()
    assert.equal(f.shapes().length, 0)
    await f.session.redo()
    const saved = f.current().store[id]
    assert.equal(saved.props.richText.content[0].content[0].text, 'new text')
  } finally { f.close() }
  const g = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:box', shapeType: 'geo', x: 200, y: 200, props: { w: 250, h: 250, color: 'red' } }] })
  try {
    const original = g.current().store['shape:box']
    await g.click(300, 300, { altKey: true }); await g.click(300, 300, { altKey: true })
    assert.equal(g.interaction.state.get().textEditing, null)
    assert.deepEqual(g.current().store['shape:box'], { ...original, props: { ...original.props, geo: 'check-box' } })
    await g.session.undo()
    assert.deepEqual(g.current().store['shape:box'], original)
  } finally { g.close() }
})

test('文字工具点击自动宽、长拖固定700宽；松手接续编辑，空新文字退出不留历史', async () => {
  for (const width of [null, 700]) {
    const f = await creationFixture()
    try {
      f.interaction.setTool('text')
      f.pointer('down', 200, 300)
      if (width) f.pointer('move', 900, 300)
      await f.pointer('up', width ? 900 : 200, 300)
      const editing = f.interaction.state.get().textEditing
      assert.equal(editing.kind, 'text')
      const shape = f.session.store.get(editing.id)
      assert.equal(shape.props.font, 'draw')
      assert.equal(shape.props.autoSize, !width)
      if (width) assert.equal(shape.props.w, 700)
      assert.equal(f.commits.length, 0)
      await f.interaction.editText({ type: 'finish' })
      assert.equal(f.commits.length, 0)
      assert.equal(f.shapes().length, 0)
      await assert.rejects(f.session.undo(), /没有可撤销/)
      assert.equal(f.shapes().length, 0)
    } finally { f.close() }
  }
})

test('四种编辑目标保存各自字段；清空普通文字删除对象，清空标签和标题保留形状', async () => {
  for (const shapeType of ['text', 'geo', 'arrow', 'frame']) {
    const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:target', shapeType, text: shapeType === 'frame' ? undefined : 'original', props: shapeType === 'frame' ? { name: 'original' } : {} }] })
    try {
      f.interaction.editText({ type: 'begin', id: 'shape:target' })
      f.interaction.editText({ type: 'update', content: shapeType === 'frame' ? 'new title' : toRichText('new label') })
      await f.interaction.editText({ type: 'finish' })
      const saved = f.current().store['shape:target']
      if (shapeType === 'frame') { assert.equal(saved.props.name, 'new title'); assert.equal(saved.props.richText, undefined) }
      else assert.equal(saved.props.richText.content[0].content[0].text, 'new label')
      f.interaction.editText({ type: 'begin', id: 'shape:target' })
      f.interaction.editText({ type: 'update', content: shapeType === 'frame' ? '' : toRichText('') })
      await f.interaction.editText({ type: 'finish' })
      assert.equal(Boolean(f.current().store['shape:target']), shapeType !== 'text')
      await f.session.undo()
      assert.deepEqual(f.current().store['shape:target'], saved)
    } finally { f.close() }
  }
})

test('提交竞争只补一次带最新版本的文字合并，持续冲突不无限重试也不丢草稿', async () => {
  let f, calls = 0
  f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:text', shapeType: 'text', text: 'original' }], beforeCommit: async () => {
    calls++
    await f.remote([{ type: 'update', id: 'shape:text', changes: { x: calls * 10 } }], false)
  } })
  try {
    f.interaction.editText({ type: 'begin', id: 'shape:text' })
    f.interaction.editText({ type: 'update', content: toRichText('retained draft') })
    await assert.rejects(f.interaction.editText({ type: 'finish' }), error => error.code === 'conflict')
    assert.equal(calls, 2)
    assert.deepEqual(f.commits.map(c => c.expectedRevision), ['0', '1'])
    assert.equal(f.interaction.state.get().textEditing.content.content[0].content[0].text, 'retained draft')
    assert.equal(f.current().store['shape:text'].x, 20)
  } finally { f.close() }
})

test('远端只改位置时保留草稿，以最新版本叠文字，远端改字或删除时停止提交', async () => {
  for (const kind of ['position', 'content', 'deleted']) {
    const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:text', shapeType: 'text', text: 'Alpha Beta' }] })
    try {
      f.interaction.editText({ type: 'begin', id: 'shape:text' })
      f.interaction.editText({ type: 'update', content: toRichText('local draft') })
      await f.remote([kind === 'deleted' ? { type: 'delete', ids: ['shape:text'] } : { type: 'update', id: 'shape:text', changes: kind === 'position' ? { x: 300 } : { props: { richText: toRichText('remote words') } } }])
      assert.equal(f.interaction.state.get().textEditing.content.content[0].content[0].text, 'local draft')
      if (kind === 'position') {
        await f.interaction.editText({ type: 'finish' })
        assert.equal(f.current().store['shape:text'].x, 300)
        assert.equal(f.current().store['shape:text'].props.richText.content[0].content[0].text, 'local draft')
        assert.equal(f.commits.length, 1)
        assert.equal(f.commits[0].expectedRevision, '1')
      } else {
        assert.equal(f.interaction.state.get().textEditing.conflict.type, kind)
        await f.interaction.editText({ type: 'finish' })
        assert.equal(f.commits.length, 0)
        assert.equal(f.interaction.state.get().textEditing.content.content[0].content[0].text, 'local draft')
        if (kind === 'content') assert.equal(f.current().store['shape:text'].props.richText.content[0].content[0].text, 'remote words')
        else assert.equal(f.current().store['shape:text'], undefined)
      }
    } finally { f.close() }
  }
})

test('尚未输入就收到远端改字也保留打开时的草稿，不覆盖新原文', async () => {
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:text', shapeType: 'text', text: 'original' }] })
  try {
    f.interaction.editText({ type: 'begin', id: 'shape:text' })
    await f.remote([{ type: 'update', id: 'shape:text', changes: { props: { richText: toRichText('remote changed first') } } }])
    assert.equal(f.interaction.state.get().textEditing.conflict?.type, 'content')
    f.interaction.editText({ type: 'update', content: toRichText('local later') })
    assert.equal(await f.interaction.editText({ type: 'finish' }), false)
    assert.equal(f.commits.length, 0)
    assert.equal(f.current().store['shape:text'].props.richText.content[0].content[0].text, 'remote changed first')
    assert.equal(f.interaction.state.get().textEditing.content.content[0].content[0].text, 'local later')
  } finally { f.close() }
})

test('文字公开入口遵守祖先锁定及不可见限制，不创建隐藏编辑事务', async () => {
  for (const changes of [{ isLocked: true }, { opacity: 0 }]) {
    const f = await creationFixture({ commands: [
      { type: 'create_shape', id: 'shape:parent', shapeType: 'frame' },
      { type: 'create_shape', id: 'shape:text', shapeType: 'text', parentId: 'shape:parent', text: 'protected' },
      { type: 'update', id: 'shape:parent', changes },
    ] })
    try {
      assert.equal(f.interaction.editText({ type: 'begin', id: 'shape:text' }), false)
      assert.equal(f.interaction.state.get().textEditing, null)
      assert.equal(f.session.state.get().isGestureActive, false)
      assert.equal(f.commits.length, 0)
    } finally { f.close() }
  }
})

test('保存期间发布只读状态，失败后恢复草稿和编辑能力；公开嵌套描述不可变', async () => {
  let entered, release, fail = true
  const started = new Promise(resolve => { entered = resolve })
  const wait = new Promise(resolve => { release = resolve })
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:text', shapeType: 'text', text: 'original' }], beforeCommit: async () => { entered(); await wait; if (fail) throw new Error('synthetic failed save') } })
  try {
    f.interaction.editText({ type: 'begin', id: 'shape:text' })
    f.interaction.editText({ type: 'update', content: toRichText('draft'), selection: { from: 2, to: 2 } })
    const description = f.interaction.state.get().textEditing
    assert.throws(() => { description.selection.from = 100 }, TypeError)
    assert.throws(() => { description.content.content[0].content[0].text = 'mutated' }, TypeError)
    const saving = f.interaction.editText({ type: 'finish' })
    await started
    assert.equal(f.interaction.state.get().textEditing.isSaving, true)
    release()
    await assert.rejects(saving, /synthetic failed save/)
    assert.equal(f.interaction.state.get().textEditing.isSaving, false)
    assert.equal(f.interaction.state.get().textEditing.content.content[0].content[0].text, 'draft')
    fail = false
    f.interaction.editText({ type: 'update', content: toRichText('continued') })
    await f.interaction.editText({ type: 'finish' })
    assert.equal(f.current().store['shape:text'].props.richText.content[0].content[0].text, 'continued')
  } finally { release(); f.close() }
})
