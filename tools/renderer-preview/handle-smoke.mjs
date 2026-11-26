import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const check = (value, message) => { if (!value) throw new Error(message) }
const near = (a, b) => Math.abs(a - b) < .001

// Native events enter the same preview shell as a mouse/keyboard. Observation
// is read-only; this probe never reads a Store or calls editing commands.
export async function handleSmoke(target, output) {
  const contents = target.webContents, evaluate = code => contents.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
  const until = async predicate => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await delay(30) }
    throw new Error('手柄操作等待超时。')
  }
  let held = false, commitRequests = 0
  // Count actual host writes, including accidental commits while dragging.
  const requests = details => { if (new URL(details.url).pathname === '/__interaction/commit') commitRequests++ }
  contents.session.webRequest.onSendHeaders(requests)
  const pointer = async (type, x, y, modifiers = []) => {
    if (type === 'mouseDown') held = true
    contents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers: [...modifiers, ...(type === 'mouseMove' && held ? ['leftButtonDown'] : [])] })
    if (type === 'mouseUp') held = false
    await delay(40)
  }
  const key = async (keyCode, modifiers = []) => { for (const type of ['keyDown', 'keyUp']) contents.sendInputEvent({ type, keyCode, modifiers }); await delay(50) }
  const selected = async () => until(async () => { const s = await state(); return s.selectedIds.length === 1 && s.selectedIds[0] === 'shape:perf-0' && s })
  try {
  await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:100,y:100,z:1});void 0')
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) await pointer(type, 140, 140)
  const initial = await selected(), start = initial.selectedShapes[0], revision = initial.revision
  check(start.w === 96 && start.h === 72, '手柄探针需要全新合成画板')
  const paint = []
  for (const z of [.25, 1, 2, 8]) {
    await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:${120 / z},y:${120 / z},z:${z}});void 0`)
    await delay(80)
    const style = await evaluate(`(()=>{const e=document.querySelector('[data-selection-handle=top_left]'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {w:r.width,h:r.height,border:s.borderTopWidth,color:s.borderTopColor,fill:s.backgroundColor,count:document.querySelectorAll('[data-selection-handle]').length}})()`)
    check(near(style.w, 10) && near(style.h, 10) && style.border === '2px' && style.color === 'rgb(47, 128, 237)' && style.fill === 'rgb(255, 255, 255)' && style.count === 4, `手柄尺寸/令牌错误：${JSON.stringify(style)}`)
    // DOM and compositing finish on different frames in offscreen Chromium.
    // Wait for the actual paint, then assert pixels; never accept CSS alone.
    let image
    await until(async () => {
      image = await contents.capturePage()
      const pixels = image.toBitmap(), width = image.getSize().width, ratio = width / 1280
      const color = (x, y) => { const at = (Math.round(y * ratio) * width + Math.round(x * ratio)) * 4; return [pixels[at + 2], pixels[at + 1], pixels[at]] }
      return color(120, 120).every(v => v > 245) && color(116, 120)[2] - color(116, 120)[0] > 100
    })
    paint.push({ zoom: z, ...style }); await writeFile(join(output, `handles-${z}.png`), image.toPNG())
  }
  await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:100,y:100,z:1});void 0')
  await pointer('mouseMove', 196, 172); await pointer('mouseDown', 196, 172)
  await pointer('mouseMove', 216, 182); await pointer('mouseMove', 236, 202)
  let s = await state()
  check(s.mode === 'resizing' && s.selectedShapes[0].w === 136 && s.selectedShapes[0].h === 102 && commitRequests === 0, '角点预览不正确或提前保存')
  check(s.snapshotReads === initial.snapshotReads, '手柄帧读取完整快照')
  await key('Escape'); await pointer('mouseUp', 236, 202)
  check((await state()).selectedShapes[0].w === 96 && (await state()).revision === revision && commitRequests === 0, 'Esc未恢复手柄预览')
  await pointer('mouseMove', 196, 172); await pointer('mouseDown', 196, 172)
  await pointer('mouseMove', 236, 202); await pointer('mouseUp', 236, 202)
  s = await until(async () => { const v = await state(); return !v.submitting && v.revision !== revision && v })
  check(s.selectedShapes[0].w === 136 && commitRequests === 1, '一次手柄拖动没有恰好保存一次')
  await key('z', ['meta']); await until(async () => (await state()).selectedShapes[0].w === 96)
  await pointer('mouseMove', 196, 172); await pointer('mouseDown', 196, 172)
  await pointer('mouseMove', 236, 182, ['shift', 'alt'])
  s = await state(); check(s.selectedShapes[0].w === 176 && s.selectedShapes[0].h === 132 && s.selectedShapes[0].x === -40 && s.selectedShapes[0].y === -30, '原生Shift/Alt未从中心统一比例缩放')
  await key('Escape'); await pointer('mouseUp', 236, 182)
  await pointer('mouseMove', 203, 179); await pointer('mouseDown', 203, 179)
  await pointer('mouseMove', 174, 201, ['shift']); await pointer('mouseUp', 174, 201, ['shift'])
  s = await until(async () => { const v = await state(); return !v.submitting && near(v.selectedShapes[0].rotation, Math.PI / 6) && v })
  check(commitRequests === 2, '旋转没有恰好保存一个事务')
  await writeFile(join(output, 'handles-rotated.png'), (await contents.capturePage()).toPNG())
  await key('z', ['meta']); await until(async () => near((await state()).selectedShapes[0].rotation, 0))
  const reloaded = new Promise(resolve => contents.once('did-finish-load', resolve))
  contents.reload(); await reloaded; await until(async () => { const v = await state(); return v?.ready })
  await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:100,y:100,z:1});void 0')
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) await pointer(type, 140, 140)
  s = await selected(); check(s.selectedShapes[0].w === start.w && near(s.selectedShapes[0].rotation, 0) && !s.lastError, '真实撤销后的磁盘数据/刷新恢复错误')
  return { nativeResizeEscapeShiftAltRotate: true, commitRequests, actorUndoAndReload: true, snapshotReadsDuringPreview: 0, paint }
  } finally { contents.session.webRequest.onSendHeaders(null) }
}
