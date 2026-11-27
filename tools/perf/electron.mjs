import { app, BrowserWindow, contentTracing } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import os from 'node:os'
import { benchmarkViewport, isolatedDirectories, parseOptions, scratchPath } from './config.mjs'
import { pageObserver, cameraReaderScript } from './observers.mjs'
import { measureCanvasPhase, waitForSelection } from './canvas-phase.mjs'
import { measureSelectionHandles } from '../renderer-preview/handle-perf.mjs'
import { handleCamera, assertHandleRestored } from './handle-camera.mjs'
import { comparisonSummary } from './comparison.mjs'
import { startPhaseTrace } from './trace.mjs'

console.log('Electron: validating isolated paths')
const directories = await isolatedDirectories()
const packageInfo = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
if (process.versions.electron !== packageInfo.devDependencies.electron) throw new Error('性能测量必须使用项目锁定的Electron版本。')
const manifestPath = await scratchPath(process.argv.at(-1))
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
await scratchPath(manifest.resultPath)
await scratchPath(manifest.outputDir)
const base = new URL(manifest.baseUrl)
parseOptions(['--port', base.port, '--duration-ms', String(manifest.durationMs)])
const origins = manifest.origins || [base.origin]
for (const origin of origins) {
  const url = new URL(origin)
  parseOptions(['--port', url.port])
  if (url.origin !== `http://127.0.0.1:${url.port}` || url.origin !== origin) throw new Error('测量清单必须只指向本机专用服务。')
}
if ([...manifest.cases, ...(manifest.retests || [])].some(fixture => !origins.includes(new URL(fixture.url).origin))) throw new Error('测量清单含未登记的服务。')
app.setName('hiCanvas performance harness')
app.setPath('userData', directories.HICANVAS_DESKTOP_CONFIG_DIR)
app.setPath('sessionData', directories.HICANVAS_DESKTOP_CONFIG_DIR)
if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
for (const flag of ['disable-background-timer-throttling', 'disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows']) app.commandLine.appendSwitch(flag)
// Each sample gets a fresh window/session without quitting between samples.
app.on('window-all-closed', () => {})

