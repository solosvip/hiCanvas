import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawFixture, points } from './draw-fixture.mjs'
import { getStrokeGeometry, hitTestCanvas } from '../renderer/geometry.js'

const frame = (id = 'frame', extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'frame', x: 100, y: 100, props: { w: 200, h: 200 }, ...extra })

test('默认工具表只开放选择和手形，D/B/X/Shift+D均不切换工具', async () => {
  const f = await drawFixture([], { toolIds: undefined })
  try {
    for (const [key, extra] of [['d', {}], ['b', {}], ['x', {}], ['D', { shiftKey: true }]]) {
      assert.equal(f.key(key, extra), false); assert.equal(f.state().toolId, 'select')
    }
    assert.throws(() => f.interaction.setTool('draw'), /工具未向本产品开放/)
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

for (const owner of ['form', 'menu', 'text-editing']) test(`${owner}、IME和快捷键关闭时不切画笔，重启后D/B/X/Shift+D经公共输入入口选择工具`, async () => {
  const f = await drawFixture()
  try {
    f.interaction.setInputContext({ owner })
    for (const name of ['d', 'b', 'x']) { assert.equal(f.key(name), false); assert.equal(f.state().toolId, 'select') }
    f.interaction.setInputContext({ owner: 'canvas', isComposing: true }); f.key('d'); assert.equal(f.state().toolId, 'select')
    f.interaction.setInputContext({ owner: 'canvas' }); f.key('d', { isComposing: true }); f.key('d', { keyCode: 229 })
    f.interaction.setShortcutsEnabled(false); f.key('d'); assert.equal(f.state().toolId, 'select')
    f.interaction.setShortcutsEnabled(true)
    for (const name of ['d', 'b', 'x']) { f.key(name); assert.equal(f.state().toolId, 'draw'); f.key('v') }
    f.key('D', { shiftKey: true }); assert.equal(f.state().toolId, 'highlight')
    assert.deepEqual(f.saved(), f.initial); assert.equal(f.depth(), 0)
  } finally { f.close() }
})

test('产品不开放画笔时快捷键无效；快捷键关闭仍可用 Esc 丢弃笔画', async () => {
  const limited = await drawFixture([], { toolIds: ['select', 'hand'] })
  try { assert.equal(limited.key('d'), false); assert.equal(limited.state().toolId, 'select') } finally { limited.close() }
  const f = await drawFixture()
  try {
    f.key('d'); f.interaction.setShortcutsEnabled(false)
    f.pointer('down', 20, 20); f.pointer('move', 50, 50); f.key('Escape'); await f.pointer('up', 50, 50)
    assert.equal(f.shapes().length, 0); assert.equal(f.depth(), 0)
  } finally { f.close() }
})

test('起笔画框决定归属，框外部分裁剪；旋转父坐标正确，框外起笔不自动换父', async () => {
  const f = await drawFixture([frame(), frame('rotated', { x: 600, y: 100, rotation: Math.PI / 2 })])
  try {
    f.key('d'); f.pointer('down', 150, 150); f.pointer('move', 250, 150); await f.pointer('up', 350, 150)
    const inside = f.shapes()[0]
    assert.equal(inside.parentId, 'shape:frame'); assert.equal(inside.x, 50); assert.equal(inside.y, 50)
    assert.equal(hitTestCanvas(f.saved(), { x: 250, y: 150 }, f.state().camera), inside.id)
    assert.notEqual(hitTestCanvas(f.saved(), { x: 350, y: 150 }, f.state().camera), inside.id)
    f.pointer('down', 50, 200); await f.pointer('up', 150, 200)
    assert.equal(f.shapes()[1].parentId, 'page:page')
    f.pointer('down', 550, 150); await f.pointer('up', 550, 200)
    const rotated = f.shapes()[2], last = points(rotated)[0].points.at(-1)
    assert.equal(rotated.parentId, 'shape:rotated'); assert.ok(Math.abs(rotated.x - 50) < 1e-6)
    assert.ok(Math.abs(rotated.y - 50) < 1e-6); assert.ok(Math.abs(last.x - 50) < 1e-4); assert.ok(Math.abs(last.y) < 1e-4)
  } finally { f.close() }
})

for (const zoom of [.5, 1, 2]) test(`z=${zoom} 采样按画布单位存储、线宽随相机比例，闭合阈值匹配观察边界`, async () => {
  const f = await drawFixture([], { camera: { x: 0, y: 0, z: zoom } })
  try {
    f.key('d'); f.pointer('down', 100, 100); await f.pointer('up', 300, 100)
    const shape = f.shapes()[0], end = points(shape)[0].points.at(-1)
    assert.ok(Math.abs(end.x - 200 / zoom) < .001); assert.equal(shape.props.scale, 1)
    assert.equal(shape.props.scaleX, 1); assert.equal(shape.props.scaleY, 1)
    const width = getStrokeGeometry(shape).bounds.h
    f.interaction.setCamera({ x: 0, y: 0, z: zoom * 2 }); assert.equal(getStrokeGeometry(f.shapes()[0]).bounds.h, width)
    f.interaction.setCamera({ x: 0, y: 0, z: zoom })
    const close = zoom === 2 ? 15 : 5, far = zoom === 2 ? 20 : 10
    f.pointer('down', 400, 100)
    for (const [x, y] of [[600, 100], [600, 300], [400, 300], [400 + far, 100]]) f.pointer('move', x, y)
    assert.equal(f.shapes()[1].props.isClosed, false)
    f.pointer('move', 400 + close, 100); assert.equal(f.shapes()[1].props.isClosed, true)
    f.key('Escape')
  } finally { f.close() }
})

test('A10 荧光笔两档压力沿用等宽几何；同一笔画保持一条路径、不同笔画独立叠色', async () => {
  const f = await drawFixture()
  try {
    f.key('D', { shiftKey: true })
    for (const [y, pressure] of [[100, .1], [106, 1]]) {
      f.pointer('down', 100, y, { pointerType: 'pen', pressure })
      f.pointer('move', 200, y, { pointerType: 'pen', pressure }); f.pointer('move', 100, y, { pointerType: 'pen', pressure })
      await f.pointer('up', 200, y, { pointerType: 'pen', pressure: 0 })
    }
    const [a, b] = f.shapes()
    assert.equal(a.props.segments.length, 1); assert.equal(b.props.segments.length, 1)
    assert.ok(Math.abs(getStrokeGeometry(a).bounds.h - 26.88) < .001)
    assert.ok(Math.abs(getStrokeGeometry(a).bounds.h - getStrokeGeometry(b).bounds.h) < .001)
    assert.equal(f.commits.length, 2); assert.equal(a.props.color, 'yellow')
  } finally { f.close() }
})

test('不相关远端刷新保留笔画，父框改变则冲突回滚，不覆盖远端', async () => {
  const f = await drawFixture([frame()])
  try {
    f.key('d'); f.pointer('down', 150, 150); f.pointer('move', 180, 180)
    await f.remote([frame('elsewhere', { x: 600 })]); f.pointer('move', 190, 190)
    assert.equal(f.shapes().length, 1)
    await f.remote([{ type: 'update', id: 'shape:frame', changes: { rotation: .4 } }])
    assert.throws(() => f.pointer('move', 200, 200), error => error.code === 'conflict')
    assert.equal(f.shapes().length, 0); assert.equal(f.session.store.get('shape:frame').rotation, .4)
    assert.equal(f.commits.length, 0); assert.equal(f.state().mode, 'idle')
  } finally { f.close() }
})

test('移动帧不取全板快照；外来指针、非主键和忙碌输入不形成多余提交', async () => {
  const f = await drawFixture()
  let resume, pending
  try {
    f.key('d'); f.pointer('down', 100, 100, { button: 2 }); assert.equal(f.shapes().length, 0)
    f.pointer('down', 100, 100)
    const snapshot = f.session.store.getStoreSnapshot
    f.session.store.getStoreSnapshot = () => { throw new Error('移动帧不得取全板快照') }
    f.pointer('move', 200, 200); f.pointer('move', 300, 300, { pointerId: 2 }); f.pointer('cancel', 300, 300, { pointerId: 2 })
    assert.equal(points(f.shapes()[0])[0].points.length, 2)
    f.session.store.getStoreSnapshot = snapshot
    resume = f.hold(); pending = f.pointer('up', 200, 200)
    f.pointer('down', 300, 300); await f.pointer('up', 400, 400); f.key('Escape')
    resume(); await pending; assert.equal(f.commits.length, 1); assert.equal(f.shapes().length, 1)
  } finally { resume?.(); await pending?.catch(() => {}); f.close() }
})

test('追加直线取消只撤掉当前手势；提交期间失焦不恢复已经清掉的接线状态', async () => {
  const f = await drawFixture()
  let resume, pending
  try {
    f.key('d'); f.pointer('down', 100, 100, { shiftKey: true }); await f.pointer('up', 200, 100, { shiftKey: true })
    const saved = structuredClone(f.saved())
    f.pointer('down', 300, 200, { shiftKey: true }); f.key('Escape'); await f.pointer('up', 300, 200, { shiftKey: true })
    assert.deepEqual(f.saved(), saved); assert.deepEqual(f.session.store.getStoreSnapshot(), saved); assert.equal(f.depth(), 1)
    f.pointer('down', 300, 300, { shiftKey: true }); resume = f.hold(); pending = f.pointer('up', 400, 300, { shiftKey: true })
    f.interaction.setInputContext({ owner: 'form' }); f.interaction.setInputContext({ owner: 'canvas' })
    resume(); await pending
    f.pointer('down', 500, 300, { shiftKey: true }); await f.pointer('up', 600, 300, { shiftKey: true })
    assert.equal(f.shapes().length, 3)
  } finally { resume?.(); await pending?.catch(() => {}); f.close() }
})

test('当前组内新笔画扩张组边界时跟随本地坐标整理，不把自己的组变化误报远端冲突', async () => {
  const f = await drawFixture([
    { type: 'create_shape', id: 'shape:a', shapeType: 'geo', x: 100, y: 100, props: { w: 80, h: 80, fill: 'solid' } },
    { type: 'create_shape', id: 'shape:b', shapeType: 'geo', x: 300, y: 100, props: { w: 80, h: 80, fill: 'solid' } },
    { type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' },
  ])
  try {
    f.pointer('down', 120, 120); await f.pointer('up', 120, 120); f.key('Enter'); f.key('Enter', {}, 'up')
    assert.equal(f.state().focusedGroupId, 'shape:g'); f.key('d')
    f.pointer('down', 200, 200); f.pointer('move', 50, 250); f.pointer('move', 10, 300); await f.pointer('up', 10, 350)
    const shape = f.shapes()[0]
    assert.equal(shape.parentId, 'shape:g')
    assert.equal(hitTestCanvas(f.saved(), { x: 10, y: 325 }, f.state().camera), shape.id)
    assert.equal(f.commits.length, 1); await f.key('z', { metaKey: true }); assert.deepEqual(f.saved(), f.initial)
  } finally { f.close() }
})

for (const enabled of [true, false]) test(`快捷键${enabled ? '开' : '关'}时Shift在提交等待期间松开会终止接段资格，再按Shift新起笔画`, async () => {
  const f = await drawFixture()
  let resume, pending
  try {
    f.key('d'); f.interaction.setShortcutsEnabled(enabled); f.pointer('down', 100, 100, { shiftKey: true }); resume = f.hold()
    pending = f.pointer('up', 200, 100, { shiftKey: true })
    f.key('Shift', {}, 'up'); resume(); await pending
    f.pointer('down', 300, 200, { shiftKey: true }); await f.pointer('up', 400, 200, { shiftKey: true })
    assert.equal(f.shapes().length, 2); assert.equal(f.commits.length, 2)
  } finally { resume?.(); await pending?.catch(() => {}); f.close() }
})

test('5%比例的大跨度Shift直线不会把半精度增量溢出存成Infinity', async () => {
  const f = await drawFixture([], { camera: { x: 0, y: 0, z: .05 } })
  try {
    f.key('d'); f.pointer('down', 100, 100, { shiftKey: true })
    for (const x of [1000, 2000, 3600]) f.pointer('move', x, 100, { shiftKey: true })
    await f.pointer('up', 3600, 100, { shiftKey: true })
    const decoded = points(f.shapes()[0]).flatMap(s => s.points)
    assert.ok(decoded.every(p => [p.x, p.y, p.z].every(Number.isFinite)))
    assert.ok(Math.abs(decoded.at(-1).x - 70000) < 32)
    assert.ok(getStrokeGeometry(f.shapes()[0]).outlines.flat().every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
    assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

test('超出笔迹编码范围的异常跳跃明确报错并撤销预览，不保存损坏路径', async () => {
  const f = await drawFixture()
  try {
    f.key('d'); f.pointer('down', 100, 100)
    assert.throws(() => f.pointer('move', 1e12, 100), error => error.code === 'limit')
    assert.equal(f.shapes().length, 0); assert.equal(f.commits.length, 0); assert.equal(f.state().mode, 'idle')
    f.pointer('down', 100, 100); await f.pointer('up', 200, 100)
    assert.equal(f.shapes().length, 1); assert.equal(f.commits.length, 1)
  } finally { f.close() }
})
