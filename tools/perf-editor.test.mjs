import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { parseOptions } from './perf/config.mjs'
import { pageObserver } from './perf/observers.mjs'
import { memoryTransport } from './renderer-preview/transport.js'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction } from '../engine/index.js'
import { observeEditorTarget } from './perf/editor-observation.js'
import { createFixture } from './perf/fixture.mjs'
import { assertGesturePreview, assertGestureCommitted } from './perf/gesture-guard.mjs'
import { comparisonSummary, isFormalComparison } from './perf/comparison.mjs'
import { measurementPlan } from './perf/config.mjs'
import { measureCanvasPhase } from './perf/canvas-phase.mjs'

test('通用对照默认观察真实编辑器，兼容观察模式仍明确不测拖动', () => {
  assert.equal(pageObserver('preview').canDrag, true)
  assert.equal(pageObserver('preview').requiresSelection, true)
  assert.equal(pageObserver('preview', 'renderer').canDrag, false)
  const camera = { x: 1, y: 2, z: .5 }, shape = { x: 10, y: 20, w: 96, h: 72 }
  const value = runInNewContext(`(${pageObserver('preview').inspectState})({targetId:'shape:test'})`, {
    window: { __HICANVAS_RENDERER_PREVIEW__: { inspectTarget(id) {
      assert.equal(id, 'shape:test'); return { camera, shape, selectedIds: [id], revision: '0', commitCalls: 0, transport: 'memory', mode: 'idle' }
    } } }
  })
  assert.equal(value.shape, shape)
  assert.equal(value.selected, true)
  assert.equal(value.point.x, (shape.x + 48 + camera.x) * camera.z)
})

test('合成内存transport的只读提交计数覆盖真实提交调用', async () => {
  const transport = memoryTransport(createCanvasSnapshot())
  assert.equal(transport.getCommitCount(), 0)
  const before = await transport.read()
  await transport.commit({ expectedRevision: before.revision, commands: [{ type: 'create_shape', id: 'shape:test', shapeType: 'geo' }], actor: 'test' })
  assert.equal(transport.getCommitCount(), 1)
  await assert.rejects(transport.commit({ expectedRevision: before.revision, commands: [], actor: 'test' }), /版本/)
  assert.equal(transport.getCommitCount(), 2, '失败的提前提交尝试也必须被计数')
})

test('编辑/兼容协议和手柄单项有明确参数，拒绝不能缩放的兼容组合', () => {
  const args = ['--port', '43392', '--renderer', 'both', '--preview-port', '43393']
  assert.equal(parseOptions(args, {}).previewMode, 'editor')
  assert.equal(parseOptions([...args, '--preview-mode', 'renderer'], {}).previewMode, 'renderer')
  assert.equal(parseOptions([...args, '--workload', 'handles', '--sizes', '5000'], {}).workload, 'handles')
  assert.throws(() => parseOptions([...args, '--workload', 'handles'], {}), /5000/)
  assert.throws(() => parseOptions([...args, '--preview-mode', 'renderer', '--workload', 'handles', '--sizes', '5000'], {}), /编辑/)
})

test('手柄相机使同一96×72目标两边均至少100屏幕像素，不改图鉴', async () => {
  const { handleCamera } = await import('./perf/handle-camera.mjs')
  const box = { x: 4000, y: 3000, w: 96, h: 72 }, copy = structuredClone(box)
  const camera = handleCamera(box)
  assert.ok(box.w * camera.z >= 100 && box.h * camera.z >= 100)
  assert.ok(Math.abs((box.x + box.w / 2 + camera.x) * camera.z - 640) < 1e-8)
  assert.ok(Math.abs((box.y + box.h / 2 + camera.y) * camera.z - 400) < 1e-8)
  assert.deepEqual(box, copy)
  for (const w of [0, -1, NaN]) assert.throws(() => handleCamera({ ...box, w }))
})

