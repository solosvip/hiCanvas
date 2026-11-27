import { app, BrowserWindow, clipboard, dialog, shell, Menu, net as electronNet } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, realpathSync, lstatSync, existsSync, statSync } from 'node:fs'
import { resolve, join, relative, isAbsolute, dirname, sep } from 'node:path'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { setTimeout as delay } from 'node:timers/promises'

let target, ending = false, report = () => {}, deadline
function stop(error) {
  if (ending) return
  ending = true
  try { report({ ok: false, error: String(error?.stack || error) }) } catch {}
  try { target?.destroy() } catch {}
  app.exit(1)
}
process.on('uncaughtException', stop); process.on('unhandledRejection', stop)
if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
const manifest = JSON.parse(readFileSync(process.argv.at(-1), 'utf8'))
const root = realpathSync(resolve(dirname(new URL(import.meta.url).pathname), '../..'))
const scratch = join(root, '.scratch')
function inside(base, value) {
  const full = resolve(value), part = relative(base, full)
  if (!part || part === '..' || part.startsWith('..' + sep) || isAbsolute(part)) throw new Error('EXPORT_DENIED:download-path')
  for (let p = full; p !== base; p = dirname(p)) if (existsSync(p) && (lstatSync(p).isSymbolicLink() || realpathSync(p) !== p)) throw new Error('EXPORT_DENIED:download-symlink')
  return full
}
inside(scratch, manifest.output); inside(manifest.output, manifest.result); inside(manifest.output, manifest.profile)
const evidence = { mode: manifest.mode, pid: process.pid, fingerprint: manifest.fingerprint, runtime: process.versions, violations: [], frames: [], downloads: [], samples: [], errors: [], network: [] }
report = extra => writeFileSync(manifest.result, JSON.stringify({ ...evidence, ...extra }, null, 2))
const denied = name => { evidence.violations.push(name); const error = new Error(`EXPORT_DENIED:${name}`); stop(error); throw error }
const lock = (object, name, value) => Object.defineProperty(object, name, { value, configurable: false, writable: false })
function functions(object) {
  const names = new Set()
  for (let p = object; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) for (const key of Object.getOwnPropertyNames(p)) if (key !== 'constructor' && typeof Object.getOwnPropertyDescriptor(p, key)?.value === 'function') names.add(key)
  return [...names]
}
function block(object, prefix, names) { for (const name of names) lock(object, name, () => denied(`${prefix}.${name}`)) }
block(clipboard, 'clipboard', functions(clipboard))
block(dialog, 'dialog', functions(dialog))
block(shell, 'shell', ['openExternal', 'openPath', 'showItemInFolder'])
block(electronNet, 'electronNet', ['request', 'fetch'])
block(globalThis, 'node', ['fetch'])
block(http, 'node.http', ['request', 'get']); block(https, 'node.https', ['request', 'get'])
block(net, 'node.net', ['connect', 'createConnection']); block(net.Socket.prototype, 'node.socket', ['connect']); block(tls, 'node.tls', ['connect'])
mkdirSync(manifest.profile, { recursive: true })
app.setPath('userData', manifest.profile); app.setPath('sessionData', manifest.profile)
app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.localhost 127.0.0.1, MAP localhost 127.0.0.1')
for (const flag of ['disable-background-timer-throttling', 'disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows']) app.commandLine.appendSwitch(flag)
app.on('window-all-closed', () => {})

