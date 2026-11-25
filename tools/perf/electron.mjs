import { app, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import os from 'node:os'
import { benchmarkViewport, isolatedDirectories, parseOptions, scratchPath, summarizeFrames, phaseChanged } from './config.mjs'
import { pageObserver, cameraReaderScript } from './observers.mjs'
import { startFrames, stopFrames } from './frame-probe.mjs'

console.log('Electron: validating isolated paths')
const directories = await isolatedDirectories()
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
if (manifest.cases.some(fixture => !origins.includes(new URL(fixture.url).origin))) throw new Error('测量清单含未登记的服务。')
app.setName('hiCanvas performance harness')
app.setPath('userData', directories.HICANVAS_DESKTOP_CONFIG_DIR)
app.setPath('sessionData', directories.HICANVAS_DESKTOP_CONFIG_DIR)
if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
for (const flag of ['disable-background-timer-throttling', 'disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows']) app.commandLine.appendSwitch(flag)
// Each sample gets a fresh window/session without quitting between samples.
app.on('window-all-closed', () => {})

let window, probe
const samples = [], blockedHosts = new Set(), consoleErrors = []
const evaluate = (fn, arg) => window.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`)
const input = event => window.webContents.sendInputEvent(event)
const move = (x, y, extra = {}) => input({ type: 'mouseMove', x: Math.round(x), y: Math.round(y), ...extra })
const button = (type, point, name = 'left') => input({ type, x: Math.round(point.x), y: Math.round(point.y), button: name, clickCount: 1 })

async function assertSelected(targetId) {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    if ((await evaluate(probe.inspectState, { targetId })).selected) return
    await delay(20)
  }
  throw new Error(`真实指针输入未选中 ${targetId}：${JSON.stringify(await evaluate(probe.inspectState, { targetId }))}`)
}

async function measurePhase(name, fixture, paints) {
  // Let wheel/end-of-gesture work settle outside the measured interval.
  await delay(250)
  await evaluate(probe.resetCamera, { camera: fixture.camera })
  const before = await evaluate(probe.inspectState, fixture)
  if (['x', 'y', 'z'].some(key => Math.abs(before.camera[key] - fixture.camera[key]) > 1e-8)) throw new Error('阶段起始视角未正确重置。')
  const center = { x: benchmarkViewport.width / 2, y: benchmarkViewport.height / 2 }
  const point = name === 'drag' ? before.point : center
  move(point.x, point.y)
  if (name === 'drag') {
    button('mouseDown', point); button('mouseUp', point)
    await assertSelected(fixture.targetId)
  }
  const start = performance.now()
  await evaluate(startFrames)
  if (name !== 'zoom') button('mouseDown', point, name === 'pan' ? 'middle' : 'left')
  let inputs = 0, nextInput = start, lastWheel = 0
  while (performance.now() - start < manifest.durationMs) {
    const progress = Math.min(1, (performance.now() - start) / manifest.durationMs)
    if (name === 'zoom') {
      // Bounded cumulative wheel displacement avoids spending time at the
      // editor's zoom limits. A small net offset verifies the gesture took effect.
      const wheel = 12 * Math.sin(progress * Math.PI * 4) + 6 * progress
      input({ type: 'mouseWheel', x: center.x, y: center.y, deltaX: 0, deltaY: wheel - lastWheel, modifiers: ['control'], canScroll: true })
      lastWheel = wheel
    }
    else move(point.x + progress * 100, point.y + Math.sin(progress * Math.PI / 2) * 70, { button: name === 'pan' ? 'middle' : 'left', modifiers: [name === 'pan' ? 'middleButtonDown' : 'leftButtonDown'] })
    inputs++
    // Fixed 60 Hz input rate; late events are not replayed in a burst.
    nextInput += 1000 / 60
    if (nextInput < performance.now()) nextInput = performance.now() + 1000 / 60
    await delay(Math.max(1, nextInput - performance.now()))
  }
  if (name !== 'zoom') button('mouseUp', { x: point.x + 100, y: point.y + 70 }, name === 'pan' ? 'middle' : 'left')
  const frames = await evaluate(stopFrames)
  const end = performance.now(), after = await evaluate(probe.inspectState, fixture)
  if (!phaseChanged(name, before, after, frames.zoomRange)) throw new Error(`${name} 输入没有改变预期画板状态，拒绝输出空转 FPS。`)
  const result = { raf: summarizeFrames(frames.times, frames.start, frames.end), paint: summarizeFrames(paints, start, end), zoomRange: frames.zoomRange, inputEvents: inputs, before, after }
  if (result.raf.frames < 2 || result.paint.frames < 2) throw new Error(`${name} 无有效渲染帧。`)
  return result
}

async function run() {
  app.dock?.hide()
  try {
    for (const [i, fixture] of manifest.cases.entries()) {
      probe = pageObserver(fixture.renderer)
      console.log(`Measuring ${fixture.renderer}, ${fixture.count} elements, repeat ${fixture.repeat}`)
      const startedAt = new Date().toISOString(), loadBefore = os.loadavg()
      const paints = []
      window = new BrowserWindow({ show: false, ...benchmarkViewport, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true, nodeIntegration: false, partition: `perf-${process.pid}-${i}` } })
      window.webContents.setFrameRate(60)
      window.webContents.on('paint', () => paints.push(performance.now()))
      const session = window.webContents.session
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      session.setPermissionCheckHandler(() => false)
      session.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url)
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
      if (probe.requiresSelection) {
        move(ready.point.x, ready.point.y)
        button('mouseDown', ready.point); button('mouseUp', ready.point)
        await assertSelected(fixture.targetId)
      }
      const openMs = performance.now() - navigationStart
      await window.webContents.executeJavaScript(cameraReaderScript(probe))
      console.log(`Ready after ${Math.round(openMs)} ms`)
      if (fixture.repeat === 1) await writeFile(join(manifest.outputDir, `${fixture.renderer}-${fixture.count}-elements.png`), (await window.webContents.capturePage()).toPNG())
      const phases = {}
      for (const name of ['pan', 'zoom', 'drag']) phases[name] = name === 'drag' && !probe.canDrag ? { applicable: false, reason: '新版尚无编辑能力。' } : await measurePhase(name, { ...fixture, camera: ready.camera }, paints)
      samples.push({ renderer: fixture.renderer, count: fixture.count, repeat: fixture.repeat, counts: fixture.counts, assetCount: fixture.assetCount, openMs, ready, phases, startedAt, finishedAt: new Date().toISOString(), loadBefore, loadAfter: os.loadavg() })
      await writeFile(manifest.resultPath, JSON.stringify({ samples, runtime: process.versions, gpu: app.getGPUFeatureStatus(), blockedHosts: [...blockedHosts], consoleErrors }, null, 2))
      window.destroy(); window = undefined
    }
    app.exit(0)
  } catch (error) {
    if (window && !window.isDestroyed()) await writeFile(join(manifest.outputDir, 'failure.png'), (await window.webContents.capturePage()).toPNG())
    await writeFile(manifest.resultPath, JSON.stringify({ error: error.stack, samples, blockedHosts: [...blockedHosts], consoleErrors }, null, 2))
    window?.destroy()
    app.exit(1)
  }
}

// Electron waits for ESM evaluation before emitting ready. Awaiting ready at
// module scope would deadlock; finish the guarded setup, then start the run.
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1) })