test('真实编辑层拖动途中只改工作副本，观察不取快照，松手整次提交并能撤销', async () => {
  const f = createFixture(10), transport = memoryTransport(f.snapshot)
  const session = await createEditorSession({ transport, actor: 'performance-regression' })
  const interaction = createCanvasInteraction({ session, camera: f.viewState.camera, viewport: { w: 1280, h: 800 } })
  let snapshots = 0
  const snapshot = session.store.getStoreSnapshot.bind(session.store)
  session.store.getStoreSnapshot = (...args) => { snapshots++; return snapshot(...args) }
  try {
    const before = observeEditorTarget(session, interaction, transport, f.targetId, snapshots)
    const event = (type, x, y, time) => interaction.dispatch({ type, point: { x, y }, time, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointer_up' ? 0 : 1 })
    await event('pointer_down', 640, 400, 100)
    await event('pointer_move', 670, 430, 120)
    await event('pointer_move', 740, 470, 140)
    const during = observeEditorTarget(session, interaction, transport, f.targetId, snapshots)
    assert.equal(during.mode, 'dragging')
    assert.equal(during.commitCalls, 0)
    assert.equal(during.revision, before.revision)
    assert.equal(snapshots, 0)
    assert.ok(during.shape.x > before.shape.x)
    assert.equal((await transport.read()).snapshot.store[f.targetId].x, before.shape.x)
    await event('pointer_up', 740, 470, 160)
    const after = observeEditorTarget(session, interaction, transport, f.targetId, snapshots)
    assert.equal(after.commitCalls, 1)
    assert.notEqual(after.revision, before.revision)
    assert.equal(after.mode, 'idle')
    assert.equal((await transport.read()).snapshot.store[f.targetId].x, after.shape.x)
    after.shape.x = -999
    assert.notEqual(session.store.get(f.targetId).x, -999)
    await session.undo()
    assert.equal(session.store.get(f.targetId).x, before.shape.x)
  } finally { interaction.dispose(); session.dispose() }
})

test('原生手势守卫拒绝途中提交/整板读取/缩放伪装拖动，松手必须一次提交', () => {
  const before = { transport: 'memory', commitCalls: 0, revision: '0', snapshotReads: 0, shape: { x: 0, y: 0, w: 96, h: 72, rotation: 0 } }
  const during = { ...before, shape: { ...before.shape, x: 100 }, mode: 'dragging', selected: true, selectedIds: ['shape:test'] }
  assert.doesNotThrow(() => assertGesturePreview(before, during, 'drag'))
  for (const patch of [{ commitCalls: 1 }, { revision: '1' }, { submitting: true }, { snapshotReads: 1 }, { mode: 'resizing' }, { selectedIds: [] }, { shape: { ...during.shape, w: 100 } }]) {
    assert.throws(() => assertGesturePreview(before, { ...during, ...patch }, 'drag'))
  }
  assert.throws(() => assertGesturePreview(before, during, 'pan'), /移动/)
  const after = { ...during, mode: 'idle', commitCalls: 1, revision: '1', submitting: false }
  assert.doesNotThrow(() => assertGestureCommitted(before, after))
  for (const patch of [{ commitCalls: 0 }, { commitCalls: 2 }, { revision: '0' }, { submitting: true }, { mode: 'dragging' }]) assert.throws(() => assertGestureCommitted(before, { ...after, ...patch }))
  assert.throws(() => assertGestureCommitted(before, { ...after, shape: before.shape }), /丢失/)
  assert.throws(() => assertGestureCommitted(before, { ...after, shape: { ...after.shape, w: 100 } }), /变形/)
  assert.throws(() => assertGestureCommitted(before, { ...after, shape: { ...after.shape, x: 500 } }, during, { x: 100, y: 70 }), /位移/)
  assert.throws(() => assertGestureCommitted(before, { ...after, shape: { ...after.shape, x: NaN } }), /无效/)
})

test('5000档小目标从未选择状态开始真实拖动，不误中选择框手柄', async () => {
  const f = createFixture(5000), transport = memoryTransport(f.snapshot)
  const session = await createEditorSession({ transport, actor: 'small-target' })
  const interaction = createCanvasInteraction({ session, camera: f.viewState.camera, viewport: { w: 1280, h: 800 }, edgeScrolling: false })
  const paints = [], errors = [], timers = new Set(), probe = pageObserver('preview')
  let time = 1000
  const browser = { performance, requestAnimationFrame: callback => {
    const timer = setTimeout(() => { timers.delete(timer); paints.push(performance.now()); callback(performance.now()) }, 16)
    timers.add(timer); return timer
  }, window: { __HICANVAS_RENDERER_PREVIEW__: {
    inspectTarget: id => observeEditorTarget(session, interaction, transport, id, 0),
    resetCamera: () => interaction.select('clear'),
  }, __hiCanvasPerfCamera: () => interaction.state.get().camera } }
  const contents = { executeJavaScript: async script => runInNewContext(script, browser), sendInputEvent: input => {
    const type = { mouseDown: 'pointer_down', mouseUp: 'pointer_up', mouseMove: 'pointer_move', keyDown: 'key_down', keyUp: 'key_up' }[input.type]
    const result = interaction.dispatch({ type, key: input.keyCode, point: { x: input.x || 0, y: input.y || 0 }, time: ++time, pointerId: 1, pointerType: 'mouse', button: 0, buttons: input.type === 'mouseUp' ? 0 : 1 })
    if (result?.catch) result.catch(error => errors.push(error))
  } }
  try {
    const result = await measureCanvasPhase({ name: 'drag', fixture: { ...f, renderer: 'preview', camera: f.viewState.camera }, contents, paints, probe, durationMs: 500 })
    assert.equal(result.before.selected, false)
    assert.equal(result.during.mode, 'dragging')
    assert.equal(result.after.commitCalls, 1)
    assert.equal(result.after.shape.w, 96); assert.equal(result.after.shape.h, 72)
    assert.deepEqual(errors, [])
  } finally { for (const timer of timers) clearTimeout(timer); interaction.dispose(); session.dispose() }
})

test('手柄取消必须恢复位置/尺寸/相机，不把idle或无提交当恢复成功', async () => {
  const { assertHandleRestored } = await import('./perf/handle-camera.mjs')
  const before = { x: 10, y: 20, w: 96, h: 72, commitCalls: 0, revision: '0', camera: { x: 1, y: 2, z: 1.5 } }
  const final = { ...before, mode: 'idle', shape: { x: 10, y: 20, w: 96, h: 72 } }
  assert.doesNotThrow(() => assertHandleRestored(before, final))
  for (const key of ['x', 'y', 'w', 'h']) assert.throws(() => assertHandleRestored(before, { ...final, shape: { ...final.shape, [key]: final.shape[key] + 1 } }), /恢复/)
  assert.throws(() => assertHandleRestored(before, { ...final, camera: { ...final.camera, z: 1 } }), /恢复/)
  assert.throws(() => assertHandleRestored(before, { ...final, commitCalls: 1 }), /恢复/)
})

test('正式报告保留原始三轮和失败即时复测，手柄不把移动FPS冒充缩放', () => {
  const options = { renderer: 'both', previewMode: 'editor', workload: 'handles', sizes: [5000], runs: 3, durationMs: 2500 }
  const sample = (row, stage, fps) => ({ ...row, stage, snapshotHash: 'a'.repeat(64), counts: { geo: 3000, text: 1000, image: 1000 }, assetCount: 16,
    ready: { camera: { x: 1, y: 2, z: .1 }, viewport: { width: 1280, height: 800, devicePixelRatio: 1 }, renderedImages: 1000 }, openMs: 100,
    phases: { resize: { raf: { fps, p95FrameMs: 17 }, paint: { fps, p95FrameMs: 17 } } } })
  const rows = measurementPlan(options).map(row => sample(row, 'baseline', row.renderer === 'legacy' ? 60 : 30))
  assert.equal(isFormalComparison(options), true)
  assert.equal(isFormalComparison(options, true), false)
  assert.equal(isFormalComparison({ ...options, previewMode: 'renderer' }), false)
  assert.throws(() => comparisonSummary(rows, { ...options, requireRetests: true }), /复测/)
  const retest = measurementPlan({ ...options, runs: 1 }).map(row => sample(row, 'retest', row.renderer === 'legacy' ? 60 : 40))
  const report = comparisonSummary([...rows, ...retest], { ...options, requireRetests: true })
  assert.equal(report.baseline.comparison[0].resizePaintRatio, .5)
  assert.equal(report.comparisons[0].resizePaintRatio, 2 / 3)
  assert.equal(report.comparisons[0].basis, 'immediate paired retest')
  assert.equal(report.acceptancePassed, false)
  assert.throws(() => comparisonSummary([...rows.slice(1), rows[0]], options), /次序/)
  assert.throws(() => comparisonSummary([...rows, ...retest.slice(1)], options), /配对|复测/)
  const wrong = structuredClone(rows); wrong[1].snapshotHash = 'b'.repeat(64)
  assert.throws(() => comparisonSummary(wrong, options), /不一致/)
  const unsupported = structuredClone(rows); unsupported[1].phases.resize = { applicable: false }
  assert.throws(() => comparisonSummary(unsupported, options), /适用|无效/)
})

test('拖动输入失败仍停帧并取消/释放指针，清理错误不覆盖原错误', async () => {
  const camera = { x: 0, y: 0, z: 1 }, first = new Error('native boundary failed'), inputs = []
  let downs = 0, active = false
  const probe = { canDrag: true, resetCamera() {}, inspectState: function inspectFake() {} }
  const contents = { async executeJavaScript(source) {
    if (source.includes('function startFrames')) { active = true; return }
    if (source.includes('function stopFrames')) { active = false; return }
    if (source.includes('function inspectFake')) return { camera, point: { x: 640, y: 400 }, selected: false, selectedIds: [] }
  }, sendInputEvent(input) {
    inputs.push(input)
    if (input.type === 'mouseDown' && ++downs === 1) throw first
    if (input.type === 'keyDown') throw new Error('secondary cleanup failed')
  } }
  await assert.rejects(measureCanvasPhase({ name: 'drag', fixture: { renderer: 'preview', targetId: 'shape:test', camera }, contents, paints: [], probe, durationMs: 500 }), error => error === first)
  assert.equal(active, false)
  assert.equal(inputs.filter(input => input.type === 'mouseUp').length, 1)
  assert.ok(inputs.some(input => input.type === 'keyUp' && input.keyCode === 'Escape'))
})
