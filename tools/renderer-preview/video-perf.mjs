import '../test-sandbox.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { startRendererPreview, createRendererFixture } from '../renderer-preview.mjs'
import { addVideoLoad } from './video-fixtures.js'
import { isolatedDirectories } from '../perf/config.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url)), outputDir = resolve(root, '.scratch/video-performance')
const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--port') throw new Error('用法：node tools/renderer-preview/video-perf.mjs --port 43397')
const port = Number(args[1])
await mkdir(outputDir, { recursive: true })
for (const [key, tail] of Object.entries({ PROJECT_DIR: 'project', CANVAS_DIR: 'canvas', SETTINGS_DIR: 'settings', DESKTOP_CONFIG_DIR: 'profile' })) {
  const path = join(outputDir, 'runtime', tail)
  await mkdir(path, { recursive: true })
  for (const prefix of ['HICANVAS', 'COWART']) process.env[`${prefix}_${key}`] = path
}
await isolatedDirectories()
const plain = createRendererFixture(5000), videos = addVideoLoad(plain)
const affected = new Set(Object.values(videos.snapshot.store).filter(r => r.typeName === 'shape' && r.type === 'video').map(r => r.id))
const stable = fixture => Object.values(fixture.snapshot.store).filter(r => !affected.has(r.id) && r.id !== 'asset:video-perf').sort((a,b) => a.id.localeCompare(b.id))
assert.deepEqual(stable(plain), stable(videos)); assert.deepEqual(plain.viewState, videos.viewState)
assert.equal(Object.values(videos.snapshot.store).filter(r => r.typeName === 'shape').length, 5000)
assert.equal(affected.size, 3)
const hash = createHash('sha256').update(JSON.stringify(stable(plain))).digest('hex')
const executable = process.env.HICANVAS_TEST_ELECTRON || join(root, 'node_modules/electron/dist', (await readFile(join(root, 'node_modules/electron/path.txt'), 'utf8')).trim())
await access(executable)
let preview, child, closed
try {
  preview = await startRendererPreview({ port, watch: false })
  const cases = []
  for (let round = 1; round <= 3; round++) for (const amount of [0, 3]) {
    const fixture = amount ? videos : plain
    cases.push({ renderer: 'preview', count: 5000, repeat: cases.length + 1, round, videoCount: amount, counts: fixture.counts, assetCount: fixture.assetCount, targetId: fixture.targetId, camera: fixture.viewState.camera, url: `${preview.url}/?count=5000${amount ? '&videos=3' : ''}` })
  }
  const resultPath = join(outputDir, 'samples.json'), manifest = join(outputDir, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ baseUrl: preview.url, origins: [preview.url], cases, durationMs: 2500, outputDir, resultPath }))
  const loadBefore = os.loadavg(), startedAt = new Date().toISOString()
  await new Promise((yes, no) => {
    child = spawn(executable, [join(root, 'tools/perf/electron.mjs'), manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
    closed = new Promise(resolve => child.once('close', resolve))
    const timer = setTimeout(() => child.kill('SIGKILL'), 300000)
    child.once('error', no); child.once('close', code => { clearTimeout(timer); code === 0 ? yes() : no(new Error(`视频性能驱动失败：${code}`)) })
  })
  const result = JSON.parse(await readFile(resultPath, 'utf8'))
  assert.equal(result.samples.length, 6); assert.deepEqual(result.blockedHosts, []); assert.deepEqual(result.consoleErrors, [])
  const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)]
  const rows = result.samples.map((sample, i) => ({ videoCount: cases[i].videoCount, round: cases[i].round, openMs: sample.openMs, pan: sample.phases.pan, zoom: sample.phases.zoom }))
  const comparison = {}
  for (const phase of ['pan', 'zoom']) {
    comparison[phase] = Object.fromEntries([0, 3].map(amount => [amount, { paintFps: median(rows.filter(r => r.videoCount === amount).map(r => r[phase].paint.fps)), rafFps: median(rows.filter(r => r.videoCount === amount).map(r => r[phase].raf.fps)) }]))
  }
  await writeFile(join(outputDir, 'report.json'), JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), loadBefore, loadAfter: os.loadavg(), platform: os.platform(), cpu: os.cpus()[0]?.model, unaffectedRecordsSha256: hash, replacedShapeIds: [...affected], camera: plain.viewState.camera, load: '5000 shapes; same seeded board, three image bodies replaced by three muted looping 320×180 videos; 0/3 interleaved three rounds; fresh media per sample', method: 'Unmodified tools/perf/electron.mjs input, 2500ms phases, host clock, RAF and actual paint; drag remains not applicable per existing driver', comparison, rows, raw: result }, null, 2))
  console.log(JSON.stringify(comparison))
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await closed; await preview?.close()
}
