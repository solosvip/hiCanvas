import { spawn, execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { benchmarkViewport, isolatedDirectories, parseOptions, repositoryRoot, scratchPath, makeDirectories, measurementPlan } from './perf/config.mjs'
import { prepareFixture } from './perf/prepare.mjs'
import { summarizeSamples } from './perf/report.mjs'

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
let child, service, preview, wasInterrupted = false
const interrupted = () => { wasInterrupted = true; child?.kill('SIGTERM') }
process.once('SIGINT', interrupted)
process.once('SIGTERM', interrupted)
const command = (program, args) => { try { return execFileSync(program, args, { encoding: 'utf8' }).trim() } catch { return 'unknown' } }

try {
  const { createHiCanvasService } = await import('../server/local-service.mjs')
  const { createConversations } = await import('../server/conversations.mjs')
  const { createFixture } = await import('./perf/fixture.mjs')
  const workspace = createConversations(process.env.HICANVAS_CANVAS_DIR)
  if (options.renderer !== 'preview') {
    service = createHiCanvasService({ distDir: join(repositoryRoot, 'dist'), canvasDir: process.env.HICANVAS_CANVAS_DIR, settingsDir: process.env.HICANVAS_SETTINGS_DIR })
    const html = await readFile(join(repositoryRoot, 'dist/index.html'), 'utf8')
    if (!html.includes('/app-assets/')) throw new Error('先运行 npm run build；旧版测量只使用正式 dist 构建。')
    await new Promise((yes, no) => { service.once('error', no); service.listen(options.port, '127.0.0.1', yes) })
  }
  if (options.renderer !== 'legacy') {
    const { startRendererPreview } = await import('./renderer-preview.mjs')
    preview = await startRendererPreview({ port: options.previewPort })
    // Both hosts prepare synthetic data before navigation starts. Otherwise the
    // first preview sample would also time PNG generation absent from legacy.
    for (const count of options.sizes) {
      const response = await fetch(`${preview.url}/__renderer_fixture?count=${count}`)
      if (!response.ok || (await response.json()).count !== count) throw new Error('新预览的合成资料准备失败。')
    }
  }
  const cases = []
  for (const { renderer, repeat, count } of measurementPlan(options)) {
    if (wasInterrupted) throw new Error('测量已中断。')
    let fixture = createFixture(count)
    let url = `${preview?.url}/?count=${count}`
    if (renderer === 'legacy') {
      const conversation = await workspace.open({ createNew: true, title: `Synthetic ${count} repeat ${repeat}` })
      const current = await workspace.read(conversation.id)
      // 旧版画板以服务端新建的快照为底，经编辑命令分批预置（#35）。
      fixture = createFixture(count, current.snapshot)
      await prepareFixture(workspace, conversation.id, current, fixture.snapshot)
      await workspace.sidecar(conversation.id, 'view', fixture.viewState)
      url = `${baseUrl}/?conversation=${conversation.id}`
    }
    const { snapshot: _snapshot, viewState: _viewState, ...description } = fixture
    cases.push({ ...description, camera: fixture.viewState.camera, renderer, repeat, url })
  }
  if (wasInterrupted) throw new Error('测量已中断。')
  const metadata = { timestamp: new Date().toISOString(), revision: command('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD']), dirty: Boolean(command('git', ['-C', repositoryRoot, 'status', '--porcelain'])), platform: os.platform(), release: os.release(), architecture: os.arch(), hardwareModel: command('/usr/sbin/sysctl', ['-n', 'hw.model']), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: os.totalmem() / 2 ** 30, loadBefore: os.loadavg(), loadNote: options.loadNote, viewport: benchmarkViewport, mode: 'Electron offscreen, 60 Hz cap, GPU defaults; unthrottled background renderer', cache: 'Fresh in-memory session per sample; browser/GPU process and OS file cache warm; synthetic fixtures prepared before navigation', opening: 'Navigation start through shape count, fonts, rendered-image decode and two rAFs; legacy additionally waits for native pointer selection; excludes process/service startup', hosts: { legacy: 'production dist', preview: 'Vite development preview' }, knownDifferences: ['Preview has no editing; drag is not applicable', 'Preview text uses estimated monospace layout'], options }
  const manifest = { cases, baseUrl, origins: [...new Set(cases.map(fixture => new URL(fixture.url).origin))], durationMs: options.durationMs, outputDir, resultPath }
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
  const { summary, comparison } = summarizeSamples(measured.samples, options)
  const report = { metadata: { ...metadata, finishedAt: new Date().toISOString(), loadAfter: os.loadavg() }, ...measured, summary, comparison }
  await writeFile(join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  console.table(summary.map(s => ({ renderer: s.renderer, elements: s.count, openMs: Math.round(s.medianOpenMs), panPaintFps: s.phases.pan.paint.medianFps.toFixed(1), zoomPaintFps: s.phases.zoom.paint.medianFps.toFixed(1), dragPaintFps: s.phases.drag.applicable === false ? '不适用' : s.phases.drag.paint.medianFps.toFixed(1) })))
  console.log(`原始样本、画面与环境记录：${outputDir}`)
} finally {
  child?.kill('SIGTERM')
  service?.closeAllConnections()
  if (service) await new Promise(resolve => service.close(resolve))
  await preview?.close()
  for (const path of Object.values(runDirectories)) await rm(await scratchPath(path), { recursive: true, force: true })
  process.removeListener('SIGINT', interrupted)
  process.removeListener('SIGTERM', interrupted)
}
