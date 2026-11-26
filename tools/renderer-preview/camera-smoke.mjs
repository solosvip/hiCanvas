import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
const check = (condition, message) => { if (!condition) throw new Error(message) }
const until = async predicate => {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await delay(20) }
  throw new Error('等待视角输入结果超时。')
}

// Native input exercises shell normalization as well as the window-free engine.
// The public observer is read-only except the pre-existing camera reset hook.
export async function cameraSmoke(target, output, { persistent = false } = {}) {
  const contents = target.webContents, evaluate = code => contents.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const key = async (keyCode, modifiers = []) => {
    for (const type of ['keyDown', 'keyUp']) contents.sendInputEvent({ type, keyCode, modifiers })
    await delay(70)
  }
  const pointer = async (type, x, y, button = 'left') => {
    contents.sendInputEvent({ type, x, y, button, clickCount: 1, modifiers: type === 'mouseMove' ? [button === 'middle' ? 'middleButtonDown' : 'leftButtonDown'] : [] })
    await delay(25)
  }
  const reset = async (camera = { x: 0, y: 0, z: 1 }) => {
    await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera(${JSON.stringify(camera)});void 0`); await delay(30)
  }
  const settled = () => until(async () => !(await state()).needsFrame)
  await reset(); await key('h'); check((await state()).toolId === 'hand', 'H 没有切换手形')
  const before = await state()
  await pointer('mouseDown', 400, 300); await pointer('mouseMove', 440, 320); await pointer('mouseUp', 440, 320)
  await settled(); const hand = await state()
  check(hand.camera.x > 40 && hand.camera.y > 20 && hand.revision === before.revision, '手形惯性未生效或错误提交')
  await key('v'); await reset()
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
  await pointer('mouseDown', 400, 300); await pointer('mouseMove', 420, 320); await pointer('mouseUp', 420, 320)
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' }); await settled()
  check((await state()).camera.x > 20 && (await state()).toolId === 'select', '空格临时平移未恢复工具')
  await reset(); await key('='); await settled(); check((await state()).camera.z === 2, '真实 = 没有按档位放大')
  await key('0', ['shift']); await settled(); check((await state()).camera.z === 1, '真实 Shift+0 没有恢复 100%')
  await key('1', ['shift']); await settled(); check((await state()).camera.z < 1, '真实 Shift+1 没有适合全部')
  await reset()
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'z' }); await delay(30)
  await pointer('mouseDown', 300, 200); await pointer('mouseUp', 300, 200); await settled()
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'z' }); await delay(30)
  check((await state()).camera.z === 2 && (await state()).temporaryTool === null, 'Z 临时缩放没有恢复工具')
  await reset(); contents.debugger.attach('1.3')
  try {
    await contents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
    const touch = (id, x) => ({ id, x, y: 200, radiusX: 3, radiusY: 3, force: .5 })
    await contents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, 200), touch(2, 400)] })
    await contents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, 200), touch(2, 500)] })
    await until(async () => Math.abs((await state()).camera.z - 1.5) < 1e-6)
    const pinch = (await state()).camera
    check(Math.abs(350 / pinch.z - pinch.x - 300) < 1e-6, '真实双指输入没有锚定手指中心')
    await contents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await until(async () => (await state()).mode === 'idle')
  } finally {
    await contents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false }); contents.debugger.detach()
  }
  await reset(); await pointer('mouseMove', 40, 40); await pointer('mouseDown', 40, 40); await pointer('mouseMove', 60, 50)
  if (persistent) {
    await key('z', ['meta'])
    const rejected = await state()
    check(rejected.mode === 'dragging' && rejected.lastError?.code === 'busy', '手势内撤销没有保留拖动并报告 busy')
    check((await evaluate("document.querySelector('#status').textContent")).includes('结束当前手势'), '手势内撤销未在界面提示')
    await writeFile(join(output, 'camera-undo-busy.png'), (await contents.capturePage()).toPNG())
    await pointer('mouseUp', 60, 50); await until(async () => !(await state()).submitting)
    const saved = await state(), x = saved.selectedShapes[0].x
    check(x === 20, '撤销被拒后松手没有保存原拖动')
    await new Promise(resolve => { contents.once('did-finish-load', resolve); contents.reload() }); await until(async () => (await state())?.ready)
    await key('z', ['meta']); await until(async () => (await state()).revision !== saved.revision && !(await state()).submitting)
    await reset(); await pointer('mouseDown', 40, 40); await pointer('mouseUp', 40, 40)
    check((await state()).selectedShapes[0].x === 0, '页面刷新后撤销未恢复之前位置')
    await key('z', ['meta', 'shift']); await until(async () => !(await state()).submitting && (await state()).selectedShapes[0]?.x === x)
    await key('z', ['control']); await until(async () => !(await state()).submitting && (await state()).selectedShapes[0]?.x === 0)
    check(!(await state()).lastError && !(await evaluate("document.querySelector('#status').textContent")).includes('操作失败'), '成功撤销后仍残留上次忙碌提示')
  } else { await key('Escape'); await pointer('mouseUp', 60, 50) }
  await reset({ x: -10000, y: -10000, z: 1 })
  check((await state()).contentOffscreen, '全板移出后没有返回内容状态')
  const back = await evaluate("(() => {const r=document.querySelector('[data-action=return-content]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
  await pointer('mouseDown', Math.round(back.x), Math.round(back.y)); await pointer('mouseUp', Math.round(back.x), Math.round(back.y)); await settled()
  check(!(await state()).contentOffscreen, '返回内容按钮没有转交交互层')
  await writeFile(join(output, 'camera-navigation.png'), (await contents.capturePage()).toPNG())
  await reset(); await key('h'); const counts = await state()
  contents.debugger.attach('1.3')
  let layouts
  try {
    await contents.debugger.sendCommand('Performance.enable')
    const metrics = async () => Object.fromEntries((await contents.debugger.sendCommand('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]))
    await delay(50); const start = await metrics()
    for (const deltaY of [3, -3, 3, -3]) {
      contents.sendInputEvent({ type: 'mouseWheel', x: 400, y: 300, deltaY, deltaX: 0, modifiers: ['control'], canScroll: true }); await delay(30)
    }
    layouts = (await metrics()).LayoutCount - start.LayoutCount
    check(layouts === 0, `视角更新引发 ${layouts} 次布局`)
  } finally { contents.debugger.detach() }
  const after = await state(); check(after.snapshotReads === counts.snapshotReads && after.revision === counts.revision, '视角帧读全板或提交了记录')
  await key('v'); await reset()
  return { hand: hand.camera, cameraLayouts: layouts, snapshotReads: after.snapshotReads - counts.snapshotReads, persistentUndo: persistent }
}