// Serialized into each target before authored scripts. No original clipboard
// getter is evaluated. A owns downloads only; every clipboard/print call is red.
function pageGuard() {
  if (globalThis.__HICANVAS_EXPORT_GUARD__) return
  const binding = globalThis.__exportBoundary
  if (typeof binding !== 'function') throw new Error('Missing guard binding')
  const blocked = name => { binding(JSON.stringify({ denied: name })); throw new Error(`EXPORT_DENIED:${name}`) }
  const set = (object, name, value) => Object.defineProperty(object, name, { value, configurable: false, writable: false })
  const memory = Object.freeze(Object.fromEntries(['read', 'readText', 'write', 'writeText'].map(name => [name, () => blocked(`browser.clipboard.${name}`)])))
  Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => memory, configurable: false })
  set(navigator, 'clipboard', memory)
  const original = Document.prototype.execCommand
  set(Document.prototype, 'execCommand', function (name, ...args) { return /^(copy|cut|paste)$/i.test(name) ? blocked(`execCommand.${name}`) : original.call(this, name, ...args) })
  for (const type of ['copy', 'cut', 'paste']) document.addEventListener(type, event => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); blocked(`trusted.${type}`) } }, true)
  for (const name of ['print', 'alert', 'confirm', 'prompt', 'open', 'showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) {
    const fn = () => blocked(`window.${name}`)
    if (typeof Window.prototype[name] === 'function') set(Window.prototype, name, fn)
    if (typeof window[name] === 'function') set(window, name, fn)
  }
  if (typeof HTMLInputElement.prototype.showPicker === 'function') set(HTMLInputElement.prototype, 'showPicker', () => blocked('file-picker'))
  document.addEventListener('click', event => { if (event.target?.closest?.('input[type=file]')) { event.preventDefault(); event.stopImmediatePropagation(); blocked('file-picker') } }, true)
  set(window, '__HICANVAS_EXPORT_GUARD__', Object.freeze({
    intact: () => navigator.clipboard === memory,
    probe(name) {
      if (name === 'clipboard') return navigator.clipboard.readText()
      if (name === 'print') return window.print()
      if (name === 'dialog') return window.alert('synthetic')
      if (name === 'network') return fetch('https://export-denied.example.invalid/probe')
      if (name === 'download') {
        const a = document.createElement('a'); a.href = 'data:application/octet-stream;base64,c3ludGhldGlj'; a.download = 'synthetic.bin'; document.body.append(a); a.click(); a.remove(); return true
      }
      throw new Error('Unknown probe')
    },
  }))
}

