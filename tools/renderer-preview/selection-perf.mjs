import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { startFrames, stopFrames } from '../perf/frame-probe.mjs'
import { summarizeFrames } from '../perf/config.mjs'
import { getCamera } from '../perf/renderer-probe.mjs'

// #47's frame clock, statistics and native 60 Hz input, with only the workload
// replaced by selection hover / drag. The observation hook never exposes Store.
export async function measureSelectionPointer(target, durationMs = 3000) {
  const evaluate = (fn, value) => target.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(value)})`)
  const read = () => target.webContents.executeJavaScript('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  await target.webContents.executeJavaScript(`window.__hiCanvasPerfCamera = (${getCamera.toString()}); void 0`)
  const paints = []
  const paint = () => paints.push(performance.now())
  target.webContents.on('paint', paint)
  const move = (x, y, drag = false) => target.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y), ...(drag && { button: 'left', modifiers: ['leftButtonDown'] }) })
  const button = (type, x, y) => target.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
  const result = {}
  try {
    for (const phase of ['hover', 'drag']) {
      const x = phase === 'hover' ? 240 : 640, y = 400
      move(x, y); await delay(80)
      if (phase === 'drag') { button('mouseDown', x, y); button('mouseUp', x, y); await delay(80) }
      const before = await read()
      if (phase === 'drag' && !before.selectedIds.includes('shape:perf-4999')) throw new Error('5000 档拖动未命中预置顶层目标。')
      paints.length = 0
      const start = performance.now()
      await evaluate(startFrames)
      if (phase === 'drag') button('mouseDown', x, y)
      let inputs = 0, next = start
      while (performance.now() - start < durationMs) {
        const progress = Math.min(1, (performance.now() - start) / durationMs)
        move(x + progress * (phase === 'hover' ? 400 : 100), y + Math.sin(progress * Math.PI / 2) * (phase === 'hover' ? 0 : 70), phase === 'drag')
        inputs++; next += 1000 / 60
        if (next < performance.now()) next = performance.now() + 1000 / 60
        await delay(Math.max(1, next - performance.now()))
      }
      const frames = await evaluate(stopFrames), end = performance.now(), after = await read()
      if (after.snapshotReads !== before.snapshotReads) throw new Error(`${phase} 指针帧取了完整快照。`)
      if (phase === 'hover' && !after.hoveredId) throw new Error('5000 档悬停未命中任何真实目标，拒绝报告空转帧率。')
      if (phase === 'drag' && after.selectedShapes[0]?.x === before.selectedShapes[0]?.x) throw new Error('5000 档真实拖动没有改变形状位置。')
      result[phase] = { raf: summarizeFrames(frames.times, frames.start, frames.end), paint: summarizeFrames(paints, start, end), inputEvents: inputs, snapshotsDuringPointer: after.snapshotReads - before.snapshotReads, before, after }
      if (phase === 'drag') {
        button('mouseUp', x + 100, y + 70)
        const deadline = Date.now() + 10000
        while ((await read()).submitting && Date.now() < deadline) await delay(30)
      }
      await delay(100)
    }
    return result
  } finally { target.webContents.removeListener('paint', paint) }
}
