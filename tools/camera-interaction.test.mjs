import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands } from '../engine/index.js'

async function fixture(options = {}) {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:a', shapeType: 'geo', x: 100, y: 100, props: { w: 200, h: 100, fill: 'solid' } },
    { type: 'create_shape', id: 'shape:b', shapeType: 'geo', x: 900, y: 600, props: { w: 100, h: 100, fill: 'solid' } },
  ]).snapshot
  const commits = [], history = []
  const session = await createEditorSession({ actor: 'camera-test', transport: {
    read: async () => ({ snapshot, revision: '0' }), subscribe: () => () => {},
    commit: async body => { commits.push(body); return { ...executeCanvasCommands(snapshot, body.commands), revision: String(commits.length) } },
    undo: async () => { history.push('undo'); return { snapshot, revision: 'undo' } },
    redo: async () => { history.push('redo'); return { snapshot, revision: 'redo' } },
  } })
  const interaction = createCanvasInteraction({ session, viewport: { w: 1280, h: 800 }, ...options })
  let time = 0
  const send = (type, extra = {}, dt = 16) => interaction.dispatch({ type, time: time += dt, ...extra })
  const pointer = (type, x, y, extra) => send(`pointer_${type}`, { point: { x, y }, pointerId: 1, button: 0, ...extra })
  const key = (key, extra = {}, type = 'key_down') => send(type, { key, ...extra })
  const frame = (dt = 16) => send('frame', {}, dt)
  const settle = () => { for (let i = 0; i < 100 && interaction.state.get().needsFrame; i++) frame() }
  const close = () => { interaction.dispose(); session.dispose() }
  return { session, interaction, send, pointer, key, frame, settle, close, commits, history, camera: () => interaction.state.get().camera }
}
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message || ''}: ${a} ≠ ${b}`)

test('A02/H01：手形、空格和中键逐帧平移，保留选择且惯性逐帧衰减，取消和新输入停滑行', async () => {
  const f = await fixture()
  try {
    f.pointer('down', 150, 150); await f.pointer('up', 150, 150)
    f.key('h'); assert.equal(f.interaction.state.get().toolId, 'hand')
    f.pointer('down', 400, 300); f.pointer('move', 420, 310); f.pointer('move', 440, 320); await f.pointer('up', 440, 320)
    near(f.camera().x, 40); assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a'])
    f.frame(); const first = f.camera().x; f.frame(); assert.ok(f.camera().x > first)
    const d1 = f.camera().x - first; const second = f.camera().x; f.frame(); assert.ok(f.camera().x - second < d1)
    f.key('Escape'); assert.equal(f.interaction.state.get().needsFrame, false)
    f.key('v'); f.key(' '); f.pointer('down', 400, 300); f.pointer('move', 410, 300); await f.pointer('up', 410, 300); f.key(' ', {}, 'key_up')
    assert.equal(f.interaction.state.get().toolId, 'select')
    f.pointer('down', 100, 100, { button: 1 }); f.pointer('move', 110, 120, { button: 1 }); f.pointer('cancel', 110, 120, { button: 1 })
    assert.equal(f.interaction.state.get().needsFrame, false); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('H02/H20/H21：触控板平移、Ctrl 捏合、鼠标反转与两指同时平移缩放均锚定屏幕指针', async () => {
  const f = await fixture({ inputDevice: 'trackpad' })
  try {
    f.send('wheel', { point: { x: 300, y: 200 }, delta: { x: 10, y: 20 } }); near(f.camera().x, -10); near(f.camera().y, -20)
    f.interaction.setCamera({ x: 0, y: 0, z: 1 })
    f.send('wheel', { point: { x: 300, y: 200 }, delta: { x: 0, y: -5 }, ctrlKey: true }); near(f.camera().z, 1.05); near(300 / f.camera().z - f.camera().x, 300)
    f.interaction.setCamera({ x: 0, y: 0, z: 1 })
    f.pointer('down', 200, 200, { pointerType: 'touch' }); f.pointer('down', 400, 200, { pointerId: 2, pointerType: 'touch' })
    f.pointer('move', 500, 200, { pointerId: 2, pointerType: 'touch' }); near(f.camera().z, 1.5); near(350 / f.camera().z - f.camera().x, 300)
    await f.pointer('up', 500, 200, { pointerId: 2, pointerType: 'touch' }); await f.pointer('up', 200, 200, { pointerType: 'touch' }); assert.equal(f.commits.length, 0)
  } finally { f.close() }
  const mouse = await fixture({ inputDevice: 'mouse', invertZoom: true })
  try { mouse.send('wheel', { point: { x: 300, y: 200 }, delta: { x: 0, y: 5 } }); assert.ok(mouse.camera().z > 1) } finally { mouse.close() }
})

test('H03–H08/H23：档位与范围、中心或 Shift 指针缩放、100%、适合全部和选中，减少动画直接完成', async () => {
  const f = await fixture({ reduceMotion: true })
  try {
    f.pointer('move', 300, 200); f.key('='); near(f.camera().z, 2); near(640 / f.camera().z - f.camera().x, 640)
    f.key('-', { shiftKey: true }); near(f.camera().z, 1); near(300 / f.camera().z - f.camera().x, 470)
    f.key('0', { shiftKey: true }); near(f.camera().z, 1)
    for (let i = 0; i < 20; i++) f.key('-'); near(f.camera().z, .05)
    for (let i = 0; i < 20; i++) f.key('='); near(f.camera().z, 8)
    f.key('1', { shiftKey: true }); near(f.camera().z, 672 / 600); near((100 + f.camera().y) * f.camera().z, 64)
    f.interaction.setCamera({ x: 0, y: 0, z: 1 }); f.pointer('down', 150, 150); await f.pointer('up', 150, 150)
    f.key('2', { shiftKey: true }); assert.ok(f.camera().z > 1); near((100 + 100 + f.camera().x) * f.camera().z, 640)
    assert.equal(f.interaction.state.get().needsFrame, false); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('H09：按住 Z 点击和矩形缩放、Alt 反向，松键回到原工具', async () => {
  const f = await fixture({ reduceMotion: true })
  try {
    f.key('z'); f.pointer('down', 300, 200); await f.pointer('up', 300, 200); near(f.camera().z, 2)
    f.key('z', {}, 'key_up'); assert.equal(f.interaction.state.get().temporaryTool, null)
    f.interaction.setCamera({ x: 0, y: 0, z: 1 }); f.key('z'); f.pointer('down', 200, 150); f.pointer('move', 600, 450); await f.pointer('up', 600, 450); assert.ok(f.camera().z > 1)
    f.key('z', {}, 'key_up'); f.key('z'); const z = f.camera().z; f.pointer('down', 400, 300, { altKey: true }); await f.pointer('up', 400, 300, { altKey: true }); assert.ok(f.camera().z < z); f.key('z', {}, 'key_up')
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('H12/H17：返回内容只在内容全部移出后出现；拖到边缘逐帧自动平移并续接同一次拖动', async () => {
  const f = await fixture({ reduceMotion: true })
  try {
    f.interaction.setCamera({ x: -10000, y: -10000, z: 1 }); assert.equal(f.interaction.state.get().contentOffscreen, true)
    f.interaction.navigate('return-content'); assert.equal(f.interaction.state.get().contentOffscreen, false); assert.ok(f.camera().z <= 1)
    f.interaction.setCamera({ x: 0, y: 0, z: 1 }); f.pointer('down', 150, 150); f.pointer('move', 1275, 300)
    const before = f.camera().x; f.frame(); assert.ok(f.camera().x < before); assert.ok(f.session.store.get('shape:a').x > 1225)
    await f.pointer('up', 1275, 300); assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

test('H30：手形双击放大、三击缩小、四击在 100% 和适合全部间切换', async () => {
  const f = await fixture({ reduceMotion: true })
  try {
    f.key('h')
    for (let n = 1; n <= 4; n++) { f.pointer('down', 300, 200); await f.pointer('up', 300, 200); if (n === 2) near(f.camera().z, 2); if (n === 3) near(f.camera().z, 1) }
    assert.notEqual(f.camera().z, 1); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('按键经运行时撤销和重做；手势中拒绝并保留正在进行的拖动，所有视角帧零快照零写入', async () => {
  const f = await fixture()
  try {
    f.pointer('down', 150, 150); f.pointer('move', 180, 160)
    await assert.rejects(f.key('z', { metaKey: true }), /结束当前手势/)
    assert.equal(f.session.state.get().isGestureActive, true); assert.equal(f.interaction.state.get().mode, 'dragging')
    f.key('Escape'); await f.key('z', { ctrlKey: true }); await f.key('z', { ctrlKey: true, shiftKey: true }); assert.deepEqual(f.history, ['undo', 'redo']); assert.equal(f.interaction.state.get().lastError, null)
    f.session.store.getStoreSnapshot = f.session.store.allRecords = () => { throw new Error('相机逐帧禁止全板读取') }
    f.key('h'); f.pointer('down', 400, 300); for (let i = 0; i < 20; i++) f.pointer('move', 400 + i, 300 + i); await f.pointer('up', 420, 320); f.settle()
    for (let i = 0; i < 20; i++) { f.send('wheel', { point: { x: 200, y: 200 }, delta: { x: 0, y: 1 }, ctrlKey: true }); f.frame() }
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('动画由帧输入推进；Shift+Z 不凭空创建 H10 全局概览，手形中两指缩放可取消', async () => {
  const f = await fixture()
  try {
    f.key('='); assert.equal(f.camera().z, 1); assert.equal(f.interaction.state.get().needsFrame, true)
    f.frame(); assert.ok(f.camera().z > 1 && f.camera().z < 2); f.settle(); near(f.camera().z, 2)
    const before = f.camera(); f.key('Z', { shiftKey: true }); f.frame(); assert.deepEqual(f.camera(), before)
    f.key('Escape'); assert.equal(f.interaction.state.get().needsFrame, false)
    f.key('h'); f.pointer('down', 200, 200, { pointerType: 'touch' }); f.pointer('down', 400, 200, { pointerId: 2, pointerType: 'touch' })
    f.pointer('move', 500, 200, { pointerId: 2, pointerType: 'touch' }); near(f.camera().z, 3)
    f.pointer('cancel', 500, 200, { pointerId: 2, pointerType: 'touch' }); f.pointer('cancel', 200, 200, { pointerType: 'touch' })
    assert.equal(f.interaction.state.get().mode, 'idle'); assert.equal(f.session.state.get().isGestureActive, false)
  } finally { f.close() }
})

test('产品可只开放选择工具；尺寸、偏好和帧时间校验，空选中适合不移动相机', async () => {
  const f = await fixture({ toolIds: ['select'] })
  try {
    f.key('h'); assert.equal(f.interaction.state.get().toolId, 'select')
    assert.throws(() => f.interaction.setTool('hand'), /未向本产品开放/)
    f.key('2', { shiftKey: true }); assert.deepEqual(f.camera(), { x: 0, y: 0, z: 1 })
    assert.throws(() => f.interaction.setViewport({ w: 0, h: 20 }), /视口/)
    assert.throws(() => f.send('frame', {}, -100), /时间/)
  } finally { f.close() }
})

test('H01：空格松手惯性被下一次选择按下停止，不把滑行叠加到新拖动', async () => {
  const f = await fixture()
  try {
    f.key(' '); f.pointer('down', 400, 300); f.pointer('move', 440, 300); await f.pointer('up', 440, 300); f.key(' ', {}, 'key_up')
    assert.equal(f.interaction.state.get().needsFrame, true)
    f.pointer('down', 190, 150); const stopped = f.camera(); f.frame(); assert.deepEqual(f.camera(), stopped)
    f.pointer('move', 210, 150); assert.equal(f.session.store.get('shape:a').x, 120)
    f.key('Escape'); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('H17：参数和会话开关能关闭边缘平移，重新打开后由下一帧续接当前手势', async () => {
  const f = await fixture({ edgeScrolling: false })
  try {
    f.pointer('down', 150, 150); f.pointer('move', 1275, 300); f.frame(); near(f.camera().x, 0)
    assert.equal(f.interaction.state.get().needsFrame, false)
    f.interaction.setEdgeScrolling(true); f.frame(); assert.ok(f.camera().x < 0)
    f.interaction.setEdgeScrolling(false); const camera = f.camera(); f.frame(); assert.deepEqual(f.camera(), camera)
    f.key('Escape'); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('H09：Alt 拖框按旧版只缩小一档；大小矩形都守住 5%–800%，最小档不平移', async () => {
  const f = await fixture()
  try {
    for (const [z, expected] of [[1, .5], [8, 4], [.05, .05]]) for (const end of [{ x: 600, y: 450 }, { x: 1250, y: 780 }]) {
      f.interaction.setCamera({ x: 0, y: 0, z }); f.key('z')
      f.pointer('down', 100, 80, { altKey: true }); f.pointer('move', end.x, end.y, { altKey: true }); await f.pointer('up', end.x, end.y, { altKey: true }); f.settle()
      near(f.camera().z, expected)
      if (z === .05) assert.deepEqual(f.camera(), { x: 0, y: 0, z })
      else { near(f.camera().x, 640 / expected - (100 + end.x) / (2 * z)); near(f.camera().y, 400 / expected - (80 + end.y) / (2 * z)) }
      f.key('z', {}, 'key_up')
    }
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('H02/H20：自动模式新会话及捏合后均保留触控板滚动，整数大滚动不误切为鼠标缩放', async () => {
  const f = await fixture()
  try {
    f.send('wheel', { point: { x: 640, y: 400 }, delta: { x: 0, y: 120 } })
    assert.deepEqual(f.camera(), { x: 0, y: -120, z: 1 })
    f.send('wheel', { point: { x: 640, y: 400 }, delta: { x: 0, y: -1 }, ctrlKey: true })
    f.interaction.setCamera({ x: 0, y: 0, z: 1 })
    f.send('wheel', { point: { x: 640, y: 400 }, delta: { x: 0, y: 100 } })
    assert.deepEqual(f.camera(), { x: 0, y: -100, z: 1 })
  } finally { f.close() }
})
