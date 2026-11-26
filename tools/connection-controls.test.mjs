import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'
import { getConnectionGeometry, createConnectionContext, shapeToPagePoint } from '../renderer/geometry.js'

const arrow = (extra = {}) => ({ type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', x: 200, y: 450, props: { end: { x: 400, y: 0 } }, ...extra })
const target = (extra = {}) => ({ type: 'create_shape', id: 'shape:target', shapeType: 'geo', x: 600, y: 200, props: { w: 150, h: 150, fill: 'semi' }, ...extra })
const records = f => Object.values(f.current().store)
const bindings = f => records(f).filter(r => r.typeName === 'binding')
const points = shape => Object.values(shape.props.points).sort((a,b) => a.index < b.index ? -1 : 1)
const drag = async (f, from, to, mods) => { f.pointer('down', ...from); f.pointer('move', ...to, mods); return f.pointer('up', ...to, mods) }
const transact = async (f, commands) => { f.session.beginGesture(); f.session.preview(commands); return f.session.commitGesture() }

test('标签沿现有路径移动，保留抓取偏移、夹紧端点、撤销及文字会话', async () => {
  const f = await creationFixture({ commands: [arrow({ text: 'Arrow label' })] })
  try {
    await f.click(350, 450)
    await drag(f, [420, 450], [500, 450])
    assert.equal(f.shapes()[0].props.labelPosition, .7)
    assert.equal(f.shapes()[0].x, 200)
    assert.equal(f.commits.length, 1)
    const geometry = getConnectionGeometry(f.shapes()[0], createConnectionContext(records(f)))
    await drag(f, [geometry.label.center.x + 220, 450], [1000, 450])
    assert.equal(f.shapes()[0].props.labelPosition, 1)
    const end = getConnectionGeometry(f.shapes()[0], createConnectionContext(records(f)))
    assert.ok(end.label.center.x < end.path.at(1).x)
    await f.session.undo(); assert.equal(f.shapes()[0].props.labelPosition, .7)
    await f.click(500, 450); await f.click(500, 450)
    assert.equal(f.interaction.state.get().textEditing.id, 'shape:arrow')
    assert.equal(f.commits.length, 2)
  } finally { f.close() }
})

test('停留转精确绑定通过帧输入推进，目标缩放后按归一化锚点跟随', async () => {
  const f = await creationFixture({ commands: [target(), arrow()] })
  try {
    await f.click(350, 450)
    f.pointer('down', 600, 450); f.pointer('move', 650, 230)
    assert.equal(f.session.store.allRecords().find(r => r.typeName === 'binding').props.isPrecise, false)
    assert.equal(f.interaction.state.get().needsFrame, true)
    f.interaction.dispatch({ type: 'frame', time: 400 })
    const precise = f.session.store.allRecords().find(r => r.typeName === 'binding')
    assert.equal(precise.props.isPrecise, true)
    assert.equal(precise.props.isExact, false)
    await f.pointer('up', 650, 230, { time: 401 })
    await transact(f, [{ type: 'update', id: 'shape:target', changes: { props: { w: 300, h: 300 } } }])
    const geometry = getConnectionGeometry(f.current().store['shape:arrow'], createConnectionContext(records(f)))
    assert.deepEqual(geometry.terminals.end, { x: 500, y: -190 })
    await f.session.undo()
    assert.equal(f.current().store['shape:target'].props.w, 150)
    assert.equal(bindings(f).length, 1)
  } finally { f.close() }
})

test('连续点击替换种子，近末点仍追加，保持一条线和各次撤销', async () => {
  const f = await creationFixture()
  try {
    await f.key('L'); await f.click(250, 400)
    assert.equal(f.interaction.state.get().toolId, 'line')
    await f.click(550, 450, { shiftKey: true })
    const id = f.shapes()[0].id
    assert.equal(points(f.shapes()[0]).length, 2)
    assert.deepEqual([points(f.shapes()[0])[1].x, points(f.shapes()[0])[1].y], [300, 50])
    await f.click(800, 650, { shiftKey: true })
    assert.equal(points(f.shapes()[0]).length, 3)
    await f.click(803, 650, { shiftKey: true })
    assert.equal(points(f.shapes()[0]).length, 4)
    assert.equal(f.shapes()[0].id, id)
    assert.equal(f.commits.length, 4)
    await f.session.undo(); assert.equal(points(f.shapes()[0]).at(-1).x, 550)
    await f.session.undo(); assert.equal(points(f.shapes()[0]).length, 2)
  } finally { f.close() }
})

test('旋转父级里的端点使用形状本地坐标；创建保持页面轴向', async () => {
  const f = await creationFixture({ commands: [
    { type: 'create_shape', id: 'shape:frame', shapeType: 'frame', x: 500, y: 100, rotation: Math.PI / 2, props: { w: 600, h: 600 } },
    arrow({ parentId: 'shape:frame', x: 100, y: 100 }),
  ] })
  try {
    const snapshot = f.current(), body = shapeToPagePoint(snapshot, 'shape:arrow', { x: 150, y: 0 }), end = shapeToPagePoint(snapshot, 'shape:arrow', { x: 400, y: 0 })
    await f.click(body.x, body.y)
    await drag(f, [end.x, end.y], [end.x + 50, end.y + 20])
    assert.ok(Math.abs(f.current().store['shape:arrow'].props.end.x - 420) < 1e-9)
    assert.ok(Math.abs(f.current().store['shape:arrow'].props.end.y + 50) < 1e-9)
    f.interaction.setTool('arrow')
    await drag(f, [300, 300], [450, 350])
    const created = f.shapes().find(s => !['shape:frame','shape:arrow'].includes(s.id))
    assert.equal(created.parentId, 'shape:frame')
    const result = shapeToPagePoint(f.current(), created.id, created.props.end)
    assert.ok(Math.hypot(result.x - 450, result.y - 350) < 1e-9)
  } finally { f.close() }
})

test('绑定过滤锁定、隐藏、轮廓外及被父框裁切的目标', async () => {
  for (const command of [target({ isLocked: true }), target({ opacity: 0 }), target({ props: { geo: 'ellipse', w: 150, h: 150, fill: 'semi' } }), target({ parentId: 'shape:frame', x: 100, y: 100 })]) {
    const f = await creationFixture({ commands: [
      { type: 'create_shape', id: 'shape:frame', shapeType: 'frame', x: 900, y: 100, props: { w: 50, h: 50 } }, command,
      ...('isLocked' in command ? [{ type: 'update', id: command.id, changes: { isLocked: command.isLocked } }] : []),
      ...('opacity' in command ? [{ type: 'update', id: command.id, changes: { opacity: command.opacity } }] : []), arrow(),
    ] })
    try {
      await f.click(350, 450)
      const to = command.parentId ? [1010, 210] : [601, 201]
      await drag(f, [600, 450], to, { altKey: true })
      assert.equal(bindings(f).length, 0, JSON.stringify(command))
    } finally { f.close() }
  }
})

test('控制点可吸到其他几何轮廓，禁用和取消都不留下指示', async () => {
  const f = await creationFixture({ controlPointSnapping: true, commands: [arrow(), target()] })
  try {
    await f.click(350, 450)
    f.pointer('down', 600, 450); f.pointer('move', 597, 270)
    assert.deepEqual(f.session.store.get('shape:arrow').props.end, { x: 400, y: -180 })
    assert.equal(f.interaction.state.get().overlays.at(-1).kind, 'snap')
    await f.key('Escape')
    assert.equal(f.interaction.state.get().overlays.some(o => o.kind === 'snap'), false)
    assert.equal(bindings(f).length, 0)
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('开放箭头不把端点间的虚构弦当作可吸附轮廓', async () => {
  const f = await creationFixture({ controlPointSnapping: true, commands: [
    arrow({ x: 200, y: 200, props: { end: { x: 400, y: 0 }, bend: 100, arrowheadStart: 'none', arrowheadEnd: 'none' } }),
    { type: 'create_shape', id: 'shape:line', shapeType: 'line', x: 100, y: 500, props: { points: { a1: { id: 'a1', index: 'a1', x: 0, y: 0 }, a2: { id: 'a2', index: 'a2', x: 400, y: 0 } } } },
  ] })
  try {
    await f.click(350, 500)
    f.pointer('down', 500, 500); f.pointer('move', 400, 203)
    assert.deepEqual(points(f.session.store.get('shape:line')).at(-1), { id: 'a2', index: 'a2', x: 300, y: -297 })
    assert.equal(f.interaction.state.get().overlays.some(o => o.kind === 'snap'), false)
  } finally { f.close() }
})

test('工具栏拖出、取消、输入门禁和异步失败不污染画板', async () => {
  const f = await creationFixture({ beforeCommit: async () => { throw new Error('保存失败') } })
  try {
    f.interaction.beginToolDrag({ toolId: 'line' })
    f.pointer('down', 30, 20); f.pointer('move', 500, 400)
    await f.pointer('cancel', 500, 400)
    assert.equal(f.previewShapes().length, 0)
    f.interaction.setTool('select'); f.interaction.setInputContext({ owner: 'form' })
    await f.key('L'); assert.equal(f.interaction.state.get().toolId, 'select')
    assert.equal(f.session.state.get().isGestureActive, false)
    f.interaction.setInputContext({ owner: 'canvas' })
    f.interaction.setTool('arrow')
    await assert.rejects(() => drag(f, [200, 450], [600, 500]), /保存失败/)
    assert.equal(f.previewShapes().length, 0)
    assert.equal(f.interaction.state.get().mode, 'idle')
    assert.equal(f.interaction.state.get().selectedIds.length, 0)
  } finally { f.close() }
})

test('修改既有绑定锚点保留身份及无关元数据，撤销恢复原锚点', async () => {
  const f = await creationFixture({ commands: [target(), arrow()] })
  try {
    await f.click(350,450); await drag(f, [600,450], [650,230], { altKey: true })
    const original = bindings(f)[0]
    await transact(f, [{ type: 'update', id: original.id, changes: { meta: { owner: 'keep me' } } }])
    await drag(f, [650,230], [660,240], { altKey: true })
    assert.equal(bindings(f)[0].id, original.id)
    assert.deepEqual(bindings(f)[0].meta, { owner: 'keep me' })
    assert.deepEqual(bindings(f)[0].props.normalizedAnchor, { x: .4, y: 4 / 15 })
    await f.session.undo()
    assert.deepEqual(bindings(f)[0].props.normalizedAnchor, original.props.normalizedAnchor)
    assert.deepEqual(bindings(f)[0].meta, { owner: 'keep me' })
  } finally { f.close() }
})

test('绑定的文字及便签目标删除后保留真实可见端点，撤销恢复', async () => {
  for (const shapeType of ['text','note']) {
    const f = await creationFixture({ commands: [target({ shapeType: 'text', text: 'Measured target', props: { w: 150 } }), arrow()] })
    try {
      if (shapeType === 'note') {
        const original = f.current().store['shape:target']
        await transact(f, [{ type: 'put', record: { ...original, type: 'note', props: { color: 'black', richText: original.props.richText, size: 'm', font: 'draw', align: 'middle', verticalAlign: 'middle', labelColor: 'black', growY: 0, fontSizeAdjustment: 1, url: '', scale: 1, textFirstEditedBy: null } } }])
      }
      await f.click(350,450); await drag(f, [600,450], [650,210], { altKey: true })
      assert.equal(bindings(f).length, 1)
      const before = getConnectionGeometry(f.current().store['shape:arrow'], createConnectionContext(records(f))).path.at(1)
      await transact(f, [{ type: 'delete', ids: ['shape:target'] }])
      assert.equal(bindings(f).length, 0)
      assert.deepEqual(getConnectionGeometry(f.current().store['shape:arrow'], createConnectionContext(records(f))).path.at(1), before)
      await f.session.undo(); assert.equal(bindings(f).length, 1)
      assert.ok(f.current().store['shape:target'])
    } finally { f.close() }
  }
})

test('活动控制柄的绑定目标被远端移动时取消局部预览并保留远端', async () => {
  const f = await creationFixture({ commands: [target(), arrow()] })
  try {
    await f.click(350,450); await drag(f, [600,450], [650,230], { altKey: true })
    f.pointer('down', 650,230); f.pointer('move', 660,240, { altKey: true })
    await f.remote([{ type: 'update', id: 'shape:target', changes: { x: 700 } }])
    assert.throws(() => f.pointer('move', 670,250), /改变|冲突/)
    assert.equal(f.current().store['shape:target'].x, 700)
    assert.deepEqual(bindings(f)[0].props.normalizedAnchor, { x: 1 / 3, y: .2 })
    assert.equal(f.session.state.get().isGestureActive, false)
  } finally { f.close() }
})

test('绑定组的后代移动及成员增删都使旧控制柄几何失效', async () => {
  const initial = [
    { type: 'create_shape', id: 'shape:group', shapeType: 'group', x: 600, y: 200 },
    target({ parentId: 'shape:group', x: 0, y: 0 }), arrow(),
  ]
  for (const change of [
    { type: 'update', id: 'shape:target', changes: { x: 100 } },
    target({ id: 'shape:added', parentId: 'shape:group', x: 200, y: 0 }),
    { type: 'delete', ids: ['shape:target'] },
  ]) {
    const f = await creationFixture({ commands: initial })
    try {
      await f.click(350,450); await drag(f, [600,450], [650,230], { altKey: true })
      assert.equal(bindings(f)[0].toId, 'shape:group')
      const middle = f.interaction.state.get().overlays.find(o => o.kind === 'connection').handles.find(h => h.id === 'middle')
      f.pointer('down', middle.x, middle.y); f.pointer('move', middle.x, middle.y + 20)
      await f.remote([change])
      assert.throws(() => f.pointer('move', middle.x, middle.y + 30), /改变|冲突/)
      assert.equal(f.session.state.get().isGestureActive, false)
      assert.equal(f.commits.length, 1)
    } finally { f.close() }
  }
})

test('自身非邻接直线段可吸附；曲线加点保留既有样式', async () => {
  const stored = { a1: { id: 'a1', index: 'a1', x: 0, y: 0 }, a2: { id: 'a2', index: 'a2', x: 200, y: 0 }, a3: { id: 'a3', index: 'a3', x: 200, y: 200 }, a4: { id: 'a4', index: 'a4', x: 400, y: 200 } }
  const f = await creationFixture({ controlPointSnapping: true, commands: [{ type: 'create_shape', id: 'shape:line', shapeType: 'line', x: 200, y: 450, props: { points: stored } }] })
  try {
    await f.click(350,450)
    await drag(f, [600,650], [300,453])
    assert.deepEqual(points(f.shapes()[0]).at(-1), { id: 'a4', index: 'a4', x: 100, y: 0 })
    await transact(f, [{ type: 'update', id: 'shape:line', changes: { props: { spline: 'cubic' } } }])
    const handle = f.interaction.state.get().overlays.find(o => o.kind === 'connection').handles.find(h => h.kind === 'create')
    await drag(f, [handle.x, handle.y], [handle.x, handle.y - 50])
    assert.equal(f.shapes()[0].props.spline, 'cubic')
    assert.equal(points(f.shapes()[0]).length, 5)
  } finally { f.close() }
})

test('控制柄拖到边缘时沿统一视角规则滚屏，端点仍贴住指针', async () => {
  const f = await creationFixture({ edgeScrolling: true, commands: [arrow()] })
  try {
    await f.click(350,450)
    f.pointer('down', 600,450); f.pointer('move', 1275,500)
    f.interaction.dispatch({ type: 'frame', time: 20 })
    const state = f.interaction.state.get(), record = f.session.store.get('shape:arrow')
    assert.ok(state.camera.x < 0)
    assert.equal((record.x + record.props.end.x + state.camera.x) * state.camera.z, 1275)
    assert.equal(f.commits.length, 0)
    await f.pointer('up', 1275,500, { time: 21 })
    assert.equal(f.commits.length, 1)
    assert.equal(f.interaction.state.get().needsFrame, false)
  } finally { f.close() }
})

test('失去输入归属时取消停留绑定，不继续请求无用的帧', async () => {
  const f = await creationFixture({ commands: [target(), arrow()] })
  try {
    await f.click(350,450)
    f.pointer('down', 600,450); f.pointer('move', 650,230)
    assert.equal(f.interaction.state.get().needsFrame, true)
    f.interaction.setInputContext({ owner: 'form' })
    assert.equal(f.interaction.state.get().needsFrame, false)
    assert.equal(f.session.state.get().isGestureActive, false)
    assert.equal(bindings(f).length, 0)
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})


test('箭头单击取消种子且保持工具待画，拖动才保存', async () => {
  const f = await creationFixture()
  try {
    f.interaction.setTool('arrow')
    await f.click(250, 400)
    assert.equal(f.shapes().length, 0)
    assert.equal(f.commits.length, 0)
    assert.equal(f.interaction.state.get().toolId, 'arrow')
    await drag(f, [250, 400], [550, 450])
    assert.equal(f.shapes().length, 1)
    assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

test('旧版三点线样本：半径内顶点优先，否则吸非邻接线段', async () => {
  for (const [x, expected] of [[207, { x: 0, y: 0 }], [208, { x: 7.6, y: 3.8 }]]) {
    const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:line', shapeType: 'line', x: 200, y: 450, props: { points: { a1: { id: 'a1', index: 'a1', x: 0, y: 0 }, a2: { id: 'a2', index: 'a2', x: 400, y: 0 } } } }] })
    try {
      await f.click(350, 450)
      await drag(f, [400, 450], [400, 550])
      await drag(f, [600, 450], [x, 453], { ctrlKey: true })
      const actual = points(f.shapes()[0]).at(-1)
      assert.ok(Math.abs(actual.x - expected.x) < 1e-8 && Math.abs(actual.y - expected.y) < 1e-8, JSON.stringify(actual))
    } finally { f.close() }
  }
})
