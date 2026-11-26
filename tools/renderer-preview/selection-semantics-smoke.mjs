import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { selectionContextSmoke } from './selection-context-smoke.mjs'

const check = (value, message) => { if (!value) throw new Error(message) }
// Native input only; the observation API reads state and resets the camera.
export async function selectionSemanticsSmoke(target, output) {
  const evaluate = code => target.webContents.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const rows = [], remember = async name => { const value = await state(); rows.push({ name, ...value }); return value }
  async function selected(ids) {
    for (let i = 0; i < 100; i++) {
      const s = await state()
      if (JSON.stringify([...s.selectedIds].sort()) === JSON.stringify([...ids].sort())) return s
      await delay(20)
    }
    throw new Error(`选择未到达 ${ids.join(',')}：${JSON.stringify(await state())}`)
  }
  let held = false
  const mouse = async (type, x, y, modifiers = [], clickCount = 1) => {
    if (type === 'mouseDown') held = true
    if (type === 'mouseUp') held = false
    target.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount, modifiers: [...modifiers, ...(held && type === 'mouseMove' ? ['leftButtonDown'] : [])] }); await delay(40)
  }
  const click = async (x, y, modifiers = [], count = 1) => { await mouse('mouseMove', x, y, modifiers, count); await mouse('mouseDown', x, y, modifiers, count); await mouse('mouseUp', x, y, modifiers, count) }
  const key = async (keyCode, modifiers = [], type) => {
    for (const event of type ? [type] : ['keyDown', 'keyUp']) { target.webContents.sendInputEvent({ type: event, keyCode, modifiers }); await delay(30) }
  }
  const action = async name => { const p = await evaluate(`(() => { const r=document.querySelector('[data-action="${name}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2} })()`); await click(Math.round(p.x), Math.round(p.y)) }
  const camera = async value => { await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera(${JSON.stringify(value)});void 0`); await delay(50) }
  const brush = async (a, b, mods = []) => { await mouse('mouseDown', ...a, mods); await mouse('mouseMove', ...b, mods); await mouse('mouseUp', ...b, mods) }
  try {
    await camera({ x: 0, y: 0, z: 1 }); await click(120, 120); const initial = await selected(['shape:a'])
    await click(320, 120, ['shift']); await brush([50, 50], [200, 200], ['shift']); await selected(['shape:a', 'shape:b'])
    await click(120, 120, ['shift']); await selected(['shape:b']); await key('Escape'); await selected([])
    await mouse('mouseDown', 50, 50); await mouse('mouseMove', 120, 120); await selected(['shape:a'])
    await key('Control', ['control'], 'keyDown'); await selected([])
    await key('Control', [], 'keyUp'); await selected(['shape:a']); await mouse('mouseUp', 120, 120)
    await remember('intersection-control-inversion')
    await action('wrap-mode')
    await brush([50, 50], [120, 120]); await selected([])
    await action('wrap-mode')
    await mouse('mouseDown', 50, 130, ['alt']); await mouse('mouseMove', 450, 130, ['alt'])
    await selected(['shape:a', 'shape:b'])
    const trail = await remember('scribble-held')
    check(trail.overlays.some(item => item.kind === 'scribble'), '涂抹轨迹没有交给渲染层')
    await writeFile(join(output, 'scribble-selection.png'), (await target.webContents.capturePage()).toPNG())
    await delay(180)
    const faded = await state(), descriptor = faded.overlays.find(item => item.kind === 'scribble')
    check(descriptor?.points.length === 1 && !faded.needsFrame, '涂抹尾迹没有收成静止圆点并停止帧调度')
    await mouse('mouseUp', 450, 130, ['alt']); await key('Escape'); await selected([])
    await click(620, 320); await selected(['shape:outer']); await key('Return')
    let group = await selected(['shape:e', 'shape:f', 'shape:inner']); check(group.focusedGroupId === 'shape:outer', 'Enter 没进入组')
    await key('a', ['meta']); await selected(['shape:e', 'shape:f', 'shape:inner'])
    await key('Tab'); await selected(['shape:f']); await key('Tab', ['shift']); await selected(['shape:e'])
    await key('Up', ['meta', 'shift']); await selected(['shape:outer'])
    await key('Down', ['meta', 'shift']); await selected(['shape:e'])
    await key('Escape'); await selected(['shape:outer']); await key('Escape'); await selected([])
    await click(620, 320); await click(620, 320)
    group = await selected(['shape:e']); check(group.focusedGroupId === 'shape:outer', '双击未进入所点子形状')
    await key('Escape'); await key('Escape')
    await click(120, 120); await key('Right', ['meta']); await selected(['shape:c']); await key('Up', ['meta']); await selected(['shape:a'])
    await key('Tab'); await selected(['shape:d']); await key('Escape'); await selected([])
    await remember('groups-and-keyboard')
    await mouse('mouseDown', 620, 320); await mouse('mouseMove', 640, 340); await mouse('mouseMove', 620, 320); await mouse('mouseUp', 620, 320)
    await click(620, 320)
    const afterDrag = await selected(['shape:outer']); check(afterDrag.focusedGroupId === 'page:page', '拖动往返后的一次原生点击被误认成双击')
    await key('Escape')
    await camera({ x: -10000, y: -10000, z: 1 })
    await evaluate("document.querySelector('#canvas').focus();void 0")
    await key('Tab')
    check(await evaluate("document.activeElement?.dataset.action === 'first-content'"), 'Tab 未到达跳到画布内容按钮')
    const debuggerApi = target.webContents.debugger; debuggerApi.attach('1.3')
    try {
      await debuggerApi.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
      await debuggerApi.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    } finally { debuggerApi.detach() }
    const first = await selected(['shape:a']); check(first.camera.x === 156 && first.camera.y === 156 && first.camera.z === 1, '跳到内容没有保持比例并移入视口')
    await camera({ x: 0, y: 0, z: 1 }); await mouse('mouseDown', 130, 130); await mouse('mouseMove', 160, 150)
    await key('Shift', ['shift'], 'keyDown'); check((await state()).selectedShapes[0].y === 100, '原生 Shift 没有即时锁轴')
    await key('Shift', [], 'keyUp'); check((await state()).selectedShapes[0].y === 120, '释放 Shift 没恢复自由拖动')
    await key('Escape'); await mouse('mouseUp', 160, 150)
    const final = await remember('cancel-axis-drag')
    check(final.revision === initial.revision && final.snapshotReads === initial.snapshotReads, '纯选择或取消拖动保存了事务／查询整份快照')
    const strokes = []
    for (const z of [.5, 1, 2]) {
      await camera({ x: 0, y: -2000, z })
      await mouse('mouseDown', 300, 300, ['alt']); await mouse('mouseMove', 500, 300, ['alt']); await delay(180)
      const paint = await evaluate("getComputedStyle(document.querySelector('[data-overlay-kind=scribble] path')).stroke.match(/[0-9.]+/g).map(Number)")
      target.webContents.invalidate(); await delay(30)
      const image = await target.webContents.capturePage(), size = image.getSize(), pixels = image.toBitmap(), viewport = await evaluate('innerWidth')
      await writeFile(join(output, `scribble-stroke-${z}.png`), image.toPNG())
      const ratio = size.width / viewport, x = Math.round(500 * ratio), y = Math.round(300 * ratio)
      const values = Array.from({ length: 61 }, (_, i) => { const at = ((y + i - 30) * size.width + x) * 4; return pixels[at] - pixels[at + 2] })
      const background = (values[0] + values.at(-1)) / 2, contrast = (paint[2] - paint[0] - background) * (paint[3] ?? 1)
      check(Math.max(...values) - background > 20, `缩放${z}未画出涂抹末端圆点`)
      const width = values.reduce((sum, value) => sum + Math.max(0, (value - background) / contrast), 0) / ratio
      check(Math.abs(width - 12) < .8, `缩放${z}的涂抹实际直径为${width}px`)
      strokes.push({ zoom: z, screenWidth: width, paint }); await mouse('mouseUp', 500, 300, ['alt'])
    }
    await camera({ x: 0, y: 0, z: 1 })
    await writeFile(join(output, 'scribble-stroke.json'), JSON.stringify(strokes, null, 2))
    await writeFile(join(output, 'selection-semantics.json'), JSON.stringify(rows, null, 2))
    const inputContexts = await selectionContextSmoke(target)
    return { inputContexts, nativeShiftAppendAndToggle: true, controlWrapInversion: true, accumulatedScribbleAndTail: true, groupAndKeyboardScope: true, skipContentNativeTabEnter: true, dynamicAxisCancel: true, clickAfterDragReset: true, revisionUnchanged: true, screenStroke: strokes }
  } catch (error) { await writeFile(join(output, 'selection-semantics-failure.json'), JSON.stringify({ message: error.message, rows, state: await state() }, null, 2)); throw error }
}
