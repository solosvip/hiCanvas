import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const check = (value, message) => { if (!value) throw new Error(message) }
const until = async predicate => {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await delay(20) }
  throw new Error('选择工具状态等待超时。')
}

// Check painted pixels, not just CSS: scaling an SVG in an HTML wrapper can
// keep its computed stroke at 2px while visibly scaling that stroke as well.
async function screenStrokeProbe(target, output) {
  const evaluate = code => target.webContents.executeJavaScript(code), measurements = []
  const original = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getCamera()')
  const selected = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState().selectedShapes[0]')
  const visibility = await evaluate("document.querySelector('[data-renderer-world]').style.visibility")
  try {
    await evaluate("document.querySelector('[data-renderer-world]').style.visibility='hidden'")
    for (const z of [.1, .5, 1, 1.5, 2, 8]) {
      await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:${30 / z - selected.x},y:${120 / z - selected.y},z:${z}});void 0`)
      await delay(80)
      const box = await evaluate(`(() => {const element=document.querySelector('[data-overlay-kind=selection]');const r=element.getBoundingClientRect();const rgb=getComputedStyle(element.querySelector('[data-overlay-stroke=top]')).backgroundColor.match(/[0-9.]+/g).map(Number);return{x:r.x+r.width/2,y:r.y,viewport:innerWidth,paintContrast:rgb[2]-rgb[0]}})()`)
      const image = await target.webContents.capturePage(), size = image.getSize(), pixels = image.toBitmap()
      await writeFile(join(output, `selection-stroke-${z}.png`), image.toPNG())
      const ratio = size.width / box.viewport, x = Math.round(box.x * ratio), y = Math.round(box.y * ratio)
      const contrasts = Array.from({ length: 25 }, (_, i) => { const offset = ((y + i - 12) * size.width + x) * 4; return pixels[offset] - pixels[offset + 2] })
      const background = (contrasts[0] + contrasts.at(-1)) / 2, maximum = Math.max(...contrasts)
      check(maximum - background > 100, `缩放 ${z} 的截图中未画出蓝色选择边线：${maximum - background}`)
      // Integrate coverage against the full paint color. Using the darkest
      // sampled pixel as 100% would mistake fractional-pixel blur for extra width.
      const width = contrasts.reduce((sum, contrast) => sum + Math.max(0, (contrast - background) / (box.paintContrast - background)), 0) / ratio
      check(Math.abs(width - 2) < .4, `缩放 ${z} 的实际选择线宽为 ${width}px`)
      measurements.push({ zoom: z, screenStroke: width })
    }
    return measurements
  } finally {
    await evaluate(`document.querySelector('[data-renderer-world]').style.visibility=${JSON.stringify(visibility)};window.__HICANVAS_RENDERER_PREVIEW__.resetCamera(${JSON.stringify(original)});void 0`)
    await delay(30)
  }
}

// Extends the existing offscreen renderer harness with native input; it never
// accesses a Store or bypasses the shell's event translation.
export async function selectionSmoke(target, output, { persistent = false } = {}) {
  const evaluate = code => target.webContents.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
  const pointer = async (type, x, y, shift = false) => {
    target.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers: [...(shift ? ['shift'] : []), ...(type === 'mouseMove' ? ['leftButtonDown'] : [])] })
    await delay(30)
  }
  const click = async (x, y, shift = false) => { await pointer('mouseMove', x, y, shift); await pointer('mouseDown', x, y, shift); await pointer('mouseUp', x, y, shift) }
  const selected = ids => until(async () => { const value = await state(); return JSON.stringify([...value.selectedIds].sort()) === JSON.stringify([...ids].sort()) && value })
  await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:100,y:100,z:1});void 0')
  await click(140, 140)
  const initial = await selected(['shape:perf-0'])
  const style = await evaluate(`(() => {const r=document.querySelector('[data-overlay-kind="selection"]');const s=getComputedStyle(r.querySelector('[data-overlay-stroke=top]'));return {stroke:s.backgroundColor,width:s.height,box:{x:r.getBoundingClientRect().x,y:r.getBoundingClientRect().y,w:r.getBoundingClientRect().width,h:r.getBoundingClientRect().height}}})()`)
  check(style.stroke === 'rgb(47, 128, 237)' && style.width === '2px', `选择覆盖层令牌未生效：${JSON.stringify(style)}`)
  check(style.box.x === 100 && style.box.y === 100 && style.box.w === 96, '覆盖层位置与形状不符')
  await writeFile(join(output, 'selection.png'), (await target.webContents.capturePage()).toPNG())
  await click(268, 140, true); await selected(['shape:perf-0', 'shape:perf-1'])
  await click(140, 140, true); await selected(['shape:perf-1'])
  await click(50, 500); await selected([])
  await pointer('mouseDown', 30, 80); await pointer('mouseMove', 120, 120)
  await selected(['shape:perf-0'])
  const brush = await evaluate(`(() => {const r=document.querySelector('[data-overlay-kind="marquee"]');const s=getComputedStyle(r.querySelector('[data-overlay-stroke=top]'));return {stroke:s.backgroundColor,fill:getComputedStyle(r).backgroundColor,width:s.height}})()`)
  check(brush.width === '1px' && Math.abs(Number(brush.fill.match(/,\s*([\d.]+)\)$/)?.[1]) - 10 / 255) < .005 && Math.abs(Number(brush.stroke.match(/,\s*([\d.]+)\)$/)?.[1]) - 26 / 255) < .005, `框选令牌未生效：${JSON.stringify(brush)}`)
  await writeFile(join(output, 'marquee.png'), (await target.webContents.capturePage()).toPNG())
  await pointer('mouseUp', 120, 120)
  check((await state()).revision === initial.revision, '点选或框选被保存为事务')
  await pointer('mouseDown', 140, 140); await pointer('mouseMove', 143, 140)
  check((await state()).selectedShapes[0].x === 0, '阈值内不应移动')
  await pointer('mouseMove', 190, 165)
  const preview = await state()
  check(preview.mode === 'dragging' && preview.selectedShapes[0].x === 50 && preview.selectedShapes[0].y === 25, '真实拖动没有跟手')
  check(preview.snapshotReads === initial.snapshotReads, '指针移动读取了完整快照')
  target.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); target.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await until(async () => (await state()).mode === 'idle')
  await pointer('mouseUp', 190, 165)
  check((await state()).selectedShapes[0].x === 0 && (await state()).revision === initial.revision, 'Esc 没有取消预览')
  await pointer('mouseDown', 140, 140); await pointer('mouseMove', 160, 150); await pointer('mouseMove', 190, 165); await pointer('mouseUp', 190, 165)
  const saved = await until(async () => { const s = await state(); return !s.submitting && s.revision !== initial.revision && s })
  check(saved.selectedShapes[0].x === 50 && saved.selectedShapes[0].y === 25, '松手后的保存位置错误')
  check(!saved.lastError, `保存错误：${JSON.stringify(saved.lastError)}`)
  const screenStroke = await screenStrokeProbe(target, output)
  await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:100,y:100,z:.5});void 0')
  await delay(50)
  check(await evaluate("getComputedStyle(document.querySelector('[data-overlay-kind=selection] [data-overlay-stroke=top]')).height") === '2px', '缩放改变了选择线宽令牌')
  target.setContentSize(640, 480); await delay(50)
  await writeFile(join(output, 'selection-narrow.png'), (await target.webContents.capturePage()).toPNG())
  target.setContentSize(1280, 800)
  if (persistent) {
    await delay(250)
    const reloaded = new Promise(resolve => target.webContents.once('did-finish-load', resolve))
    target.webContents.reload(); await reloaded
    const loaded = await until(async () => { const s = await state(); return s?.ready && s })
    const c = loaded.camera
    await click(Math.round((50 + 40 + c.x) * c.z), Math.round((25 + 40 + c.y) * c.z))
    const restored = await selected(['shape:perf-0'])
    check(restored.selectedShapes[0].x === 50 && restored.selectedShapes[0].y === 25, '刷新后位置没有恢复')
  }
  return { nativeClickShiftClearMarquee: true, thresholdAndEscape: true, previewWithoutSnapshots: true, committedPosition: saved.selectedShapes[0], overlayStyle: style, brushStyle: brush, screenStroke, narrowViewport: true, refreshPersistence: persistent }
}
