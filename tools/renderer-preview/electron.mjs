import { app, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { selectionSmoke } from './selection-smoke.mjs'
import { measureSelectionPointer } from './selection-perf.mjs'

const manifest = JSON.parse(await readFile(process.argv.at(-1), 'utf8'))
const origin = new URL(manifest.url).origin
if (!origin.startsWith('http://127.0.0.1:')) throw new Error('仅允许本机合成预览。')
app.setName('hiCanvas renderer smoke')
app.setPath('userData', manifest.profile)
app.setPath('sessionData', manifest.profile)
if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
app.on('window-all-closed', () => {})
const samples = [], errors = [], blocked = []
let window
const evaluate = code => window.webContents.executeJavaScript(code)
async function state() { return evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()') }
async function until(predicate) {
  const end = Date.now() + 30000
  while (Date.now() < end) { const value = await predicate(); if (value) return value; await delay(20) }
  throw new Error('等待渲染器就绪超时。')
}
const check = (condition, message) => { if (!condition) throw new Error(message) }
async function cameraLayoutProbe(selected = false) {
  const contents = window.webContents
  await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:100,y:100,z:1});void 0')
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const x = selected ? 140 : 50, y = selected ? 140 : 50
  for (const type of ['mouseDown', 'mouseUp']) contents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 })
  await until(async () => (await state()).selectedIds.length === Number(selected))
  contents.debugger.attach('1.3')
  try {
    await contents.debugger.sendCommand('Performance.enable')
    const metrics = async () => Object.fromEntries((await contents.debugger.sendCommand('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]))
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const before = await metrics()
    let zoom = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getCamera().z')
    for (const deltaY of [-3, 3, -3, 3]) {
      contents.sendInputEvent({ type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY, modifiers: ['control'], canScroll: true })
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const next = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getCamera().z')
      check(next !== zoom, '布局回归检查的真实滚轮没有改变缩放')
      zoom = next
    }
    const pan = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getCamera()')
    contents.sendInputEvent({ type: 'mouseMove', x: 640, y: 400 })
    contents.sendInputEvent({ type: 'mouseDown', x: 640, y: 400, button: 'middle', clickCount: 1 })
    contents.sendInputEvent({ type: 'mouseMove', x: 680, y: 430, button: 'middle', modifiers: ['middleButtonDown'] })
    contents.sendInputEvent({ type: 'mouseUp', x: 680, y: 430, button: 'middle', clickCount: 1 })
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const moved = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getCamera()')
    check(moved.x !== pan.x && moved.y !== pan.y, '布局回归检查的真实中键没有改变平移')
    const after = await metrics(), layouts = after.LayoutCount - before.LayoutCount
    check(layouts === 0, `相机平移缩放触发了 ${layouts} 次布局；静态内容不应逐帧重排`)
    return { selected, cameraLayouts: layouts }
  } finally { contents.debugger.detach() }
}
function createWindow(key) {
  const target = new BrowserWindow({ show: false, width: 1280, height: 800, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: `renderer-${process.pid}-${key}` } })
  target.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url), allowed = url.origin === origin || url.protocol === 'ws:' && url.host === new URL(origin).host || ['data:', 'blob:'].includes(url.protocol)
    if (!allowed) blocked.push(details.url)
    callback({ cancel: !allowed })
  })
  target.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  target.webContents.on('console-message', detail => { if (detail.level === 'error') errors.push(detail.message.slice(0, 500)) })
  target.webContents.on('render-process-gone', (_event, detail) => errors.push(`renderer gone: ${detail.reason}`))
  return target
}

