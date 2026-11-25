import { app, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

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
      let lifecycle
      if (count === 500) lifecycle = await evaluate("import('/tools/renderer-preview/probe.js').then(module => module.runLifecycleProbe())")
      samples.push({ count, initial, pan: pan.camera, zoom: zoom.camera, lifecycle })
      console.log(`${count} 元素与 ${initial.decodedImages} 张图片通过；真实滚轮平移/缩放通过。`)
      window.destroy(); window = undefined
    }
    for (const gallery of ['shapes', 'styles']) {
      window = createWindow(gallery)
      await window.loadURL(`${manifest.url}/?gallery=${gallery}`)
      const initial = await until(async () => { const value = await state(); if (value?.error) throw new Error(value.error); return value?.ready && value })
      check(initial.renderedShapes === initial.count && initial.counts.geo === (gallery === 'shapes' ? 20 : 82), '图鉴元素未完整绘制')
      await writeFile(join(manifest.output, `${gallery}-gallery.png`), (await window.webContents.capturePage()).toPNG())
      const geometry = gallery === 'shapes' ? await evaluate("import('/tools/renderer-preview/geo-probe.js').then(module => module.runGeoProbe())") : undefined
      samples.push({ gallery, initial, geometry })
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