let window, probe, activeTrace
const samples = [], blockedHosts = new Set(), consoleErrors = []
const evaluate = (fn, arg) => window.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`)
const input = event => window.webContents.sendInputEvent(event)
const move = (x, y, extra = {}) => input({ type: 'mouseMove', x: Math.round(x), y: Math.round(y), ...extra })
const button = (type, point, name = 'left') => input({ type, x: Math.round(point.x), y: Math.round(point.y), button: name, clickCount: 1 })


async function run() {
  app.dock?.hide()
  try {
    const sample = async (fixture, i) => {
      probe = pageObserver(fixture.renderer, manifest.options.previewMode)
      console.log(`Measuring ${fixture.renderer}, ${fixture.count} elements, repeat ${fixture.repeat}`)
      const startedAt = new Date().toISOString(), loadBefore = os.loadavg()
      const paints = [], boardWrites = []
      window = new BrowserWindow({ show: false, ...benchmarkViewport, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true, nodeIntegration: false, partition: `perf-${process.pid}-${i}` } })
      window.webContents.setFrameRate(60)
      window.webContents.on('paint', () => paints.push(performance.now()))
      const session = window.webContents.session
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      session.setPermissionCheckHandler(() => false)
      session.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url)
        if (!['GET', 'HEAD'].includes(details.method) && /^\/(?:api\/(?:canvas|view-state)|__interaction\/commit)/.test(url.pathname)) {
          boardWrites.push({ method: details.method, path: url.pathname })
          if (fixture.renderer === 'preview') { consoleErrors.push('合成新版预览尝试写HTTP画板。'); callback({ cancel: true }); return }
        }
        const allowed = url.origin === new URL(fixture.url).origin || ['data:', 'blob:'].includes(url.protocol) || url.protocol === 'ws:' && url.host === new URL(fixture.url).host
        if (!allowed) blockedHosts.add(url.host)
        callback({ cancel: !allowed })
      })
      window.webContents.on('console-message', details => {
        if (details.level === 'error') consoleErrors.push(details.message.slice(0, 500))
      })
      window.webContents.on('render-process-gone', (_event, detail) => { consoleErrors.push(`renderer gone: ${detail.reason}`) })
      const navigationStart = performance.now()
      await window.loadURL(fixture.url)
      const ready = await evaluate(probe.waitUntilReady, fixture)
      // Handles prepare their own single selection after setting the shared
      // zoom. A second warm click can become a double-click and enter text.
      if (probe.requiresSelection && manifest.options.workload !== 'handles') {
        move(ready.point.x, ready.point.y)
        button('mouseDown', ready.point); button('mouseUp', ready.point)
        await waitForSelection(evaluate, probe, fixture)
      }
      const openMs = performance.now() - navigationStart
      await window.webContents.executeJavaScript(cameraReaderScript(probe))
      console.log(`Ready after ${Math.round(openMs)} ms`)
      if (fixture.repeat === 1) await writeFile(join(manifest.outputDir, `${fixture.stage}-${fixture.renderer}-${fixture.count}-elements.png`), (await window.webContents.capturePage()).toPNG())
      const phases = {}
      if (manifest.options.workload === 'handles') {
        const camera = handleCamera(fixture.targetBounds)
        await evaluate(probe.resetCamera, { camera })
        phases.resize = await measureSelectionHandles(window, { renderer: fixture.renderer, camera, targetId: fixture.targetId, durationMs: manifest.durationMs })
        if (fixture.renderer === 'preview') {
          const final = await evaluate(probe.inspectState, fixture)
          assertHandleRestored(phases.resize.before, final)
          phases.resize.restored = final
        }
      } else for (const name of ['pan', 'zoom', 'drag']) {
        phases[name] = name === 'drag' && !probe.canDrag ? { applicable: false, reason: '兼容旧只读观察协议，不测拖动。' }
          : await measureCanvasPhase({ name, fixture: { ...fixture, camera: ready.camera }, contents: window.webContents, paints, probe, durationMs: manifest.durationMs,
            startTrace: process.env.HICANVAS_PERF_TRACE === '1' ? async () => {
              activeTrace = await startPhaseTrace({ tracing: contentTracing, contents: window.webContents, outputDir: manifest.outputDir, label: `${fixture.stage}-${fixture.renderer}-${fixture.count}-${fixture.repeat}-${name}` })
              return async () => { const stop = activeTrace; activeTrace = undefined; return stop() }
            } : undefined })
      }
      samples.push({ stage: fixture.stage, snapshotHash: fixture.snapshotHash, renderer: fixture.renderer, count: fixture.count, repeat: fixture.repeat, counts: fixture.counts, assetCount: fixture.assetCount, openMs, ready, phases, boardWrites, startedAt, finishedAt: new Date().toISOString(), loadBefore, loadAfter: os.loadavg() })
      await writeFile(manifest.resultPath, JSON.stringify({ samples, runtime: process.versions, gpu: app.getGPUFeatureStatus(), blockedHosts: [...blockedHosts], consoleErrors }, null, 2))
      window.destroy(); window = undefined
    }
    let serial = 0
    for (const fixture of manifest.cases) await sample(fixture, serial++)
    const first = comparisonSummary(samples, manifest.options)
    const failed = new Set(first.comparisons.filter(item => !item.pass).map(item => item.count))
    if (manifest.formal) for (const fixture of (manifest.retests || []).filter(item => failed.has(item.count))) await sample(fixture, serial++)
    if (blockedHosts.size || consoleErrors.length) throw new Error('浏览器存在错误或外部请求，拒绝性能结论。')
    app.exit(0)
  } catch (error) {
    await activeTrace?.().catch(() => {}); activeTrace = undefined
    if (window && !window.isDestroyed()) await writeFile(join(manifest.outputDir, 'failure.png'), (await window.webContents.capturePage()).toPNG())
    await writeFile(manifest.resultPath, JSON.stringify({ error: error.stack, samples, blockedHosts: [...blockedHosts], consoleErrors }, null, 2))
    window?.destroy()
    app.exit(1)
  }
}

// Electron waits for ESM evaluation before emitting ready. Awaiting ready at
// module scope would deadlock; finish the guarded setup, then start the run.
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1) })
