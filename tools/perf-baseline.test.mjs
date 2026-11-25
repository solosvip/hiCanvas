import './test-sandbox.mjs'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { createCanvasSnapshot, sanitizeCanvasSnapshot } from '../model/index.js'
import { directoryVariables, isolatedDirectories, median, parseOptions, repositoryRoot, summarizeFrames } from './perf/config.mjs'
import { createFixture, syntheticPng } from './perf/fixture.mjs'
import { createConversations } from '../server/conversations.mjs'
import { executeCanvasCommands } from '../engine/index.js'
import { measurementPlan, phaseChanged } from './perf/config.mjs'
import { summarizeSamples } from './perf/report.mjs'
import { pageObserver, cameraReaderScript } from './perf/observers.mjs'

test('性能预置分批提交命令，先写资源与父形状，记录一致且版本按批数前进', async t => {
  const { prepareFixture, fixtureBatchSize } = await import('./perf/prepare.mjs')
  await mkdir(join(repositoryRoot, '.scratch'), { recursive: true })
  const root = await mkdtemp(join(repositoryRoot, '.scratch/perf-prepare-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = createConversations(root), { id } = await workspace.open()
  const current = await workspace.read(id)
  const framed = executeCanvasCommands(current.snapshot, [{ type: 'create_shape', id: 'shape:perf-parent', shapeType: 'frame' }]).snapshot
  const fixture = createFixture(500, framed)
  // Deliberately put children and images ahead of parents and assets, across a batch boundary.
  const snapshot = { ...fixture.snapshot, store: Object.fromEntries(Object.entries(fixture.snapshot.store).reverse().map(([key, record]) => [key, key === 'shape:perf-1' ? { ...record, parentId: 'shape:perf-parent' } : record])) }
  const original = structuredClone(snapshot), batches = []
  const observed = { submitCommands: (canvasId, revision, actor, factory) => workspace.submitCommands(canvasId, revision, actor, async source => {
    const commands = await factory(source)
    batches.push({ revision, actor, count: commands.length })
    return commands
  }).then(result => { batches.at(-1).nextRevision = result.revision; return result }) }
  const saved = await prepareFixture(observed, id, current, snapshot)
  assert.ok(fixtureBatchSize <= 500)
  assert.equal(batches.length, Math.ceil(Object.keys(snapshot.store).length / fixtureBatchSize))
  assert.equal(batches[0].revision, current.revision)
  for (const [index, batch] of batches.entries()) {
    assert.equal(batch.actor, 'perf-fixture')
    assert.ok(batch.count > 0 && batch.count <= fixtureBatchSize)
    assert.notEqual(batch.revision, batch.nextRevision)
    if (index) assert.equal(batch.revision, batches[index - 1].nextRevision)
  }
  assert.equal(new Set(batches.map(batch => batch.nextRevision)).size, batches.length)
  assert.equal(saved.revision, batches.at(-1).nextRevision)
  assert.equal((await workspace.read(id)).revision, saved.revision)
  assert.deepEqual(saved.snapshot.store, snapshot.store)
  assert.deepEqual((await workspace.read(id)).snapshot.store, snapshot.store)
  assert.deepEqual(snapshot, original)
})

test('launcher refuses every missing isolation variable before creating data', async t => {
  const scratch = join(repositoryRoot, '.scratch')
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(join(scratch, 'perf-guard-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const env = { ...process.env, ...Object.fromEntries(directoryVariables.map(name => [name, join(root, name)])) }
  for (const name of directoryVariables) {
    const partial = { ...env }; delete partial[name]
    const run = spawnSync(process.execPath, ['tools/perf-baseline.mjs', '--port', '43326'], { cwd: repositoryRoot, env: partial, encoding: 'utf8', timeout: 5000 })
    assert.equal(run.status, 1)
    assert.ok(run.stderr.includes(`未显式设置 ${name}`), run.stderr)
    assert.deepEqual(await readdir(root), [])
  }
})

test('isolation refuses outside paths and symlinked ancestors before mkdir', async t => {
  const root = await mkdtemp(join(repositoryRoot, '.scratch/perf-path-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const env = Object.fromEntries(directoryVariables.map(name => [name, join(root, name)]))
  assert.deepEqual(await isolatedDirectories(env), env)
  await assert.rejects(isolatedDirectories({ ...env, HICANVAS_CANVAS_DIR: '/tmp/hiCanvas-real-data' }), /worktree .scratch/)
  await symlink('/tmp', join(root, 'redirect'))
  await assert.rejects(isolatedDirectories({ ...env, HICANVAS_SETTINGS_DIR: join(root, 'redirect/not-created') }), /符号链接/)
  assert.deepEqual(await readdir(root), ['redirect'])
})

test('three benchmark scales are valid mixed snapshots with local raster assets', () => {
  const initial = createCanvasSnapshot()
  const pageId = Object.values(initial.store).find(r => r.typeName === 'page').id
  for (const count of [500, 2000, 5000]) {
    const fixture = createFixture(count, initial)
    const { snapshot, skippedRecords } = sanitizeCanvasSnapshot(fixture.snapshot)
    assert.deepEqual(skippedRecords, [])
    const shapes = Object.values(snapshot.store).filter(r => r.typeName === 'shape')
    const counts = Object.fromEntries(['image', 'text', 'geo'].map(type => [type, shapes.filter(s => s.type === type).length]))
    assert.equal(shapes.length, count)
    assert.deepEqual(counts, { image: count / 5, text: count / 5, geo: count * 3 / 5 })
    assert.deepEqual(fixture.counts, counts)
    assert.ok(shapes.every(s => s.parentId === pageId))
    assert.ok(snapshot.store[fixture.targetId])
    assert.equal(new Set(shapes.map(s => s.index)).size, count)
    const assets = Object.values(snapshot.store).filter(r => r.typeName === 'asset')
    assert.equal(assets.length, 16)
    assert.ok(assets.every(a => a.props.src.startsWith('data:image/png;base64,')))
    assert.ok(shapes.filter(s => s.type === 'image').every(s => snapshot.store[s.props.assetId]))
    assert.ok(fixture.viewState.camera.z > 0)
  }
  assert.deepEqual(syntheticPng(7), syntheticPng(7))
  assert.notDeepEqual(syntheticPng(7), syntheticPng(8))
  assert.equal(Object.values(initial.store).filter(r => r.typeName === 'shape').length, 0)
})

test('statistics preserve slow frames and use medians instead of fastest samples', () => {
  assert.equal(median([200, 1, 100]), 100)
  assert.equal(median([1, 3, 100, 9]), 6)
  assert.throws(() => median([NaN]), /有限/)
  const summary = summarizeFrames([-10, 10, 20, 30, 200], 0, 100)
  assert.equal(summary.frames, 3)
  assert.equal(summary.fps, 30)
  assert.equal(summary.maxFrameMs, 70)
  assert.equal(summary.p95FrameMs, 70)
  assert.equal(summarizeFrames([], 0, 100).fps, 0)
})

test('measurement options require a dedicated port and bounded workloads', () => {
  assert.throws(() => parseOptions([], {}), /显式指定/)
  for (const port of ['43218', '43219', '0']) assert.throws(() => parseOptions(['--port', port], {}), /端口/)
  assert.throws(() => parseOptions(['--port', '43326', '--sizes', '500,500'], {}), /不重复/)
  assert.throws(() => parseOptions(['--port', '43326', '--runs', '0'], {}), /runs/)
  assert.deepEqual(parseOptions(['--port', '43326'], {}).sizes, [500, 2000, 5000])
})

test('renderer selection preserves legacy defaults and alternates matched scales and repeats', () => {
  assert.equal(parseOptions(['--port', '43326'], {}).renderer, 'legacy')
  const options = parseOptions(['--port', '43326', '--renderer', 'both', '--preview-port', '43328'], {})
  assert.deepEqual(measurementPlan(options).map(({ renderer, count, repeat }) => [renderer, count, repeat]),
    [1, 2, 3].flatMap(repeat => [500, 2000, 5000].flatMap(count => [['legacy', count, repeat], ['preview', count, repeat]])))
  assert.deepEqual(measurementPlan({ ...options, renderer: 'preview', sizes: [500], runs: 1 }), [{ renderer: 'preview', count: 500, repeat: 1 }])
  for (const args of [
    ['--renderer', 'unknown'], ['--renderer', 'both'],
    ['--renderer', 'preview', '--preview-port', '43326'],
    ['--renderer', 'preview', '--preview-port', '43218'],
    ['--renderer', 'both', '--preview-port', '43328', '--sizes', '123']
  ]) assert.throws(() => parseOptions(['--port', '43326', ...args], {}))
})

test('comparison summarizes each renderer separately and never treats unsupported drag as zero FPS', () => {
  const options = { sizes: [5000], runs: 3, renderer: 'both' }
  const samples = ['legacy', 'preview'].flatMap(renderer => [1, 2, 3].map(repeat => ({
    renderer, count: 5000, repeat, openMs: repeat * (renderer === 'legacy' ? 100 : 200), counts: { image: 1000, text: 1000, geo: 3000 }, assetCount: 16,
    phases: Object.fromEntries(['pan', 'zoom', 'drag'].map(name => [name, renderer === 'preview' && name === 'drag' ? { applicable: false, reason: '新版尚无编辑能力。' }
      : Object.fromEntries(['raf', 'paint'].map(kind => [kind, { fps: repeat * (renderer === 'legacy' ? 10 : 8), p95FrameMs: repeat * 10 }]))]))
  })))
  const result = summarizeSamples(samples, options)
  assert.equal(result.summary.length, 2)
  assert.deepEqual(result.summary.map(s => s.medianOpenMs), [200, 400])
  assert.deepEqual(result.summary[1].phases.drag, { applicable: false, reason: '新版尚无编辑能力。' })
  assert.equal(result.comparison[0].panPaintRatio, .8)
  assert.equal(result.comparison[0].zoomPaintRatio, .8)
  assert.equal(result.comparison[0].openRatio, 2)
  assert.equal(result.comparison[0].dragPaintRatio, null)
  assert.throws(() => summarizeSamples(samples.slice(1), options), /样本/)
  assert.throws(() => summarizeSamples([...samples.slice(0, -1), samples.at(-2)], options), /样本/)
  const inconsistent = structuredClone(samples)
  inconsistent.at(-1).phases.drag = structuredClone(samples[0].phases.drag)
  assert.throws(() => summarizeSamples(inconsistent, options), /适用性/)
})

test('preview readiness requires every decoded image and propagates public hook errors', async () => {
  const observer = pageObserver('preview')
  let clock = 0, frames = 0, decodes = 0
  const state = { ready: true, count: 500, renderedShapes: 500, imageCount: 100, decodedImages: 99, camera: { x: 10, y: 20, z: .5 } }
  const context = {
    window: { __HICANVAS_RENDERER_PREVIEW__: { getState: () => state } },
    document: { fonts: { status: 'loaded', ready: Promise.resolve() }, querySelectorAll: () => Array.from({ length: 100 }, () => ({ complete: true, naturalWidth: 256, decode: async () => { decodes++ } })) },
    performance: { now: () => clock }, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    requestAnimationFrame: callback => { frames++; callback() },
    setTimeout: callback => { clock += 25; state.decodedImages = 100; callback() }
  }
  const ready = await runInNewContext(`(${observer.waitUntilReady})({ count: 500, counts: { image: 100 } })`, context)
  assert.equal(clock, 25, '公开钩子少解码一张时不能提前就绪')
  assert.equal(ready.renderedImages, 100)
  assert.equal(ready.decodedImages, 100)
  assert.equal(frames, 0, '预览 ready 已等待双帧，不得重复计时')
  assert.equal(decodes, 0, '公开钩子已确认全部解码，不重复解码')
  assert.equal(observer.canDrag, false)
  assert.equal(pageObserver('legacy').canDrag, true)
  assert.deepEqual(runInNewContext(`(${observer.getCamera})()`, { window: { __HICANVAS_RENDERER_PREVIEW__: {
    getCamera: () => ({ x: 10, y: 20, z: .5 }), getState: () => { throw new Error('逐帧不应全量统计画面') }
  } } }), { x: 10, y: 20, z: .5 })
  state.error = '合成图片失败'
  await assert.rejects(runInNewContext(`(${observer.waitUntilReady})({ count: 500, counts: { image: 100 } })`, context), /合成图片失败/)
  assert.throws(() => pageObserver('other'), /未知/)
})

test('browser camera installation returns a clonable value and zoom checks remain valid at small scales', () => {
  const camera = { x: 0, y: 0, z: .1 }
  const context = { window: { __HICANVAS_RENDERER_PREVIEW__: { getCamera: () => camera } } }
  const returned = runInNewContext(cameraReaderScript(pageObserver('preview')), context)
  assert.equal(returned, undefined, 'Electron IPC 不能克隆函数返回值')
  assert.equal(structuredClone(returned), undefined)
  assert.deepEqual(context.window.__hiCanvasPerfCamera(), camera)
  const before = { camera }
  assert.equal(phaseChanged('zoom', before, { camera: { ...camera, z: .1005 } }, { min: .1, max: .1005 }), true)
  assert.equal(phaseChanged('zoom', before, before, { min: .098, max: .102 }), true, '往返缩放仍是真实操作')
  assert.equal(phaseChanged('zoom', before, before, { min: .1, max: .1 }), false, '相机空转不得计入 FPS')
  assert.equal(phaseChanged('pan', before, before), false)
})
