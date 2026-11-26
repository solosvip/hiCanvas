import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'
import { createCanvasInteraction } from '../engine/index.js'
import { getConnectionGeometry, createConnectionContext } from '../renderer/geometry.js'

const arrow = (props = {}) => ({ type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', x: 200, y: 450, props: { start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, ...props } })
const line = () => ({ type: 'create_shape', id: 'shape:line', shapeType: 'line', x: 200, y: 450, props: { points: { a1: { id: 'a1', index: 'a1', x: 0, y: 0 }, a2: { id: 'a2', index: 'a2', x: 400, y: 0 } } } })
const target = (changes = {}) => ({ type: 'create_shape', id: 'shape:target', shapeType: 'geo', x: 600, y: 200, props: { w: 150, h: 150, fill: 'semi' }, ...changes })
const bindings = f => Object.values(f.current().store).filter(r => r.typeName === 'binding')
const points = shape => Object.values(shape.props.points).sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : 0)
const geometry = (f, id = 'shape:arrow') => getConnectionGeometry(f.session.store.get(id), createConnectionContext(f.session.store.allRecords()))
const drag = async (f, from, to, modifiers = {}) => { f.pointer('down', ...from); f.pointer('move', ...to, modifiers); return f.pointer('up', ...to, modifiers) }
async function select(f, x = 350, y = 450) { await f.click(x, y); assert.equal(f.interaction.state.get().selectedIds.length, 1) }
async function transact(f, commands) { f.session.beginGesture(); f.session.preview(commands); return f.session.commitGesture() }

test('箭头和线条显式开放，默认产品工具不变；创建整次撤销', async () => {
  for (const type of ['arrow', 'line']) {
    const f = await creationFixture()
    try {
      const ordinary = createCanvasInteraction({ session: f.session })
      try { assert.throws(() => ordinary.setTool(type), /未向本产品开放/) } finally { ordinary.dispose() }
      f.interaction.setTool(type)
      f.pointer('down', 200, 450)
      f.pointer('move', 600, 500)
      assert.equal(f.commits.length, 0)
      await f.pointer('up', 600, 500)
      assert.equal(f.commits.length, 1)
      const shape = f.shapes()[0]
      assert.equal(shape.type, type)
      assert.deepEqual([shape.x, shape.y], [200, 450])
      assert.deepEqual(type === 'arrow' ? shape.props.end : points(shape).at(-1), type === 'arrow' ? { x: 400, y: 50 } : { id: points(shape).at(-1).id, index: points(shape).at(-1).index, x: 400, y: 50 })
      await f.session.undo(); assert.equal(f.shapes().length, 0)
      await f.session.redo(); assert.equal(f.shapes()[0].id, shape.id)
    } finally { f.close() }
  }
})

test('线条中柄加点与顶点移动各为一次事务，保留同一线条', async () => {
  const f = await creationFixture({ commands: [line()] })
  try {
    await select(f)
    const overlay = f.interaction.state.get().overlays.find(o => o.kind === 'connection')
    assert.equal(overlay.handles.filter(h => h.kind === 'create').length, 1)
    await drag(f, [400, 450], [400, 550])
    assert.equal(f.commits.length, 1)
    assert.deepEqual(points(f.shapes()[0]).map(p => [p.x, p.y]), [[0, 0], [200, 100], [400, 0]])
    await drag(f, [200, 450], [150, 400])
    assert.equal(f.commits.length, 2)
    assert.deepEqual(points(f.shapes()[0]).map(p => [p.x, p.y]), [[-50, -50], [200, 100], [400, 0]])
    await f.session.undo(); assert.equal(points(f.shapes()[0])[0].x, 0)
    await f.session.undo(); assert.equal(points(f.shapes()[0]).length, 2)
  } finally { f.close() }
})

test('弧线中柄的垂直位移直接修改bend，Esc取消不保存', async () => {
  const f = await creationFixture({ commands: [arrow()] })
  try {
    await select(f)
    await drag(f, [400, 450], [400, 550])
    assert.equal(f.shapes()[0].props.bend, 100)
    assert.equal(f.commits.length, 1)
    f.pointer('down', 400, 550); f.pointer('move', 400, 580)
    await f.key('Escape')
    assert.equal(f.shapes()[0].props.bend, 100)
    assert.equal(f.commits.length, 1)
    assert.equal(f.session.state.get().isGestureActive, false)
  } finally { f.close() }
})

test('折肘中柄使用现有路由的有效跨距并夹在0和1', async () => {
  const f = await creationFixture({ commands: [arrow({ kind: 'elbow', end: { x: 400, y: 150 } })] })
  try {
    await select(f, 400, 520)
    await drag(f, [400, 525], [450, 525])
    assert.ok(Math.abs(f.shapes()[0].props.elbowMidPoint - .6356852103120759) < 1e-9)
    let middle = f.interaction.state.get().overlays.find(o => o.kind === 'connection').handles.find(h => h.id === 'middle')
    await drag(f, [middle.x, middle.y], [900, middle.y])
    assert.equal(f.shapes()[0].props.elbowMidPoint, 1)
    middle = f.interaction.state.get().overlays.find(o => o.kind === 'connection').handles.find(h => h.id === 'middle')
    await drag(f, [middle.x, middle.y], [-100, middle.y])
    assert.equal(f.shapes()[0].props.elbowMidPoint, 0)
  } finally { f.close() }
})

test('箭头端点在轮廓内绑定、外1px解绑；Alt精确，Ctrl忽略目标', async () => {
  const f = await creationFixture({ commands: [target(), arrow()] })
  try {
    await select(f)
    await drag(f, [600, 450], [650, 230], { altKey: true })
    assert.equal(bindings(f).length, 1)
    assert.equal(bindings(f)[0].toId, 'shape:target')
    assert.deepEqual(bindings(f)[0].props.normalizedAnchor, { x: 1 / 3, y: .2 })
    assert.equal(bindings(f)[0].props.isExact, true)
    assert.equal(bindings(f)[0].props.isPrecise, true)
    await drag(f, [650, 230], [599, 250])
    assert.equal(bindings(f).length, 0)
    assert.deepEqual(f.shapes().find(s => s.id === 'shape:arrow').props.end, { x: 399, y: -200 })
    await drag(f, [599, 250], [650, 230], { ctrlKey: true })
    assert.equal(bindings(f).length, 0)
    await drag(f, [650, 230], [600, 250])
    assert.equal(bindings(f).length, 1)
  } finally { f.close() }
})

test('从对象开始创建的箭头两端绑定与形状在同一事务中保存', async () => {
  const f = await creationFixture({ commands: [target(), target({ id: 'shape:left', x: 100 })] })
  try {
    f.interaction.setTool('arrow')
    await drag(f, [150, 250], [650, 250])
    assert.equal(bindings(f).length, 2)
    assert.deepEqual(new Set(bindings(f).map(b => b.toId)), new Set(['shape:left', 'shape:target']))
    assert.equal(f.commits.length, 1)
    await f.session.undo()
    assert.equal(bindings(f).length, 0)
    assert.equal(f.shapes().filter(s => s.type === 'arrow').length, 0)
  } finally { f.close() }
})

test('绑定目标移动/删除/撤销时保留连接和当前可见端点', async () => {
  const f = await creationFixture({ commands: [target(), arrow()] })
  try {
    await select(f)
    await drag(f, [600, 450], [650, 230], { altKey: true })
    const before = geometry(f).path.at(1)
    await transact(f, [{ type: 'update', id: 'shape:target', changes: { x: 700, y: 225 } }])
    const moved = geometry(f).path.at(1)
    assert.ok(Math.hypot(moved.x - before.x, moved.y - before.y) > 50)
    assert.equal(bindings(f).length, 1)
    await transact(f, [{ type: 'delete', ids: ['shape:target'] }])
    assert.equal(bindings(f).length, 0)
    assert.deepEqual(geometry(f).path.at(1), moved)
    await f.session.undo()
    assert.ok(f.current().store['shape:target'])
    assert.equal(bindings(f).length, 1)
    assert.deepEqual(geometry(f).path.at(1), moved)
    await f.session.redo()
    assert.equal(f.current().store['shape:target'], undefined)
    assert.equal(bindings(f).length, 0)
    assert.deepEqual(geometry(f).path.at(1), moved)
    await f.session.undo()
    await f.session.undo()
    assert.deepEqual(geometry(f).path.at(1), before)
  } finally { f.close() }
})

test('两端端帽双击只切none/arrow，标签双击继续复用文字会话', async () => {
  const f = await creationFixture({ commands: [arrow()] })
  try {
    await select(f)
    await f.click(600, 450); await f.click(600, 450)
    assert.equal(f.shapes()[0].props.arrowheadEnd, 'none')
    assert.equal(f.interaction.state.get().textEditing, null)
    await f.click(200, 450); await f.click(200, 450)
    assert.equal(f.shapes()[0].props.arrowheadStart, 'arrow')
    await f.click(350, 450); await f.click(350, 450)
    assert.equal(f.interaction.state.get().textEditing.id, 'shape:arrow')
  } finally { f.close() }
})

test('线条保持工具时Shift连续加点，15度约束且原对象身份不变', async () => {
  const f = await creationFixture()
  try {
    await f.key('L'); f.interaction.setCreationOptions({ toolLocked: true })
    await drag(f, [250, 400], [550, 450], { shiftKey: true })
    const first = f.shapes()[0], end = points(first).at(-1)
    assert.ok(Math.abs(end.x - 293.7748711599246) < 1e-9)
    assert.ok(Math.abs(end.y - 78.71673948385883) < 1e-9)
    await f.click(800, 550, { shiftKey: true })
    const next = f.shapes()[0]
    assert.equal(next.id, first.id)
    assert.equal(f.shapes().length, 1)
    assert.equal(points(next).length, 3)
    assert.equal(f.commits.length, 2)
    await f.session.undo(); assert.equal(points(f.shapes()[0]).length, 2)
  } finally { f.close() }
})

test('控制点吸附为独立可选参数，只预览指示，不写画板会话记录', async () => {
  for (const enabled of [true, false]) {
    const f = await creationFixture({ controlPointSnapping: enabled, commands: [line()] })
    try {
      await select(f)
      await drag(f, [400, 450], [400, 550])
      f.pointer('down', 600, 450); f.pointer('move', 203, 453)
      const point = points(f.session.store.get('shape:line')).at(-1)
      assert.deepEqual([point.x, point.y], enabled ? [0, 0] : [3, 3])
      const indicators = f.interaction.state.get().overlays.filter(o => o.kind === 'snap')
      assert.equal(indicators.length > 0, enabled)
      await f.pointer('up', 203, 453)
      assert.ok(Object.values(f.current().store).every(r => ['shape', 'page', 'asset', 'binding', 'document'].includes(r.typeName)))
      assert.equal(f.interaction.state.get().overlays.some(o => o.kind === 'snap'), false)
    } finally { f.close() }
  }
})

test('控制柄并发冲突与输入区切换撤去预览，不覆盖远端记录', async () => {
  const f = await creationFixture({ commands: [arrow()] })
  try {
    await select(f)
    f.pointer('down', 400, 450); f.pointer('move', 400, 550)
    await f.remote([{ type: 'update', id: 'shape:arrow', changes: { props: { bend: -60 } } }])
    assert.throws(() => f.pointer('move', 400, 570), /更改|改变|冲突/)
    assert.equal(f.shapes()[0].props.bend, -60)
    assert.equal(f.commits.length, 0)
    f.pointer('down', 600, 450); f.pointer('move', 650, 400)
    f.interaction.setInputContext({ owner: 'form' })
    assert.equal(f.session.state.get().isGestureActive, false)
    assert.equal(f.interaction.state.get().mode, 'idle')
    assert.equal(f.shapes()[0].props.bend, -60)
  } finally { f.close() }
})
