import { spawn, execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { benchmarkViewport, isolatedDirectories, parseOptions, repositoryRoot, scratchPath, makeDirectories, median } from './perf/config.mjs'
import { prepareFixture } from './perf/prepare.mjs'

// No application module may be loaded before this guard: some modules resolve
// default storage paths at import time, even if a caller later supplies options.
const directories = await isolatedDirectories()
const options = parseOptions(process.argv.slice(2))
const outputParent = await scratchPath(resolve(repositoryRoot, options.output))
await makeDirectories(directories)
await mkdir(outputParent, { recursive: true })
const outputDir = await mkdtemp(join(outputParent, 'run-'))
const runDirectories = {}
for (const [name, parent] of Object.entries(directories)) runDirectories[name] = process.env[name] = await mkdtemp(join(parent, 'perf-data-'))
await isolatedDirectories()

const baseUrl = `http://127.0.0.1:${options.port}`
const resultPath = join(outputDir, 'samples.json')
let child, service, wasInterrupted = false
const interrupted = () => { wasInterrupted = true; child?.kill('SIGTERM') }
process.once('SIGINT', interrupted)
process.once('SIGTERM', interrupted)
const command = (program, args) => { try { return execFileSync(program, args, { encoding: 'utf8' }).trim() } catch { return 'unknown' } }

try {
  const { createHiCanvasService } = await import('../server/local-service.mjs')
  const { createConversations } = await import('../server/conversations.mjs')
  const { createFixture } = await import('./perf/fixture.mjs')
  service = createHiCanvasService({ distDir: join(repositoryRoot, 'dist'), canvasDir: process.env.HICANVAS_CANVAS_DIR, settingsDir: process.env.HICANVAS_SETTINGS_DIR })
  const workspace = createConversations(process.env.HICANVAS_CANVAS_DIR)
  const html = await readFile(join(repositoryRoot, 'dist/index.html'), 'utf8')
  if (!html.includes('/app-assets/')) throw new Error('先运行 npm run build；测量只使用正式 dist 构建。')
  const cases = []
  for (let repeat = 1; repeat <= options.runs; repeat++) for (const count of options.sizes) {
    if (wasInterrupted) throw new Error('测量已中断。')
    const conversation = await workspace.open({ createNew: true, title: `Synthetic ${count} repeat ${repeat}` })
    const current = await workspace.read(conversation.id)
    const fixture = createFixture(count, current.snapshot)
    await prepareFixture(workspace, conversation.id, current, fixture.snapshot)
    await workspace.sidecar(conversation.id, 'view', fixture.viewState)
    const { snapshot: _snapshot, viewState: _viewState, ...description } = fixture
    cases.push({ ...description, repeat, url: `${baseUrl}/?conversation=${conversation.id}` })
  }
  if (wasInterrupted) throw new Error('测量已中断。')
  await new Promise((yes, no) => { service.once('error', no); service.listen(options.port, '127.0.0.1', yes) })
  const metadata = { timestamp: new Date().toISOString(), revision: command('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD']), dirty: Boolean(command('git', ['-C', repositoryRoot, 'status', '--porcelain'])), platform: os.platform(), release: os.release(), architecture: os.arch(), hardwareModel: command('/usr/sbin/sysctl', ['-n', 'hw.model']), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: os.totalmem() / 2 ** 30, loadBefore: os.loadavg(), loadNote: options.loadNote, viewport: benchmarkViewport, mode: 'Electron offscreen, 60 Hz cap, GPU defaults; unthrottled background renderer', cache: 'Fresh in-memory session per sample; browser/GPU process and OS file cache warm', opening: 'Navigation start through shape count, fonts, rendered-image decode, two rAFs, and native pointer selection acknowledgement; excludes process/service startup', options }
  const manifest = { cases, baseUrl, durationMs: options.durationMs, outputDir, resultPath }
  const manifestPath = join(outputDir, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest))
  const require = createRequire(import.meta.url)
  const electron = require('electron')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const logs = []
  await new Promise((yes, no) => {
    child = spawn(electron, [fileURLToPath(new URL('./perf/electron.mjs', import.meta.url)), manifestPath], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: cases.length * 90000 + 30000 })
    child.stdout.on('data', bytes => { logs.push(bytes); process.stdout.write(bytes) })
    child.stderr.on('data', bytes => { logs.push(bytes); process.stderr.write(bytes) })
    child.once('error', no)
    child.once('exit', (code, signal) => code === 0 ? yes() : no(new Error(`Electron 失败：${code ?? signal}；证据在 ${outputDir}`)))
  }).finally(() => writeFile(join(outputDir, 'electron.log'), Buffer.concat(logs)))
  const measured = JSON.parse(await readFile(resultPath, 'utf8'))
  const summary = options.sizes.map(count => {
    const samples = measured.samples.filter(sample => sample.count === count)
    if (samples.length !== options.runs) throw new Error(`样本缺失：${count}`)
    const phases = Object.fromEntries(['pan', 'zoom', 'drag'].map(name => [name, Object.fromEntries(['raf', 'paint'].map(kind => [kind, { medianFps: median(samples.map(s => s.phases[name][kind].fps)), medianP95FrameMs: median(samples.map(s => s.phases[name][kind].p95FrameMs)) }]))]))
    return { count, samples: samples.length, counts: samples[0].counts, assetCount: samples[0].assetCount, medianOpenMs: median(samples.map(s => s.openMs)), phases }
  })
  const report = { metadata: { ...metadata, loadAfter: os.loadavg() }, ...measured, summary }
  await writeFile(join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  console.table(summary.map(s => ({ elements: s.count, openMs: Math.round(s.medianOpenMs), panPaintFps: s.phases.pan.paint.medianFps.toFixed(1), zoomPaintFps: s.phases.zoom.paint.medianFps.toFixed(1), dragPaintFps: s.phases.drag.paint.medianFps.toFixed(1) })))
  console.log(`原始样本、画面与环境记录：${outputDir}`)
} finally {
  child?.kill('SIGTERM')
  service?.closeAllConnections()
  if (service) await new Promise(resolve => service.close(resolve))
  for (const path of Object.values(runDirectories)) await rm(await scratchPath(path), { recursive: true, force: true })
  process.removeListener('SIGINT', interrupted)
  process.removeListener('SIGTERM', interrupted)
}
