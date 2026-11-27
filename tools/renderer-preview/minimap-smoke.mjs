import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export async function minimapSmoke(window, output) {
  const contents = window.webContents, evaluate = code => contents.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const check = (value, message) => { if (!value) throw new Error(message) }
  const near = (a, b, label) => check(Math.abs(a - b) < 1e-6, `${label}: ${a} ≠ ${b}`)
  async function until(predicate) { for (let i = 0; i < 200; i++) { const value = await predicate(); if (value) return value; await delay(20) }; throw new Error('小地图状态等待超时') }
  const frames = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const input = async event => { contents.sendInputEvent(event); await frames() }
  const mouse = (type, point, modifiers = [], count = 1) => input({ type, x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: count, modifiers })
  const click = async (point, count = 1) => { await mouse('mouseMove', point); await mouse('mouseDown', point, [], count); await mouse('mouseUp', point, [], count) }
  const rect = selector => evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height}})()`)
  const center = box => ({ x: Math.round(box.x + box.w / 2), y: Math.round(box.y + box.h / 2) })
  const reset = async camera => { await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera(${JSON.stringify(camera)});void 0`); await frames() }
  const toggler = '[data-action="minimap"]', canvas = '[data-minimap-canvas]'
  // The previous step may have just restored a wide window. The button reappears
  // in the task after the host resize (minimap-ui defers its resize sync), so a
  // rect read straight away can still be the hidden, zero-sized button (#139).
  const shown = await until(async () => { const box = await rect(toggler); return box.w > 0 && box.h > 0 && box })
  await click(center(shown)); await until(async () => (await state()).minimap)
  const revision = (await state()).revision, selected = (await state()).selectedIds, cases = []
  const clean = async () => { const value = await state(); check(value.revision === revision && JSON.stringify(value.selectedIds) === JSON.stringify(selected) && !value.submitting && !value.lastError, '小地图输入改变了文档、选择或出错') }
  for (const camera of [{ x: 0, y: 0, z: 1 }, { x: 100, y: 50, z: 1 }, { x: 0, y: 0, z: 2 }]) {
    for (const sign of [-1, 1]) {
      await reset(camera)
      const before = await state(), map = await rect(canvas), layout = before.minimap.layout, box = layout.viewportBounds
      const start = { x: Math.round(map.x + box.x + box.w / 2), y: Math.round(map.y + box.y + box.h / 2) }
      await click(start); check(JSON.stringify((await state()).camera) === JSON.stringify(camera), '视口内单击改变视角')
      await mouse('mouseMove', start); await mouse('mouseDown', start)
      const target = { x: start.x + sign * 20, y: start.y + sign * 8 }
      await mouse('mouseMove', target, ['leftButtonDown'])
      const moved = await state()
      near(moved.camera.x, camera.x - sign * 20 / layout.scale, '原生拖动 x'); near(moved.camera.y, camera.y - sign * 8 / layout.scale, '原生拖动 y')
      near(moved.minimap.layout.viewportBounds.x - box.x, sign * 20, '视口框 x 跟手'); near(moved.minimap.layout.viewportBounds.y - box.y, sign * 8, '视口框 y 跟手')
      check(JSON.stringify(moved.minimap.layout.pageBounds) === JSON.stringify(layout.pageBounds), '拖动期间重新取景')
      await mouse('mouseMove', target, ['leftButtonDown']); check(JSON.stringify((await state()).camera) === JSON.stringify(moved.camera), '静止指针继续追赶')
      await mouse('mouseUp', target); check(!(await state()).minimap.dragging, '松手未释放小地图')
      cases.push({ camera, sign, moved: moved.camera }); await clean()
    }
  }
  await reset({ x: 100, y: 50, z: 1 })
  let before = await state(), map = await rect(canvas), box = before.minimap.layout.viewportBounds
  const start = { x: Math.round(map.x + box.x + box.w / 2), y: Math.round(map.y + box.y + box.h / 2) }
  await mouse('mouseMove', start); await mouse('mouseDown', start, ['shift'])
  await mouse('mouseMove', { x: start.x + 24, y: start.y + 6 }, ['shift', 'leftButtonDown'])
  near((await state()).camera.y, before.camera.y, 'Shift 锁轴')
  await mouse('mouseUp', { x: start.x + 24, y: start.y + 6 }, ['shift'])
  for (const double of [false, true]) {
    await reset({ x: 100, y: 50, z: 2 })
    before = await state(); map = await rect(canvas)
    const p = { x: Math.round(map.x + map.w - 3), y: Math.round(map.y + 3) }, layout = before.minimap.layout
    const target = { x: (p.x - map.x - layout.offset.x) / layout.scale, y: (p.y - map.y - layout.offset.y) / layout.scale }
    await click(p)
    if (double) await click(p, 2)
    await until(async () => !(await state()).needsFrame)
    const value = await state(), viewport = await evaluate('({w:document.querySelector("#canvas").clientWidth,h:document.querySelector("#canvas").clientHeight})')
    near(viewport.w / (2 * value.camera.z) - value.camera.x, target.x, '点击/双击目标 x')
    near(viewport.h / (2 * value.camera.z) - value.camera.y, target.y, '点击/双击目标 y'); near(value.camera.z, 2, '点击保留缩放')
  }
  const wheelCases = []
  for (const modifiers of [[], ['control'], ['shift']]) {
    const original = { x: 100, y: 50, z: 1 }; await reset(original)
    map = await rect(canvas); const p = center(map)
    await evaluate(`window.__minimapWheelEvents=[];window.__minimapWheelListener=e=>window.__minimapWheelEvents.push({target:e.target.hasAttribute('data-minimap-canvas')?'minimap':'canvas',x:e.clientX,y:e.clientY,dx:e.deltaX,dy:e.deltaY});document.addEventListener('wheel',window.__minimapWheelListener,true);void 0`)
    await input({ type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: 5, modifiers, canScroll: true })
    const mini = (await state()).camera, events = await evaluate('window.__minimapWheelEvents')
    check(events.length === 1 && events[0].target === 'minimap', '原生滚轮被重复分发')
    await evaluate('document.removeEventListener("wheel",window.__minimapWheelListener,true);void 0')
    await click(center(await rect(toggler))); await reset(original)
    await input({ type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: 5, modifiers, canScroll: true })
    const main = (await state()).camera
    check(JSON.stringify(main) === JSON.stringify(mini), '小地图滚轮与同位置画布滚轮不同')
    wheelCases.push({ modifiers, mini, main }); await click(center(await rect(toggler)))
  }
  const colors = await evaluate(`(()=>{const c=document.querySelector('[data-minimap-canvas]'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,counts={};for(let i=0;i<d.length;i+=4){const k=[...d.slice(i,i+4)].join(',');counts[k]=(counts[k]||0)+1}return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8)})()`)
  check(colors.some(([rgb]) => rgb === '237,240,242,255') && colors.some(([rgb]) => rgb === '110,116,119,255'), '简图背景或形状没有按设计令牌绘制')
  before = await state(); map = await rect(canvas); box = before.minimap.layout.viewportBounds
  await click({ x: Math.round(map.x + box.x + box.w / 2), y: Math.round(map.y + box.y + box.h / 2) })
  for (const type of ['keyDown', 'keyUp']) await input({ type, keyCode: 'Right' })
  near((await state()).camera.x, before.camera.x - 40 / before.camera.z, '小地图键盘方向键')
  await writeFile(join(output, 'minimap.png'), (await contents.capturePage()).toPNG())
  window.setContentSize(840, 800); await until(() => evaluate('document.querySelector("[data-action=minimap]").hidden'))
  check(!(await state()).minimap, '窄窗口未关闭小地图交互')
  window.setContentSize(841, 800); await until(async () => (await state()).minimap)
  // The minimap is already on at 841, so waiting on it alone returns before the
  // 1280 resize reaches the page, and the click lands where the button was in
  // the narrower layout. Wait for the new width and a laid-out button instead.
  window.setContentSize(1280, 800)
  const wide = await until(async () => await evaluate('innerWidth') === 1280 && (await state()).minimap && (async () => { const box = await rect(toggler); return box.w > 0 && box.h > 0 && box })())
  await click(center(wide)); await until(async () => !(await state()).minimap).catch(() => check(false, '收起未卸载小地图'))
  check(await evaluate('document.querySelectorAll("[data-minimap-canvas]").length') === 0, '收起遗留缩略图节点')
  await clean()
  return { cases, wheelCases, colors, shift: true, clickAndNativeDoubleClick: true, narrowAndRestore: true, collapse: true, documentUnchanged: true }
}
