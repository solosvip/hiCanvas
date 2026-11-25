import './test-sandbox.mjs'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCanvasSnapshot, sanitizeCanvasSnapshot } from '../model/index.js'
import { directoryVariables, isolatedDirectories, median, parseOptions, repositoryRoot, summarizeFrames } from './perf/config.mjs'
import { createFixture, syntheticPng } from './perf/fixture.mjs'

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