// Electron waits for the entry module to finish evaluating before ready. Do not
// make module evaluation itself await ready, or no test window can be created.
async function run() {
try {
  await app.whenReady(); app.dock?.hide(); Menu.setApplicationMenu(null)
  const downloads = inside(manifest.output, join(manifest.output, `downloads-${manifest.mode}`)); mkdirSync(downloads, { recursive: true })
  target = new BrowserWindow({ show: false, width: 1280, height: 800, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: `export-${process.pid}`, backgroundThrottling: false } })
  const wc = target.webContents, debug = wc.debugger, pending = new Map()
  block(wc, 'webContents', ['copy', 'cut', 'paste', 'pasteAndMatchStyle', 'copyImageAt', 'print', 'printToPDF'])
  wc.setWindowOpenHandler(() => { denied('window-open'); return { action: 'deny' } })
  wc.on('context-menu', event => event.preventDefault())
  wc.on('render-process-gone', (_event, detail) => stop(new Error(`Renderer ${detail.reason}`)))
  wc.on('console-message', details => { if (details.level === 'error' || details.level >= 3) evidence.errors.push(details.message) })
  wc.on('before-input-event', (event, value) => { if ((value.meta || value.control) && ['c', 'x', 'v'].includes(value.key.toLowerCase())) event.preventDefault() })
  wc.session.setPermissionCheckHandler(() => false); wc.session.setPermissionRequestHandler((_wc, _type, callback) => callback(false))
  const origin = new URL(manifest.url).origin, port = new URL(origin).port, ports = new Set([port])
  let networkCase = 'guard', networkPhase = 'guard', displayedTargets = new Set()
  const networkTarget = 'https://export-observation.example.invalid/content.png'
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || port === '43398') throw new Error('Unknown synthetic host')
  const owned = url => ['http:', 'ws:'].includes(url.protocol) && ports.has(url.port) && (['localhost', '127.0.0.1'].includes(url.hostname) || /^[a-f0-9]{48}\.localhost$/.test(url.hostname))
  const external = value => { try { const url = new URL(value); return !['data:', 'blob:', 'about:'].includes(url.protocol) && !owned(url) } catch { return true } }
  function requestSource(details) {
    const frames = []
    try {
      for (let frame = details.frame; frame && frames.length < 16; frame = frame.parent) {
        frames.push(frame.url)
        // A neutral about:blank capture frame inherits its content parent's
        // source. Determine provenance from frame metadata, never destination.
        if (/^(about:blank|about:srcdoc)?$/.test(frame.url)) continue
        const url = new URL(frame.url)
        if (url.origin === origin) return { source: 'board', frames }
        if (owned(url) && /^[a-f0-9]{48}\.localhost$/.test(url.hostname)) return { source: 'content', frames }
        return { source: 'unknown', frames }
      }
    } catch {}
    // Missing frame metadata cannot turn a request into a trusted content one.
    return { source: 'unknown', frames }
  }
  wc.session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false
    try {
      const url = new URL(details.url)
      allowed = ['data:', 'blob:', 'about:'].includes(url.protocol) || owned(url)
      if (url.origin === origin && url.pathname.startsWith('/api/') && !['/api/health', '/api/content-host/instances'].includes(url.pathname)) allowed = false
    } catch {}
    const row = { url: details.url, ...requestSource(details), referrer: details.referrer, type: details.resourceType, case: networkCase, phase: networkPhase, external: external(details.url), allowed }
    // Test-only substitution: observe the intended remote destination and
    // redirect to fixed loopback pixels before DNS/TCP. This is not a product
    // networking policy or proof that generated content works fully offline.
    if (manifest.mode === 'smoke' && networkCase === 'network' && row.source === 'content' && details.method === 'GET' && row.type === 'image' && row.url === networkTarget && (networkPhase === 'display' || networkPhase === 'export' && displayedTargets.has(row.url))) {
      row.allowed = true; row.redirected = true; evidence.network.push(row)
      callback({ redirectURL: `${origin}/__export_resource` }); return
    }
    evidence.network.push(row); callback({ cancel: !allowed })
    if (!allowed) denied('network')
  })
  wc.session.on('will-download', (event, item) => {
    let path
    try { path = inside(downloads, join(downloads, manifest.mode.endsWith('-download') ? '../refused.bin' : `${evidence.downloads.length}-${item.getFilename().replace(/[^a-zA-Z0-9._-]/g, '_')}`)) }
    catch { event.preventDefault(); item.cancel(); denied('download-path'); return }
    item.setSavePath(path)
    const row = { path, state: 'started' }; evidence.downloads.push(row)
    item.once('done', (_event, state) => { row.state = state; row.bytes = existsSync(path) ? statSync(path).size : 0 })
  })
  deadline = setTimeout(() => stop(new Error('Export native check timed out')), 150000)
  await target.loadURL('about:blank'); debug.attach('1.3')
  const acknowledge = row => {
    if (row?.registered && row.installed && row.resumed) { clearTimeout(pending.get(row.sessionId)); pending.delete(row.sessionId) }
  }
  async function setup(sessionId) {
    const send = (method, params = {}) => debug.sendCommand(method, params, sessionId)
    await send('Runtime.enable'); await send('Page.enable'); await send('Runtime.addBinding', { name: '__exportBoundary' })
    const source = `try{(${pageGuard.toString()})();__exportBoundary(JSON.stringify({ready:true,url:location.href}));}catch(error){__exportBoundary(JSON.stringify({denied:'guard-install',error:String(error)}));window.stop();throw error;}`
    const registration = await send('Page.addScriptToEvaluateOnNewDocument', { source, runImmediately: true })
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'iframe' }, { exclude: true }] })
    if (sessionId) {
      const row = evidence.frames.find(row => row.sessionId === sessionId)
      if (!row || !registration.identifier) throw new Error('Missing child guard registration')
      row.registered = true; await send('Runtime.runIfWaitingForDebugger'); row.resumed = true; acknowledge(row)
    }
  }
  debug.on('message', (_event, method, params, sessionId) => {
    if (method === 'Target.attachedToTarget') {
      const id = params.sessionId
      pending.set(id, setTimeout(() => stop(new Error('Missing child guard acknowledgement')), 3000))
      evidence.frames.push({ sessionId: id, registered: false, installed: false, resumed: false }); void setup(id).catch(stop)
    }
    if (method === 'Runtime.bindingCalled' && params.name === '__exportBoundary') {
      const value = JSON.parse(params.payload)
      if (value.ready) { const row = evidence.frames.find(row => row.sessionId === sessionId); if (row) { row.installed = true; row.url = value.url; acknowledge(row) } }
      else denied(value.denied || 'guard-binding')
    }
    if (method === 'Runtime.exceptionThrown') evidence.errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text)
  })
  await setup(); await debug.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  async function guards() {
    const end = Date.now() + 3500
    while (pending.size) { if (Date.now() > end) throw new Error('Child guard not ready'); await delay(10) }
    if (evidence.violations.length || evidence.frames.some(row => !row.registered || !row.installed || !row.resumed)) throw new Error('Export guard audit failed')
  }
  const evaluate = code => wc.executeJavaScript(code)
  async function until(code, timeout = 30000) {
    const end = Date.now() + timeout
    while (Date.now() < end) { await guards(); const value = await evaluate(code); if (value) return value; await delay(25) }
    throw new Error(`Wait timed out: ${code}`)
  }
  await target.loadURL(`${manifest.url}/__export_guard`)
  if (!await evaluate('window.__HICANVAS_EXPORT_GUARD__.intact()')) throw new Error('Main guard missing')
  if (manifest.mode.startsWith('native-')) {
    const name = manifest.mode.slice(7)
    if (name === 'clipboard') clipboard.readText()
    if (name === 'print') wc.print()
    if (name === 'dialog') dialog.showErrorBox('synthetic', 'forbidden')
    if (name === 'network') globalThis.fetch('https://example.invalid')
    throw new Error('Native red did not stop')
  }
  if (manifest.mode.startsWith('page-')) await evaluate(`window.__HICANVAS_EXPORT_GUARD__.probe(${JSON.stringify(manifest.mode.slice(5))})`)
  if (manifest.mode.startsWith('frame-')) await evaluate(`(()=>{const frame=document.createElement('iframe');frame.src=${JSON.stringify(manifest.url.replace('127.0.0.1', 'localhost') + '/__export_guard?probe=' + manifest.mode.slice(6))};document.body.append(frame);return true})()`)
  if (manifest.mode.startsWith('page-') || manifest.mode.startsWith('frame-')) { await delay(3000); throw new Error('Browser/frame red did not stop') }
  if (manifest.mode === 'green') {
    await evaluate("window.__HICANVAS_EXPORT_GUARD__.probe('download')")
    await until('true'); while (!evidence.downloads.some(row => row.state === 'completed')) await delay(25)
    if (!evidence.downloads.some(row => row.bytes === 9)) throw new Error('Synthetic download failed')
  } else if (manifest.mode === 'smoke') {
    const health = await evaluate("fetch('/api/health').then(r=>r.json())")
    if (!Number.isInteger(health.contentHost?.port) || health.contentHost.port === 43398) throw new Error('Unknown content host')
    ports.add(String(health.contentHost.port))
    for (const kind of ['static', 'animation', 'text', 'decorations', 'external', 'network', 'media', 'empty']) {
      networkCase = kind; networkPhase = 'display'; displayedTargets = new Set()
      await target.loadURL(`${manifest.url}/?gallery=export&case=${kind}&edgeScrolling=0&reduceMotion=1`)
      await until('window.__HICANVAS_RENDERER_PREVIEW__?.getState().ready || (()=>{const s=window.__HICANVAS_RENDERER_PREVIEW__?.getState();if(s?.error)throw Error(s.error);return false})()')
      await until('window.__HICANVAS_EXPORT_PROBE__.mediaReady()')
      await guards()
      if (kind === 'network') {
        const end = Date.now() + 10000
        while (!evidence.network.some(row => row.case === kind && row.phase === 'display' && row.source === 'content' && row.url === networkTarget)) {
          if (Date.now() > end) throw new Error('Content display network sample missing')
          await delay(25)
        }
      }
      displayedTargets = new Set(evidence.network.filter(row => row.case === kind && row.phase === 'display' && row.source === 'content' && row.external).map(row => row.url))
      networkPhase = 'export'
      evidence.samples.push({ kind, result: await evaluate(`window.__HICANVAS_EXPORT_PROBE__.verify(${JSON.stringify(kind)})`) })
      if (kind === 'external') {
        const requests = evidence.network.filter(row => row.case === kind && row.external)
        if (requests.length) throw new Error(`External board assets made requests: ${JSON.stringify(requests)}`)
        evidence.samples.push({ case: 'external-network', externalRequests: requests.length })
      }
      if (kind === 'static') {
        for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x: 300, y: 280, button: 'left', clickCount: 1 })
        await until('window.__HICANVAS_RENDERER_PREVIEW__.getState().selectedIds.length===1')
        for (const name of ['selection-svg', 'selection-png', 'all-svg', 'background', 'selection-png']) {
          await guards()
          const before = await evaluate('window.__HICANVAS_EXPORT_PROBE__.inspect()')
          const box = await evaluate(`(()=>{const r=document.querySelector('[data-export="${name}"]').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
          for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, ...box, button: 'left', clickCount: 1 })
          // A queued native click has not necessarily entered the handler when
          // busy is still false. Wait for this action's observable completion.
          await until(name === 'background' ? `(()=>{const s=window.__HICANVAS_EXPORT_PROBE__.inspect();return !s.busy&&s.background===${!before.background}})()` : `(()=>{const s=window.__HICANVAS_EXPORT_PROBE__.inspect();if(s.lastError)throw Error(s.lastError.message||s.lastError);return !s.busy&&s.history.length===${before.history.length + 1}})()`)
          evidence.samples.push({ nativeAction: name, result: await evaluate('window.__HICANVAS_EXPORT_PROBE__.inspect()') })
        }
        await until('window.__HICANVAS_EXPORT_PROBE__.inspect().history.length===4')
        await delay(100)
        evidence.samples.push({ native: await evaluate('window.__HICANVAS_EXPORT_PROBE__.inspect()') })
      }
      const screenshot = await wc.capturePage(); writeFileSync(join(manifest.output, `${kind}.png`), screenshot.toPNG())
      const exported = evidence.network.filter(row => row.case === kind && row.phase === 'export' && row.external)
      if (exported.some(row => row.source !== 'content' || !displayedTargets.has(row.url))) throw new Error(`Export added a network target: ${JSON.stringify(exported)}`)
      if (kind === 'network' && !exported.length) throw new Error('Content export network positive sample missing')
      evidence.samples.push({ case: `${kind}-network`, boardExternalRequests: exported.filter(row => row.source === 'board').length, unknownExternalRequests: exported.filter(row => row.source === 'unknown').length, contentDisplayTargets: [...displayedTargets], contentExportRequests: exported, unredirectedExternalRequests: exported.filter(row => !row.redirected).length })
    }
    await debug.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false })
    await target.loadURL(`${manifest.url}/?gallery=export&case=static&edgeScrolling=0&reduceMotion=1`)
    await until('window.__HICANVAS_RENDERER_PREVIEW__?.getState().ready')
    evidence.samples.push({ dpr: 2, result: await evaluate("window.__HICANVAS_EXPORT_PROBE__.verify('static')") })
    if (evidence.downloads.length !== 4 || evidence.downloads.some(row => row.state !== 'completed')) throw new Error('Native download result incomplete')
  } else throw new Error('Unknown explicit export mode')
  await guards()
  if (evidence.errors.length) throw new Error(`Uncaught browser errors: ${JSON.stringify(evidence.errors)}`)
  report({ ok: true }); ending = true; clearTimeout(deadline); target.destroy(); app.exit(0)
} catch (error) { stop(error) }
}
void run()
