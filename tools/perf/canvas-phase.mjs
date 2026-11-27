import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { benchmarkViewport, summarizeFrames, phaseChanged } from './config.mjs'
import { startFrames, stopFrames } from './frame-probe.mjs'
import { assertGesturePreview, assertGestureCommitted } from './gesture-guard.mjs'

export async function waitForSelection(evaluate, probe, fixture) {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    const state = await evaluate(probe.inspectState, fixture)
    if (state.selected && state.selectedIds.length === 1) return
    await delay(20)
  }
  throw new Error(`真实指针未仅选中目标：${fixture.targetId}`)
}

// Same 60Hz native paths and frame statistics for both versions (#47/#64).
// Observe the still-held gesture after stopping its clock, then release it;
// commit work is outside the pointer-move interval in both versions (#100).
export async function measureCanvasPhase({ name, fixture, contents, paints, probe, durationMs, startTrace }) {
  const evaluate = (fn, arg) => contents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`)
  const input = event => contents.sendInputEvent(event)
  const move = (x, y, extra = {}) => input({ type: 'mouseMove', x: Math.round(x), y: Math.round(y), ...extra })
  const button = (type, point, button = 'left') => input({ type, x: Math.round(point.x), y: Math.round(point.y), button, clickCount: 1 })
  await delay(250)
  await evaluate(probe.resetCamera, { camera: fixture.camera })
  const before = await evaluate(probe.inspectState, fixture)
  if (['x', 'y', 'z'].some(key => Math.abs(before.camera[key] - fixture.camera[key]) > 1e-8)) throw new Error('阶段起始视角未正确重置。')
  const point = name === 'drag' ? before.point : { x: benchmarkViewport.width / 2, y: benchmarkViewport.height / 2 }
  move(point.x, point.y)
  // Both reset adapters clear selection. At low zoom a selected small shape's
  // center is inside a resize handle; start from the unselected shape instead.
  if (name === 'drag' && before.selectedIds.length) throw new Error('拖动必须从未选择目标开始。')
  const stopTrace = await startTrace?.()
  let held = false, sampling = false, failure, traceStopped = false
  try {
    const start = performance.now()
    sampling = true; await evaluate(startFrames)
    if (name !== 'zoom') { held = true; button('mouseDown', point, name === 'pan' ? 'middle' : 'left') }
    let inputs = 0, nextInput = start, lastWheel = 0
    while (performance.now() - start < durationMs) {
      const progress = Math.min(1, (performance.now() - start) / durationMs)
      if (name === 'zoom') {
        const wheel = 12 * Math.sin(progress * Math.PI * 4) + 6 * progress
        input({ type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY: wheel - lastWheel, modifiers: ['control'], canScroll: true })
        lastWheel = wheel
      } else move(point.x + progress * 100, point.y + Math.sin(progress * Math.PI / 2) * 70, { button: name === 'pan' ? 'middle' : 'left', modifiers: [name === 'pan' ? 'middleButtonDown' : 'leftButtonDown'] })
      inputs++; nextInput += 1000 / 60
      if (nextInput < performance.now()) nextInput = performance.now() + 1000 / 60
      await delay(Math.max(1, nextInput - performance.now()))
    }
    // Keep #64's pan/zoom clock boundary; only the new drag transaction guard
    // needs an observation while the pointer is still held.
    if (name === 'pan') { button('mouseUp', { x: point.x + 100, y: point.y + 70 }, 'middle'); held = false }
    const frames = await evaluate(stopFrames); sampling = false
    const end = performance.now(), during = await evaluate(probe.inspectState, fixture)
    const editing = fixture.renderer === 'preview' && probe.canDrag
    if (editing) assertGesturePreview(before, during, name)
    if (held) { button('mouseUp', { x: point.x + 100, y: point.y + 70 }, name === 'pan' ? 'middle' : 'left'); held = false }
    let after = await evaluate(probe.inspectState, fixture)
    if (editing && name === 'drag') {
      const deadline = performance.now() + 5000
      while (after.submitting || after.commitCalls === before.commitCalls) {
        if (performance.now() > deadline) throw new Error('松手提交未完成。')
        await delay(20); after = await evaluate(probe.inspectState, fixture)
      }
      assertGestureCommitted(before, after, during, { x: 100 / before.camera.z, y: 70 / before.camera.z })
    }
    if (!phaseChanged(name, before, during, frames.zoomRange)) throw new Error(`${name}没有改变预期状态，拒绝空转FPS。`)
    traceStopped = true
    const trace = await stopTrace?.()
    const result = { raf: summarizeFrames(frames.times, frames.start, frames.end), paint: summarizeFrames(paints, start, end), zoomRange: frames.zoomRange, inputEvents: inputs, before, during, after, trace }
    if (result.raf.frames < 2 || result.paint.frames < 2) throw new Error(`${name}无有效绘制帧。`)
    return result
  } catch (error) { failure = error; throw error } finally {
    const errors = [], clean = async fn => { try { await fn() } catch (error) { errors.push(error) } }
    if (sampling) await clean(() => evaluate(stopFrames))
    if (held) {
      for (const type of ['keyDown', 'keyUp']) await clean(() => input({ type, keyCode: 'Escape' }))
      await clean(() => button('mouseUp', { x: point.x + 100, y: point.y + 70 }, name === 'pan' ? 'middle' : 'left'))
    }
    if (!traceStopped) await clean(async () => { await stopTrace?.() })
    if (!failure && errors.length) throw new AggregateError(errors, '性能手势清理失败。')
  }
}
