import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { startFrames, stopFrames } from '../perf/frame-probe.mjs'
import { summarizeFrames } from '../perf/config.mjs'

// Both renderers receive the same selected 96×72 target at fit-all zoom and the
// same 60Hz corner path. The full 5000-shape document remains mounted/decoded.
// The start point sits 5px outside its bottom-right corner to avoid overlap
// between corner hit areas at low zoom.
export async function measureSelectionHandles(target, { renderer, camera, targetId = 'shape:perf-4999', durationMs = 3000, cornerOffset = 5 }) {
  const contents = target.webContents, evaluate = code => contents.executeJavaScript(code)
  const legacy = renderer === 'legacy', paints = []
  const read = () => evaluate(legacy
    ? `(()=>{const e=window.__cowartEditor,s=e.getShape(${JSON.stringify(targetId)});return {selected:e.getSelectedShapeIds(),w:s.props.w,h:s.props.h,x:s.x,y:s.y,camera:e.getCamera(),mode:e.root.getPath()}})()`
    : `(()=>{const s=window.__HICANVAS_RENDERER_PREVIEW__.getState(),r=s.selectedShapes[0];return {selected:s.selectedIds,w:r?.w,h:r?.h,x:r?.x,y:r?.y,camera:s.camera,mode:s.mode,snapshotReads:s.snapshotReads,revision:s.revision,commitCalls:s.commitCalls}})()`)
  const move = (x, y, held = false) => contents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y), ...(held && { button: 'left', modifiers: ['leftButtonDown'] }) })
  const button = (type, x, y) => contents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 })
  const x = Math.round(640 + 48 * camera.z + cornerOffset), y = Math.round(400 + 36 * camera.z + cornerOffset)
  const paint = () => paints.push(performance.now())
  if (!legacy) await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera(${JSON.stringify(camera)});void 0`)
  await evaluate(`window.__hiCanvasPerfCamera=()=>${legacy ? 'window.__cowartEditor.getCamera()' : 'window.__HICANVAS_RENDERER_PREVIEW__.getCamera()'};void 0`)
  await delay(150)
  move(640, 400); button('mouseDown', 640, 400); button('mouseUp', 640, 400); await delay(150)
  move(x, y); await delay(150)
  const before = await read()
  if (before.selected.length !== 1 || before.selected[0] !== targetId || before.w !== 96 || before.h !== 72 || before.camera.z !== camera.z) throw new Error(`手柄对照起点错误：${JSON.stringify(before)}`)
  if (!before.mode.endsWith('idle')) throw new Error(`手柄按下前未处于空闲选择状态：${before.mode}`)
  for (const key of ['x', 'y', 'z']) if (Math.abs(before.camera[key] - camera[key]) > 1e-7) throw new Error('新旧手柄相机不一致。')
  contents.on('paint', paint)
  let sampling = false, failure = null
  try {
    sampling = true
    await evaluate(`(${startFrames.toString()})()`)
    const start = performance.now(); let next = start, inputEvents = 0
    button('mouseDown', x, y)
    while (performance.now() - start < durationMs) {
      const progress = Math.min(1, (performance.now() - start) / durationMs)
      move(x + progress * 40, y + progress * 30, true); inputEvents++; next += 1000 / 60
      if (next < performance.now()) next = performance.now() + 1000 / 60
      await delay(Math.max(1, next - performance.now()))
    }
    const frames = await evaluate(`(${stopFrames.toString()})()`)
    sampling = false
    const end = performance.now(), after = await read()
    if (after.w <= before.w || after.h <= before.h || Math.abs(after.x - before.x) > .001 || Math.abs(after.y - before.y) > .001 || !after.mode.includes('resiz')) throw new Error(`原生输入没有缩放所选目标：${JSON.stringify({ before, after, pointer: { x, y } })}`)
    if (!legacy && after.snapshotReads !== before.snapshotReads) throw new Error('手柄帧读取了完整快照。')
    if (!legacy && (after.revision !== before.revision || after.commitCalls !== before.commitCalls)) throw new Error('手柄移动途中发生提交。')
    const result = { before, after, inputEvents, raf: summarizeFrames(frames.times, frames.start, frames.end), paint: summarizeFrames(paints, start, end), snapshotsDuringPointer: legacy ? null : after.snapshotReads - before.snapshotReads }
    if (['raf', 'paint'].some(kind => result[kind].frames < 2 || !Number.isFinite(result[kind].fps) || result[kind].fps <= 0)) throw new Error('手柄无有效绘制帧。')
    return result
  } catch (error) { failure = error; throw error } finally {
    contents.removeListener('paint', paint)
    const errors = [], clean = async task => { try { await task() } catch (error) { errors.push(error) } }
    if (sampling) await clean(() => evaluate(`(${stopFrames.toString()})()`))
    for (const type of ['keyDown', 'keyUp']) await clean(() => contents.sendInputEvent({ type, keyCode: 'Escape' }))
    await clean(() => button('mouseUp', x + 40, y + 30)); await delay(150)
    if (!failure && errors.length) throw new AggregateError(errors, '手柄测量清理失败。')
  }
}
