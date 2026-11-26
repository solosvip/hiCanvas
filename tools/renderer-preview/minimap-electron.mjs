import { app, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { minimapSmoke } from './minimap-smoke.mjs'
import { measureMinimapPerformance } from './minimap-performance.mjs'

const manifest = JSON.parse(await readFile(process.argv.at(-1))), origin = new URL(manifest.url).origin
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('小地图验证只允许隔离本机合成服务。')
app.setName('hiCanvas minimap checks'); app.setPath('userData', manifest.profile); app.setPath('sessionData', manifest.profile)
if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
for (const flag of ['disable-background-timer-throttling', 'disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows']) app.commandLine.appendSwitch(flag)
app.on('window-all-closed', () => {})
async function run() {
  app.dock?.hide()
  const errors = [], blocked = [], results = {}
  let window
  try {
    window = new BrowserWindow({ show: false, width: 1280, height: 800, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true, nodeIntegration: false, partition: `minimap-${process.pid}` } })
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url), allowed = url.origin === origin || url.protocol === 'ws:' && url.hostname === '127.0.0.1' && url.port === new URL(origin).port || ['data:', 'blob:'].includes(url.protocol)
      if (!allowed) blocked.push(details.url)
      callback({ cancel: !allowed })
    })
    window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message) })
    window.webContents.on('render-process-gone', (_, details) => errors.push(details.reason))
    const evaluate = code => window.webContents.executeJavaScript(code)
    async function ready(count) {
      await window.loadURL(`${manifest.url}/?count=${count}`)
      for (let i = 0; i < 1200; i++) {
        const state = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
        if (state?.error) throw new Error(state.error)
        if (state?.ready) return
        await delay(25)
      }
      throw new Error('等待合成预览超时。')
    }
    await ready(500)
    results.smoke = await minimapSmoke(window, manifest.output)
    if (manifest.performance) { await ready(5000); results.performance = await measureMinimapPerformance(window.webContents) }
    if (errors.length || blocked.length) throw new Error(`浏览器错误或越界请求：${JSON.stringify({ errors, blocked })}`)
    await writeFile(manifest.result, JSON.stringify({ ...results, errors, blocked, runtime: process.versions }, null, 2))
    window.destroy(); app.exit(0)
  } catch (error) {
    await writeFile(manifest.result, JSON.stringify({ ...results, error: error.stack, errors, blocked }, null, 2))
    if (window && !window.isDestroyed()) await writeFile(join(manifest.output, 'minimap-failure.png'), (await window.webContents.capturePage()).toPNG())
    console.error(error); window?.destroy(); app.exit(1)
  }
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1) })
