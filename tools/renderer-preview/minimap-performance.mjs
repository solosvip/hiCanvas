import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { startFrames, stopFrames } from '../perf/frame-probe.mjs'
import { summarizeFrames } from '../perf/config.mjs'

// New #98 workload, read-only reuse of the shared timing helpers. Same window,
// same 5000 fixture/camera/input: alternate closed/open, then open/closed, then
// closed/open. No screenshots or other workloads run during these intervals.
export async function measureMinimapPerformance(contents, { durationMs = 4000 } = {}) {
  const evaluate = code => contents.executeJavaScript(code), samples = []
  const camera = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getCamera()')
  const native = event => contents.sendInputEvent(event)
  async function toggle(open) {
    const current = await evaluate('!!window.__HICANVAS_RENDERER_PREVIEW__.getState().minimap')
    if (current === open) return
    const p = await evaluate(`(()=>{const b=document.querySelector('[data-action="minimap"]').getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`)
    native({ type: 'mouseMove', ...p })
    for (const type of ['mouseDown', 'mouseUp']) native({ type, ...p, button: 'left', clickCount: 1 })
    await delay(100)
    if (await evaluate('!!window.__HICANVAS_RENDERER_PREVIEW__.getState().minimap') !== open) throw new Error('性能对照没有成功开关小地图。')
  }
  for (let round = 0; round < 3; round++) for (const open of round % 2 ? [true, false] : [false, true]) {
    await toggle(open)
    for (const phase of ['pan', 'zoom']) {
      await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera(${JSON.stringify(camera)});window.__hiCanvasPerfCamera=()=>window.__HICANVAS_RENDERER_PREVIEW__.getCamera();void 0`)
      await delay(200)
      const before = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()'), paints = [], paint = () => paints.push(performance.now())
      contents.on('paint', paint)
      let inputEvents = 0, sampling = false
      try {
        await evaluate(`(${startFrames.toString()})()`); sampling = true
        const start = performance.now(); let next = start, wheel = 0
        native({ type: 'mouseMove', x: 640, y: 400 })
        if (phase === 'pan') native({ type: 'mouseDown', x: 640, y: 400, button: 'middle', clickCount: 1 })
        while (performance.now() - start < durationMs) {
          const p = Math.min(1, (performance.now() - start) / durationMs)
          if (phase === 'pan') native({ type: 'mouseMove', x: Math.round(640 + p * 100), y: Math.round(400 + Math.sin(p * Math.PI / 2) * 70), button: 'middle', modifiers: ['middleButtonDown'] })
          else {
            const total = 12 * Math.sin(p * Math.PI * 4) + 6 * p
            native({ type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: total - wheel, modifiers: ['control'], canScroll: true }); wheel = total
          }
          inputEvents++; next += 1000 / 60
          if (next < performance.now()) next = performance.now() + 1000 / 60
          await delay(Math.max(1, next - performance.now()))
        }
        const frames = await evaluate(`(${stopFrames.toString()})()`); sampling = false
        const end = performance.now(), after = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
        if (phase === 'pan' ? after.camera.x === before.camera.x || after.camera.y === before.camera.y : frames.zoomRange.min === frames.zoomRange.max) throw new Error('性能输入没有改变相机，拒绝空转帧率。')
        if (after.revision !== before.revision || after.snapshotReads !== before.snapshotReads) throw new Error('相机性能输入触发文档变化或整板快照读取。')
        const raf = summarizeFrames(frames.times, frames.start, frames.end), paintFrames = summarizeFrames(paints, start, end)
        if (raf.frames < 2 || paintFrames.frames < 2) throw new Error('小地图性能缺少实际绘制帧。')
        samples.push({ round, open, phase, inputEvents, before: before.camera, after: after.camera, raf, paint: paintFrames, zoomRange: frames.zoomRange })
      } finally {
        contents.removeListener('paint', paint)
        if (sampling) await evaluate(`(${stopFrames.toString()})()`)
        if (phase === 'pan') native({ type: 'mouseUp', x: 740, y: 470, button: 'middle', clickCount: 1 })
      }
    }
  }
  await toggle(false)
  return samples
}