async function run() {
  try {
    app.dock?.hide()
    if (manifest.selectionOnly) {
      window = createWindow('selection')
      await window.loadURL(`${manifest.url}/?count=500`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ selection: await selectionSmoke(window, manifest.output, { persistent: true }) })
      window.destroy(); window = createWindow('selection-perf')
      await window.loadURL(`${manifest.url}/?count=5000`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ count: 5000, pointer: await measureSelectionPointer(window) })
      check(!errors.length && !blocked.length, `浏览器错误／外部请求：${JSON.stringify({ errors, blocked })}`)
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2))
      window.destroy(); app.exit(0); return
    }
    for (const count of [500, 2000, 5000]) {
      window = createWindow(count)
      await window.loadURL(`${manifest.url}/?count=${count}`)
      const initial = await until(async () => { const value = await state(); if (value?.error) throw new Error(value.error); return value?.ready && value })
      check(initial.renderedShapes === count && initial.imageCount === count / 5 && initial.decodedImages === count / 5, `元素/图片数量不符：${JSON.stringify(initial)}`)
      const snapshot = (await window.webContents.capturePage()).toPNG()
      await writeFile(join(manifest.output, `${count}-elements.png`), snapshot)
      window.webContents.sendInputEvent({ type: 'mouseWheel', x: 640, y: 400, deltaX: 20, deltaY: 30, canScroll: true })
      const pan = await until(async () => { const value = await state(); return value.camera.x !== initial.camera.x && value })
      window.webContents.sendInputEvent({ type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: -40, modifiers: ['control'], canScroll: true })
      const zoom = await until(async () => { const value = await state(); return value.camera.z !== pan.camera.z && value })
      let lifecycle, cameraLayout, text
      if (count === 5000) cameraLayout = { empty: await cameraLayoutProbe(), selected: await cameraLayoutProbe(true) }
      if (count === 500) {
        lifecycle = await evaluate("import('/tools/renderer-preview/probe.js').then(module => module.runLifecycleProbe())")
        text = await evaluate("import('/tools/renderer-preview/text-probe.js').then(module => module.runTextProbe())")
      }
      const selection = count === 500 ? await selectionSmoke(window, manifest.output) : undefined
      samples.push({ count, initial, pan: pan.camera, zoom: zoom.camera, lifecycle, cameraLayout, text, selection })
      console.log(`${count} 元素与 ${initial.decodedImages} 张图片通过；真实滚轮平移/缩放通过。`)
      window.destroy(); window = undefined
    }
    const galleryCounts = { shapes: 20, styles: 82, metrics: 22, 'metrics-long': 22, 'metrics-curves': 10, embeds: null, arrows: null, routes: null, lines: null, bindings: null, 'bound-elbows': null }
    for (const [gallery, count] of Object.entries(galleryCounts)) {
      window = createWindow(gallery)
      await window.loadURL(`${manifest.url}/?gallery=${gallery}`)
      const initial = await until(async () => { const value = await state(); if (value?.error) throw new Error(value.error); return value?.ready && value })
      check(initial.renderedShapes === initial.count && (gallery === 'embeds' ? initial.counts.embed === 6 && initial.counts.bookmark === 1 : count === null || initial.counts.geo === count), '图鉴元素未完整绘制')
      if (gallery === 'embeds') await until(() => evaluate("document.querySelector('[data-embed-content=\"shape:embed-web\"]')?.contentDocument?.documentElement.dataset.instance && document.querySelector('[data-embed-content=\"shape:embed-film\"]')?.contentDocument?.documentElement.dataset.instance && document.querySelector('[data-embed-content=\"shape:embed-slide\"]')?.contentDocument?.documentElement.dataset.instance"))
      await writeFile(join(manifest.output, `${gallery}-gallery.png`), (await window.webContents.capturePage()).toPNG())
      const geometry = gallery === 'shapes' ? await evaluate("import('/tools/renderer-preview/geo-probe.js').then(module => module.runGeoProbe())") : undefined
      const embeds = gallery === 'embeds' ? await evaluate("import('/tools/renderer-preview/embed-probe.js').then(module => module.runEmbedProbe())") : undefined
      if (gallery === 'embeds') {
        window.setContentSize(390, 800)
        await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x: 15, y: 180, z: .26})')
        await delay(100)
        await writeFile(join(manifest.output, 'embeds-narrow.png'), (await window.webContents.capturePage()).toPNG())
      }
      const connections = gallery === 'bindings' ? await evaluate("import('/tools/renderer-preview/arrow-probe.js').then(module => module.runConnectionProbe())") : undefined
      samples.push({ gallery, initial, geometry, embeds, connections })

      window.destroy(); window = undefined
    }
    check(errors.length === 0 && blocked.length === 0, `浏览器错误：${errors.join('; ')}；外部请求：${blocked.join('; ')}`)
    await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2))
    app.exit(0)
  } catch (error) {
    await writeFile(manifest.result, JSON.stringify({ error: error.stack, samples, errors, blocked }, null, 2))
    if (window && !window.isDestroyed()) await writeFile(join(manifest.output, 'failure.png'), (await window.webContents.capturePage()).toPNG())
    window?.destroy(); console.error(error); app.exit(1)
  }
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1) })
