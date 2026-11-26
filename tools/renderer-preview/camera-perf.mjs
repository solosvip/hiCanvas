import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { pageObserver, cameraReaderScript } from '../perf/observers.mjs'
import { startFrames, stopFrames } from '../perf/frame-probe.mjs'
import { summarizeFrames } from '../perf/config.mjs'

// #85: same native 60Hz trajectories for both editors. Unlike #64's middle-pan
// and fixed-anchor wheel workload, this measures H hand-pan and a moving pinch
// center. Archived #64 FPS is context, not an acceptance baseline. One wheel
// stream avoids Chromium coalescing interleaved plain/Ctrl modifier streams.
export async function measureCameraNavigation(target, { camera, renderer, durationMs = 2500 }) {
  const contents = target.webContents, observer = pageObserver(renderer)
  const evaluate = async (fn, arg) => contents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`)
  const input = event => contents.sendInputEvent(event)
  const paints = [], onPaint = () => paints.push(performance.now())
  const state = renderer === 'preview' ? () => contents.executeJavaScript('window.__HICANVAS_RENDERER_PREVIEW__.getState()') : null
  await contents.executeJavaScript(cameraReaderScript(observer))
  let framesRunning = false, handDown = false
  contents.on('paint', onPaint)
  try {
    const result = {}
    for (const phase of ['hand', 'pinch']) {
      await evaluate(observer.resetCamera, { camera }); await delay(100)
      input({ type: 'keyDown', keyCode: phase === 'hand' ? 'h' : 'v' }); input({ type: 'keyUp', keyCode: phase === 'hand' ? 'h' : 'v' }); await delay(100)
      const before = await evaluate(observer.getCamera), guard = await state?.()
      input({ type: 'mouseMove', x: 640, y: 400 })
      await evaluate(startFrames); framesRunning = true
      const started = performance.now()
      if (phase === 'hand') { input({ type: 'mouseDown', x: 640, y: 400, button: 'left', clickCount: 1 }); handDown = true }
      let next = started, inputs = 0, previousWheel = 0
      while (performance.now() - started < durationMs) {
        const progress = Math.min(1, (performance.now() - started) / durationMs)
        if (phase === 'hand') input({ type: 'mouseMove', x: Math.round(640 + progress * 100), y: Math.round(400 + Math.sin(progress * Math.PI / 2) * 70), button: 'left', modifiers: ['leftButtonDown'] })
        else {
          const wheel = 12 * Math.sin(progress * Math.PI * 4) + 6 * progress
          input({ type: 'mouseWheel', x: Math.round(640 + 100 * progress), y: Math.round(400 + 70 * progress), deltaX: 0, deltaY: wheel - previousWheel, modifiers: ['control'], canScroll: true })
          previousWheel = wheel
        }
        inputs++; next += 1000 / 60
        if (next < performance.now()) next = performance.now() + 1000 / 60
        await delay(Math.max(1, next - performance.now()))
      }
      const ended = performance.now(), frames = await evaluate(stopFrames), after = await evaluate(observer.getCamera)
      framesRunning = false
      if (phase === 'hand') { input({ type: 'mouseUp', x: 740, y: 470, button: 'left', clickCount: 1 }); handDown = false }
      if (Math.abs(after.x - before.x) < 1 || phase === 'pinch' && frames.zoomRange.max - frames.zoomRange.min < .001) throw new Error('视角性能输入未改变实际相机，拒绝空转 FPS。')
      const final = await state?.()
      if (guard && (guard.snapshotReads !== final.snapshotReads || guard.revision !== final.revision || final.toolId !== (phase === 'hand' ? 'hand' : 'select'))) throw new Error('视角工作负载读全板、保存记录或没有切换正确工具。')
      result[phase] = { raf: summarizeFrames(frames.times, frames.start, frames.end), paint: summarizeFrames(paints, started, ended), inputs, before, after, zoomRange: frames.zoomRange, snapshotReads: final ? final.snapshotReads - guard.snapshotReads : null }
      if (result[phase].raf.frames < 2 || result[phase].paint.frames < 2) throw new Error('视角性能采样缺少有效绘制帧。')
      await evaluate(observer.resetCamera, { camera })
    }
    return result
  } finally {
    if (framesRunning) await evaluate(stopFrames).catch(() => {})
    try { if (handDown) input({ type: 'mouseUp', x: 740, y: 470, button: 'left', clickCount: 1 }) } catch { /* A crashed target is already gone. */ }
    await evaluate(observer.resetCamera, { camera }).catch(() => {})
    contents.removeListener('paint', onPaint)
  }
}
