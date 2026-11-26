import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { b64Vecs } from '@tldraw/tlschema'

// Native mouse/keyboard and Chromium pen input only. The preview accessor is
// read-only, except camera fixture setup; no tool actions are invoked from JS.
export async function drawSmoke(window, output) {
  const contents = window.webContents, samples = []
  const evaluate = code => contents.executeJavaScript(code)
  const seen = new Map()
  const state = async () => {
    const value = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
    // Store iteration is unordered. Track first observation of each new ID;
    // each native stroke is observed before starting the next one.
    for (const shape of value.strokes) if (!seen.has(shape.id)) seen.set(shape.id, seen.size)
    value.strokes.sort((a, b) => seen.get(a.id) - seen.get(b.id))
    return value
  }
  const check = (condition, message) => { if (!condition) throw new Error(message) }
  const flush = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  async function until(predicate) {
    const end = Date.now() + 10000
    while (Date.now() < end) { const result = await predicate(await state()); if (result) return result; await delay(10) }
    throw new Error('等待手绘输入结果超时')
  }
  const remember = async label => { const value = await state(); samples.push({ label, ...value }); return value }
  const mouse = async (type, x, y, modifiers = []) => { contents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers: type === 'mouseMove' ? ['leftButtonDown', ...modifiers] : modifiers }); await flush() }
  const key = async (keyCode, modifiers = [], type = 'keyDown') => { contents.sendInputEvent({ type, keyCode, modifiers }); await flush() }
  const stroke = async (x, y, endX, endY, modifiers = []) => {
    await mouse('mouseDown', x, y, modifiers)
    for (let i = 1; i <= 8; i++) await mouse('mouseMove', x + (endX - x) * i / 8, y + (endY - y) * i / 8, modifiers)
    await mouse('mouseUp', endX, endY, modifiers); await until(s => !s.submitting)
  }
  const latest = s => s.strokes.at(-1)
  const decoded = shape => shape.props.segments.map(s => ({ type: s.type, points: b64Vecs.decodePoints(s.path) }))
  const camera = async z => { await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:${z}});void 0`); await flush() }
  async function button(action) {
    const point = await evaluate(`(()=>{const r=document.querySelector('[data-action="${action}"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await mouse('mouseDown', point.x, point.y); await mouse('mouseUp', point.x, point.y)
  }
  await evaluate('document.querySelector("#canvas").focus();void 0')
  try {
    await key('D'); check((await state()).toolId === 'draw', 'D没有进入画笔')
    await mouse('mouseDown', 100, 100); await mouse('mouseMove', 140, 130)
    const preview = await remember('free-preview')
    check(preview.mode === 'drawing' && latest(preview).props.isComplete === false && preview.revision === '0', '自由笔画没有即时预览／提前提交')
    await key('Shift', ['shift']); await mouse('mouseMove', 240, 180, ['shift'])
    await key('Shift', [], 'keyUp'); await mouse('mouseMove', 300, 200); await mouse('mouseUp', 340, 190)
    await until(s => s.revision === '1' && !s.submitting)
    const complete = await remember('free-straight-free')
    check(JSON.stringify(decoded(latest(complete)).map(s => s.type)) === JSON.stringify(['free', 'straight', 'free']), '原生Shift切换没有组成三段笔迹')
    check(latest(complete).props.isComplete, '松手后没有完成笔画')
    await mouse('mouseDown', 100, 250); await mouse('mouseMove', 200, 280); await key('Escape'); await mouse('mouseUp', 200, 280)
    const cancelled = await state(); check(cancelled.strokes.length === 1 && cancelled.revision === '1', 'Esc取消留下半成品或撤销记录')
    await key('Escape'); check((await state()).revision === '1', '松手之后Esc改变了已完成笔画')
    await key('Z', ['meta']); await until(s => s.strokes.length === 0 && !s.submitting)
    await key('Z', ['meta', 'shift']); await until(s => s.strokes.length === 1 && !s.submitting)
    const undoRedo = await remember('undo-redo-after-cancel')
    check(undoRedo.revision === '3', '取消之后撤销不是移除前一整笔')

    await key('B'); await key('Shift', ['shift'])
    await stroke(100, 350, 220, 380, ['shift'])
    const straight = await state(), id = latest(straight).id
    await mouse('mouseDown', 340, 420, ['shift']); await mouse('mouseUp', 340, 420, ['shift']); await until(s => !s.submitting)
    const joined = await remember('shift-append')
    check(latest(joined).id === id && decoded(latest(joined)).length === 2, '保持Shift没有向同一笔迹追加直线')
    await key('Shift', [], 'keyUp')

    contents.debugger.attach('1.3')
    const pen = async (type, x, y, force) => {
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, pointerType: 'pen', force, clickCount: type === 'mouseMoved' ? 0 : 1 })
      await flush()
    }
    try {
      for (const [y, pressure] of [[500, .1], [550, 1]]) {
        await pen('mousePressed', 100, y, pressure)
        for (let x = 120; x <= 340; x += 20) await pen('mouseMoved', x, y, pressure)
        await pen('mouseReleased', 340, y, 0); await until(s => !s.submitting)
      }
    } finally { contents.debugger.detach() }
    const pressures = await remember('native-pen-pressure')
    const penShapes = pressures.strokes.slice(-2)
    check(pressures.isPenMode && penShapes.every(r => r.props.isPen), '原生pen没有进入笔模式')
    check(Math.abs(decoded(penShapes[0])[0].points[0].z - .13) < .001 && Math.abs(decoded(penShapes[1])[0].points[0].z - 1.25) < .001, '原生压力未进入存档')
    const heights = await evaluate(`(${JSON.stringify(penShapes.map(s => s.id))}).map(id=>document.querySelector('[data-shape-id="'+id+'"] svg').getBoundingClientRect().height)`)
    check(heights[1] > heights[0] * 2, '原生压力没有改变可见粗细')
    await writeFile(join(output, 'draw-pressure.png'), (await contents.capturePage()).toPNG())
    const beforeMouse = pressures.strokes.length
    await stroke(450, 500, 650, 500); check((await state()).strokes.length === beforeMouse, '笔模式没有阻止鼠标笔画')
    await button('exit-pen'); check(!(await state()).isPenMode, '退出手写笔按钮未退出')
    await stroke(450, 550, 650, 550); check((await state()).strokes.length === beforeMouse + 1, '退出后鼠标没有恢复')

    await key('D', ['shift']); check((await state()).toolId === 'highlight', 'Shift+D没有进入荧光笔')
    await stroke(450, 260, 800, 260); await stroke(450, 266, 800, 266)
    await mouse('mouseDown', 450, 320); await mouse('mouseMove', 800, 320); await mouse('mouseMove', 450, 320); await mouse('mouseUp', 800, 320); await until(s => !s.submitting)
    const highlighted = await remember('highlight-overlap'), highlightIds = highlighted.strokes.slice(-3).map(s => s.id)
    const layers = await evaluate(`(${JSON.stringify(highlightIds)}).map(id=>[...document.querySelectorAll('[data-shape-id="'+id+'"] svg[data-stroke-layer], [data-renderer-background="'+id+'"] svg[data-stroke-layer]')].map(svg=>({layer:svg.dataset.strokeLayer,opacity:svg.querySelector('g').getAttribute('opacity'),paths:svg.querySelectorAll('[data-stroke-outline]').length})))`)
    check(layers.every(pair => pair.length === 2 && pair.some(p => p.layer === 'background' && p.opacity === '0.82') && pair.some(p => p.layer === 'foreground' && p.opacity === '0.35')), '荧光笔未复用两层透明叠色')
    check(decoded(latest(highlighted)).length === 1, '同一荧光笔划被拆成多条叠色记录')
    await writeFile(join(output, 'draw-highlight.png'), (await contents.capturePage()).toPNG())

    await key('X'); await stroke(950, 200, 1210, 200)
    const framed = await remember('frame-parent'); check(latest(framed).parentId === 'shape:draw-frame', '跨出画框后改变笔画归属')
    const zooms = []
    for (const z of [.5, 1, 2]) {
      await camera(z); await stroke(100, 100, 300, 100)
      const shape = latest(await state()), end = decoded(shape)[0].points.at(-1)
      check(Math.abs(end.x - 200 / z) < .001 && shape.props.scale === 1, '缩放输入坐标换算或scale不正确')
      zooms.push({ zoom: z, span: end.x, scale: shape.props.scale })
    }
    await camera(1)
    await writeFile(join(output, 'draw-final.png'), (await contents.capturePage()).toPNG())
    await writeFile(join(output, 'draw-samples.json'), JSON.stringify(samples, null, 2))
    return { freeStraightFree: true, cancelUndoRedo: true, shiftAppend: true, nativePenPressure: true, nativePenHeights: heights, penModeMouseGateAndExit: true, highlightLayersAndOverlap: true, frameParent: true, zooms }
  } catch (error) {
    await writeFile(join(output, 'draw-failure.json'), JSON.stringify({ message: error.message, samples, state: await state() }, null, 2))
    await writeFile(join(output, 'draw-failure.png'), (await contents.capturePage()).toPNG())
    throw error
  }
}
