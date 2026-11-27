import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { benchmarkViewport, isolatedDirectories, parseOptions, repositoryRoot, scratchPath, makeDirectories, measurementPlan } from './perf/config.mjs'
import { prepareFixture } from './perf/prepare.mjs'
import { comparisonSummary, isFormalComparison } from './perf/comparison.mjs'
import { runStrokeProcess as runBrowserProcess } from './perf/strokes-process.mjs'

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
let service, preview, wasInterrupted = false
const controller = new AbortController()
const interrupted = () => { wasInterrupted = true; controller.abort(new Error('性能对照已中断。')) }
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
    preview = await startRendererPreview({ port: options.previewPort, watch: false })
    // Both hosts prepare synthetic data before navigation starts. Otherwise the
    // first preview sample would also time PNG generation absent from legacy.
    for (const count of options.sizes) {
      const response = await fetch(`${preview.url}/__renderer_fixture?count=${count}&dash=${options.dash}`)
      if (!response.ok || (await response.json()).count !== count) throw new Error('新预览的合成资料准备失败。')
    }
  }
  const cases = []
  const plan = [...measurementPlan(options).map(row => ({ ...row, stage: 'baseline' })), ...measurementPlan({ ...options, runs: 1 }).map(row => ({ ...row, stage: 'retest' }))]
  for (const { renderer, repeat, count, stage } of plan) {
    if (wasInterrupted) throw new Error('测量已中断。')
    let fixture = createFixture(count, undefined, undefined, { dash: options.dash })
    let url = `${preview?.url}/?count=${count}&dash=${options.dash}`
    if (renderer === 'legacy') {
      const conversation = await workspace.open({ createNew: true, title: `Synthetic ${count} repeat ${repeat}` })
      const current = await workspace.read(conversation.id)
      // 旧版画板以服务端新建的快照为底，经编辑命令分批预置（#35）。
      fixture = createFixture(count, current.snapshot, undefined, { dash: options.dash })
      await prepareFixture(workspace, conversation.id, current, fixture.snapshot)
      await workspace.sidecar(conversation.id, 'view', fixture.viewState)
      url = `${baseUrl}/?conversation=${conversation.id}`
    }
    const { snapshot: _snapshot, viewState: _viewState, ...description } = fixture
    const snapshotHash = createHash('sha256').update(JSON.stringify(Object.entries(fixture.snapshot.store).filter(([, record]) => ['shape', 'asset'].includes(record.typeName)).sort(([a], [b]) => a.localeCompare(b)))).digest('hex')
    cases.push({ ...description, snapshotHash, camera: fixture.viewState.camera, renderer, repeat, stage, url })
  }
  if (wasInterrupted) throw new Error('测量已中断。')
  const formal = isFormalComparison(options, process.env.HICANVAS_PERF_TRACE === '1')
  const metadata = { formal, diagnosticTracing: process.env.HICANVAS_PERF_TRACE === '1', timestamp: new Date().toISOString(), revision: command('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD']), dirty: Boolean(command('git', ['-C', repositoryRoot, 'status', '--porcelain'])), platform: os.platform(), release: os.release(), architecture: os.arch(), hardwareModel: command('/usr/sbin/sysctl', ['-n', 'hw.model']), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: os.totalmem() / 2 ** 30, loadBefore: os.loadavg(), loadNote: options.loadNote, viewport: benchmarkViewport, mode: 'Electron offscreen, 60 Hz cap, GPU defaults; unthrottled background renderer', cache: 'Fresh in-memory session per sample; browser/GPU process and OS file cache warm; synthetic fixtures prepared before navigation', opening: 'Navigation start through shape count, fonts, rendered-image decode and two rAFs; canvas editing observers additionally wait for native pointer selection; handles select once after installing their shared zoom; excludes process/service startup', hosts: { legacy: 'production dist', preview: 'Vite development preview' }, knownDifferences: ['Preview uses the real editing session and in-memory transport; legacy uses its isolated HTTP board', 'Compatibility renderer observer skips selection/drag; full image decoding remains required', 'Drag clocks stop before release/commit in both versions; raw still-held and released state are recorded'], options }
  const manifest = { cases: cases.filter(row => row.stage === 'baseline'), retests: cases.filter(row => row.stage === 'retest'), options, formal, baseUrl, origins: [...new Set(cases.map(fixture => new URL(fixture.url).origin))], durationMs: options.durationMs, outputDir, resultPath }
  const manifestPath = join(outputDir, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest))
  const require = createRequire(import.meta.url)
  const electron = process.env.HICANVAS_TEST_ELECTRON || require('electron')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const logs = []
  await runBrowserProcess({ command: electron, args: [fileURLToPath(new URL('./perf/electron.mjs', import.meta.url)), manifestPath], env, signal: controller.signal,
    timeoutMs: cases.length * 90000 + 30000,
    onStdout: bytes => { logs.push(bytes); process.stdout.write(bytes) },
    onStderr: bytes => { logs.push(bytes); process.stderr.write(bytes) },
  }).finally(() => writeFile(join(outputDir, 'electron.log'), Buffer.concat(logs)))
  const measured = JSON.parse(await readFile(resultPath, 'utf8'))
  if (measured.error || measured.consoleErrors.length || measured.blockedHosts.length) throw new Error('浏览器报告不完整或存在错误。')
  const result = comparisonSummary(measured.samples, { ...options, requireRetests: formal })
  const { summary, comparison } = result.baseline
  const report = { metadata: { ...metadata, finishedAt: new Date().toISOString(), loadAfter: os.loadavg() }, ...measured, measurementComplete: true, summary, comparison, ...result }
  await writeFile(join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  console.table(summary.map(s => ({ renderer: s.renderer, elements: s.count, openMs: Math.round(s.medianOpenMs),
    ...Object.fromEntries(Object.entries(s.phases).map(([name, phase]) => [name + 'PaintFps', phase.applicable === false ? '不适用' : phase.paint.medianFps.toFixed(1)])) })))
  if (formal && result.acceptancePassed === false) process.exitCode = 1
  console.log(`原始样本、画面与环境记录：${outputDir}`)
} finally {
  service?.closeAllConnections()
  if (service) await new Promise(resolve => service.close(resolve))
  await preview?.close()
  for (const path of Object.values(runDirectories)) await rm(await scratchPath(path), { recursive: true, force: true })
  process.removeListener('SIGINT', interrupted)
  process.removeListener('SIGTERM', interrupted)
}
