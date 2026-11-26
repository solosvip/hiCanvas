import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands } from '../engine/index.js'
import { minimapToPagePoint } from '../renderer/geometry.js'

async function fixture(options = {}) {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:a', shapeType: 'geo', x: 0, y: 0, props: { w: 200, h: 100 } },
    { type: 'create_shape', id: 'shape:b', shapeType: 'geo', x: 800, y: 400, props: { w: 200, h: 100 } },
  ]).snapshot
  const commits = [], history = []
  const session = await createEditorSession({ actor: 'minimap', transport: {
    read: async () => ({ snapshot, revision: 'initial' }), subscribe: () => () => {},
    commit: async value => { commits.push(value); throw new Error('导航不应提交画板') },
    undo: async value => { history.push(value); throw new Error('导航不应撤销') },
  } })
  const interaction = createCanvasInteraction({ session, camera: { x: 100, y: 50, z: 1 }, viewport: { w: 1280, h: 900 }, ...options })
  interaction.setMinimap({ w: 152, h: 88 })
  let time = 0
  const state = () => interaction.state.get(), send = (type, extra = {}) => interaction.dispatch({ type, time: time += 16, target: 'minimap', ...extra })
  const pointer = (type, x, y, extra = {}) => send(`pointer_${type}`, { point: { x, y }, pointerId: 1, button: 0, ...extra })
  const settle = () => { for (let i = 0; i < 40 && state().needsFrame; i++) send('frame') }
  const assertPure = () => { assert.deepEqual(session.store.getStoreSnapshot(), snapshot); assert.equal(commits.length, 0); assert.equal(history.length, 0); assert.equal(session.state.get().isGestureActive, false) }
  return { session, interaction, state, send, pointer, settle, assertPure, close() { interaction.dispose(); session.dispose() } }
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`)

test('H11：内部单击保持视角，外部点击/双击逐帧动画居中，缩放、文档与撤销不变', async () => {
  const f = await fixture()
  try {
    const before = f.state().camera
    f.pointer('down', 76, 44); f.pointer('up', 76, 44); assert.deepEqual(f.state().camera, before)
    for (const type of ['outside', 'double']) {
      f.interaction.setCamera(before)
      const point = { x: 145, y: 6 }, target = minimapToPagePoint(f.state().minimap.layout, point)
      if (type === 'outside') { f.pointer('down', point.x, point.y); f.pointer('up', point.x, point.y) }
      else f.send('double_click', { point })
      assert.equal(f.state().needsFrame, true); assert.deepEqual(f.state().camera, before)
      f.send('frame'); const partial = f.state().camera
      assert.notDeepEqual(partial, before); assert.equal(partial.z, before.z)
      f.settle(); near(640 / before.z - f.state().camera.x, target.x); near(450 / before.z - f.state().camera.y, target.y)
      f.assertPure()
    }
  } finally { f.close() }
})

test('H11：拖动固定取景和偏移，逐帧视口跟随指针；重复同点不漂移、左右对称', async () => {
  const f = await fixture({ reduceMotion: true })
  try {
    for (const camera of [{ x: 0, y: 0, z: 1 }, { x: 100, y: 50, z: 1 }, { x: 0, y: 0, z: 2 }, { x: -1500, y: -1200, z: .25 }]) {
      const deltas = []
      for (const sign of [-1, 1]) {
        f.interaction.setCamera(camera)
        const layout = f.state().minimap.layout, b = layout.viewportBounds, start = { x: b.x + b.w * .4, y: b.y + b.h * .6 }
        f.pointer('down', start.x, start.y)
        let previousDelta = null
        for (const d of [5, 20, 20, 0, 30]) {
          const previous = f.state().camera
          f.pointer('move', start.x + sign * d, start.y + sign * d / 2)
          const next = f.state(), bounds = next.minimap.layout.viewportBounds
          near(bounds.x - b.x, sign * d); near(bounds.y - b.y, sign * d / 2)
          assert.deepEqual(next.minimap.layout.pageBounds, layout.pageBounds)
          near(next.camera.x, camera.x - sign * d / layout.scale); near(next.camera.y, camera.y - sign * d / 2 / layout.scale)
          if (d === previousDelta) assert.deepEqual(next.camera, previous)
          previousDelta = d
          f.assertPure()
        }
        deltas.push(f.state().camera.x - camera.x)
        f.pointer('up', start.x + sign * 30, start.y + sign * 15)
        assert.equal(f.state().minimap.dragging, false); assert.equal(f.state().mode, 'idle')
      }
      near(deltas[0], -deltas[1])
    }
  } finally { f.close() }
})

test('H11：真实双击序列夹有动画帧时仍居中首击目标，不随取景反馈漂移', async () => {
  const f = await fixture()
  try {
    const point = { x: 145, y: 6 }, target = minimapToPagePoint(f.state().minimap.layout, point)
    f.pointer('down', point.x, point.y); f.pointer('up', point.x, point.y)
    f.send('frame'); f.send('frame'); f.send('frame')
    f.pointer('down', point.x, point.y); f.pointer('up', point.x, point.y)
    f.send('double_click', { point }); f.settle()
    near(640 - f.state().camera.x, target.x); near(450 - f.state().camera.y, target.y); f.assertPure()
  } finally { f.close() }
})

test('H11：双击按宿主已识别的输入处理，不另设短超时；单击始终按当前取景定位', async () => {
  const f = await fixture()
  try {
    const point = { x: 145, y: 6 }, original = minimapToPagePoint(f.state().minimap.layout, point)
    f.pointer('down', point.x, point.y); f.pointer('up', point.x, point.y); f.settle()
    for (let i = 0; i < 40; i++) f.send('frame')
    const current = minimapToPagePoint(f.state().minimap.layout, point)
    f.pointer('down', point.x, point.y); f.pointer('up', point.x, point.y); f.settle()
    near(640 - f.state().camera.x, current.x); near(450 - f.state().camera.y, current.y)
    f.send('double_click', { point }); f.settle()
    near(640 - f.state().camera.x, original.x); near(450 - f.state().camera.y, original.y)
    f.assertPure()
  } finally { f.close() }
})

test('H11：Shift锁主要轴、次要指针无效；取消/关闭/视口改变释放手势', async () => {
  const f = await fixture()
  try {
    const camera = f.state().camera, s = f.state().minimap.layout.scale
    f.pointer('down', 76, 44, { shiftKey: true })
    f.pointer('move', 96, 49, { shiftKey: true }); near(f.state().camera.x, camera.x - 20 / s); near(f.state().camera.y, camera.y)
    f.pointer('move', 106, 84, { shiftKey: true }); near(f.state().camera.y, camera.y)
    const locked = f.state().camera
    f.pointer('move', 100, 80, { pointerId: 2 }); assert.deepEqual(f.state().camera, locked)
    f.pointer('cancel', 106, 84); assert.equal(f.state().minimap.dragging, false)
    f.pointer('down', 76, 44); f.send('key_down', { key: 'Escape', target: 'canvas' }); assert.equal(f.state().minimap.dragging, false)
    f.pointer('down', 76, 44); f.interaction.setMinimap(null); assert.equal(f.state().minimap, null)
    const closed = f.state().camera; f.pointer('move', 80, 50); assert.deepEqual(f.state().camera, closed)
    f.interaction.setMinimap({ w: 152, h: 88 }); f.pointer('down', 76, 44); f.interaction.setViewport({ w: 800, h: 600 }); assert.equal(f.state().minimap.dragging, false)
    f.assertPure()
  } finally { f.close() }
})

test('H11：两次点击间有滚轮或方向键导航时，按新取景定位，不复用旧双击目标', async () => {
  for (const action of ['minimap-wheel', 'canvas-wheel', 'arrow']) {
    const f = await fixture()
    try {
      const point = { x: 145, y: 6 }
      f.pointer('down', point.x, point.y); f.pointer('up', point.x, point.y); f.settle()
      if (action === 'arrow') f.send('key_down', { key: 'ArrowRight' })
      else f.send('wheel', { point, delta: { x: 200, y: 300 }, target: action === 'canvas-wheel' ? 'canvas' : 'minimap' })
      const target = minimapToPagePoint(f.state().minimap.layout, point)
      f.pointer('down', point.x, point.y); f.pointer('up', point.x, point.y); f.settle()
      near(640 - f.state().camera.x, target.x); near(450 - f.state().camera.y, target.y); f.assertPure()
    } finally { f.close() }
  }
})

test('H11：展开、收起小地图不打断正在进行的形状拖动', async () => {
  const f = await fixture()
  try {
    f.send('pointer_down', { target: 'canvas', point: { x: 101, y: 51 } })
    f.send('pointer_move', { target: 'canvas', point: { x: 141, y: 81 } })
    assert.equal(f.state().mode, 'dragging'); assert.equal(f.session.state.get().isGestureActive, true)
    f.interaction.setMinimap(null); assert.equal(f.state().mode, 'dragging')
    f.interaction.setMinimap({ w: 152, h: 88 }); assert.equal(f.state().mode, 'dragging')
    f.send('key_down', { target: 'canvas', key: 'Escape' }); f.assertPure()
  } finally { f.close() }
})

test('H11：小地图滚轮与同一画布锚点的普通/Shift/Ctrl/鼠标滚轮逐项相同，仅分发一次', async () => {
  for (const inputDevice of [null, 'mouse', 'trackpad']) {
    const f = await fixture({ inputDevice })
    try {
      const original = f.state().camera
      for (const modifiers of [{}, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) {
        const input = { delta: { x: 0, y: -5 }, point: { x: 20, y: 30 }, canvasPoint: { x: 84, y: 848 }, ...modifiers }
        f.send('wheel', input); const mini = f.state().camera
        f.interaction.setCamera(original); f.send('wheel', { ...input, target: 'canvas', point: input.canvasPoint }); assert.deepEqual(f.state().camera, mini)
        f.interaction.setCamera(original)
      }
      f.send('key_down', { key: 'ArrowRight' }); assert.ok(f.state().camera.x < original.x)
      f.assertPure()
    } finally { f.close() }
  }
})
