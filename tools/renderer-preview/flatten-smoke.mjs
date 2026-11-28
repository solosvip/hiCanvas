import { app, clipboard, dialog, shell, net as electronNet, nativeImage } from 'electron'
import { writeFile } from 'node:fs/promises'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute, join, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { setTimeout as delay } from 'node:timers/promises'

const check = (value, message) => { if (!value) throw new Error(message) }
async function until(predicate, label, duration = 30000) {
  const end = Date.now() + duration
  while (Date.now() < end) { const value = await predicate(); if (value) return value; await delay(25) }
  throw new Error(`扁平化检查等待超时：${label}`)
}
function pageGuard(origin, contentPort) {
  if (globalThis.__HICANVAS_FLATTEN_GUARD__) return
  const emit = globalThis.__flattenBoundary
  const denied = name => { emit(JSON.stringify({ denied: name })); throw new Error(`FLATTEN_DENIED:${name}`) }
  const lock = (object, name, value) => Object.defineProperty(object, name, { value, writable: false, configurable: false })
  const memory = Object.freeze(Object.fromEntries(['read', 'readText', 'write', 'writeText'].map(name => [name, () => denied('clipboard')])))
  Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => memory, configurable: false }); lock(navigator, 'clipboard', memory)
  const exec = Document.prototype.execCommand
  lock(Document.prototype, 'execCommand', function(name, ...args) { return /^(copy|cut|paste)$/i.test(name) ? denied('clipboard') : exec.call(this, name, ...args) })
  for (const name of ['copy', 'cut', 'paste']) document.addEventListener(name, event => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); denied('clipboard') } }, true)
  for (const name of ['print', 'alert', 'confirm', 'prompt', 'open', 'showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) if (typeof window[name] === 'function') lock(window, name, () => denied(name === 'print' ? 'print' : 'dialog'))
  if (typeof HTMLInputElement.prototype.showPicker === 'function') lock(HTMLInputElement.prototype, 'showPicker', () => denied('dialog'))
  document.addEventListener('click', event => { if (event.target?.closest?.('input[type=file]')) { event.preventDefault(); event.stopImmediatePropagation(); denied('dialog') } }, true)
  const originalFetch = globalThis.fetch
  lock(globalThis, 'fetch', function(input, options) {
    const url = new URL(typeof input === 'string' ? input : input.url || String(input), location.href)
    const local = url.origin === origin || url.hostname === 'localhost' && url.port === new URL(origin).port || contentPort && /^[a-f0-9]{48}\.localhost$/.test(url.hostname) && Number(url.port) === contentPort
    if (!['data:', 'blob:'].includes(url.protocol) && (!local || /^\/api\/(?:image-models|settings|model)/.test(url.pathname))) return denied('network')
    return originalFetch.call(this, input, options)
  })
  lock(globalThis, '__HICANVAS_FLATTEN_GUARD__', Object.freeze({ intact: () => navigator.clipboard === memory,
    probe(name) {
      if (name === 'clipboard') return navigator.clipboard.readText()
      if (name === 'print') return window.print()
      if (name === 'dialog') return window.alert('synthetic')
      if (name === 'network') return fetch('https://flatten-denied.example.invalid/probe')
      if (name === 'model') return fetch('/api/image-models/generate', { method: 'POST' })
      if (name === 'download') { const a = document.createElement('a'); a.href = 'data:application/octet-stream;base64,c3ludGhldGlj'; a.download = 'refused.bin'; document.body.append(a); a.click(); a.remove(); return true }
      throw new Error('未知守卫探针。')
    },
  }))
  emit(JSON.stringify({ ready: true, url: location.href }))
}

// All probes are synthetic. Red attempts are caught and recorded BEFORE the
// editor is loaded; the deny functions stay installed throughout the real run.
export async function prepareFlattenProbe({ createWindow, manifest, errors }) {
  const root = fileURLToPath(new URL('../../', import.meta.url)), origin = new URL(manifest.url).origin
  const blocked = [], network = [], frames = [], proof = [], pending = new Map()
  const denied = name => { blocked.push(name); return new Error(`FLATTEN_DENIED:${name}`) }
  const lock = (object, name, value) => Object.defineProperty(object, name, { value, writable: false, configurable: false })
  const functions = object => { const names = new Set(); for (let p = object; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) for (const name of Object.getOwnPropertyNames(p)) if (name !== 'constructor' && typeof Object.getOwnPropertyDescriptor(p, name)?.value === 'function') names.add(name); return [...names] }
  const block = (object, names, label) => { for (const name of names) lock(object, name, () => { throw denied(label) }) }
  const inside = (base, path) => {
    const full = resolve(path), part = relative(base, full)
    if (!part || part === '..' || part.startsWith('..' + sep) || isAbsolute(part)) throw denied('file-path')
    for (let current = full; current !== base; current = dirname(current)) if (existsSync(current) && (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current)) throw denied('file-path')
    return full
  }
  check(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && new URL(origin).port !== '43398', '仅允许隔离本机服务。')
  inside(join(root, '.scratch'), manifest.output); inside(manifest.output, manifest.profile); inside(manifest.output, manifest.result)
  app.dock?.hide()
  block(clipboard, functions(clipboard), 'clipboard'); block(dialog, functions(dialog), 'dialog'); block(shell, ['openExternal', 'openPath', 'showItemInFolder'], 'dialog')
  block(electronNet, ['request', 'fetch'], 'network'); block(globalThis, ['fetch'], 'network')
  block(http, ['request', 'get'], 'network'); block(https, ['request', 'get'], 'network'); block(net, ['connect', 'createConnection'], 'network'); block(net.Socket.prototype, ['connect'], 'network'); block(tls, ['connect'], 'network')
  const window = createWindow('flatten'), wc = window.webContents, debug = wc.debugger, evaluate = code => wc.executeJavaScript(code)
  block(wc, ['copy', 'cut', 'paste', 'pasteAndMatchStyle', 'copyImageAt'], 'clipboard'); block(wc, ['print', 'printToPDF'], 'print')
  wc.setWindowOpenHandler(() => { denied('dialog'); return { action: 'deny' } })
  wc.session.setPermissionCheckHandler(() => false); wc.session.setPermissionRequestHandler((_wc, _type, callback) => callback(false))
  wc.session.on('will-download', (event, item) => { event.preventDefault(); item.cancel(); denied('download') })
  wc.session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false
    try {
      const url = new URL(details.url), content = manifest.contentPort && url.protocol === 'http:' && Number(url.port) === manifest.contentPort && /^[a-f0-9]{48}\.localhost$/.test(url.hostname)
      allowed = ['data:', 'blob:'].includes(url.protocol) || content || ['http:', 'ws:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === new URL(origin).port
      if (/^\/api\/(?:image-models|settings|model)/.test(url.pathname)) allowed = false
    } catch { /* invalid protocols remain refused */ }
    network.push({ url: details.url, type: details.resourceType, allowed })
    if (!allowed) denied('network')
    callback({ cancel: !allowed })
  })
  // A newly created offscreen window has no completed document yet. Finish
  // the inert navigation before CDP evaluates a pre-document guard.
  console.log('FLATTEN_STAGE inert-window')
  await window.loadURL('about:blank')
  debug.attach('1.3')
  const acknowledge = row => { if (row.registered && row.installed && row.resumed) { clearTimeout(pending.get(row.sessionId)); pending.delete(row.sessionId) } }
  async function setup(sessionId) {
    const send = (method, params = {}) => debug.sendCommand(method, params, sessionId)
    await send('Runtime.enable'); await send('Page.enable'); await send('Runtime.addBinding', { name: '__flattenBoundary' })
    const registration = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${pageGuard.toString()})(${JSON.stringify(origin)},${JSON.stringify(manifest.contentPort || 0)})`, runImmediately: true })
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'iframe' }, { exclude: true }] })
    if (sessionId) { const row = frames.find(row => row.sessionId === sessionId); check(row && registration.identifier, '子框守卫未登记'); row.registered = true; await send('Runtime.runIfWaitingForDebugger'); row.resumed = true; acknowledge(row) }
  }
  debug.on('message', (_event, method, params, sessionId) => {
    if (method === 'Target.attachedToTarget') {
      const id = params.sessionId; frames.push({ sessionId: id, registered: false, installed: false, resumed: false })
      pending.set(id, setTimeout(() => { errors.push('扁平化子框守卫未确认'); window.destroy() }, 3000))
      void setup(id).catch(error => { errors.push(String(error)); window.destroy() })
    }
    if (method === 'Runtime.bindingCalled' && params.name === '__flattenBoundary') {
      const value = JSON.parse(params.payload)
      if (value.ready) { const row = frames.find(row => row.sessionId === sessionId); if (row) { row.installed = true; row.url = value.url; acknowledge(row) } }
      else denied(value.denied)
    }
  })
  console.log('FLATTEN_STAGE install-guards')
  await setup(); await debug.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  await window.loadURL(`${origin}/__export_guard`)
  const red = async (name, operation) => {
    const start = blocked.length
    try { await operation() } catch { /* the expected denial is asserted below */ }
    await delay(50)
    check(blocked.length > start && blocked.slice(start).every(item => item === name), `红探针未拒绝：${name}`)
    proof.push({ name, denied: blocked.splice(start) })
  }
  await red('clipboard', () => clipboard.readText()); await red('dialog', () => dialog.showErrorBox('synthetic', 'blocked'))
  await red('network', () => globalThis.fetch('https://flatten-denied.example.invalid/probe')); await red('print', () => wc.print())
  await red('file-path', () => inside(manifest.output, join(manifest.output, '../refused.bin')))
  for (const name of ['clipboard', 'dialog', 'print', 'network', 'model', 'download']) await red(name === 'model' ? 'network' : name, () => evaluate(`window.__HICANVAS_FLATTEN_GUARD__.probe(${JSON.stringify(name)})`))
  await evaluate(`(()=>{const frame=document.createElement('iframe');frame.src=${JSON.stringify(origin.replace('127.0.0.1', 'localhost') + '/__export_guard')};document.body.append(frame)})()`)
  const frame = await until(() => frames.find(row => row.registered && row.installed && row.resumed), '跨进程子框保护')
  for (const name of ['clipboard', 'dialog', 'print', 'network', 'model', 'download']) await red(name === 'model' ? 'network' : name, () => debug.sendCommand('Runtime.evaluate', { expression: `window.__HICANVAS_FLATTEN_GUARD__.probe(${JSON.stringify(name)})`, awaitPromise: true }, frame.sessionId))
  check(await evaluate('window.__HICANVAS_FLATTEN_GUARD__.intact()') && !pending.size, '绿探针没有完整保护')
  check(blocked.length === 0, '红探针残留未归档违规')
  // Expected red exceptions can reach Chromium console; keep the exact red
  // messages as proof, then collect the application stage independently.
  const redErrors = errors.splice(0)
  console.log('FLATTEN_STAGE guards-passed')
  return { window, prepared: { blocked, network, frames, proof, redErrors, save: (name, bytes) => writeFile(inside(manifest.output, join(manifest.output, name)), bytes), async assertGuards() { await until(() => !pending.size, '子框保护确认', 3500); check(frames.every(row => row.registered && row.installed && row.resumed), '子框保护未完整确认') } } }
}

export async function flattenSmoke(window, output, probe) {
  const wc = window.webContents, evaluate = code => wc.executeJavaScript(code), mod = process.platform === 'darwin' ? 'meta' : 'control'
  const read = () => evaluate('window.__HICANVAS_FLATTEN_PROBE__.read()'), samples = [], origin = new URL(wc.getURL()).origin
  const flush = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const key = async (keyCode, modifiers = []) => { for (const type of ['keyDown', 'keyUp']) { wc.sendInputEvent({ type, keyCode, modifiers }); await flush() } }
  const click = async (x, y, modifiers = []) => { for (const type of ['mouseDown', 'mouseUp']) { wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers }); await flush() } }
  const button = async selector => {
    const p = await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),r=n?.getBoundingClientRect();if(!r||n.disabled||document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)!==n)throw Error('按钮不可命中');return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await click(p.x, p.y)
  }
  const snapshot = value => JSON.stringify(Object.fromEntries(Object.entries(value.document.store).filter(([, r]) => r.typeName !== 'asset')), (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
  const capture = () => evaluate('window.__HICANVAS_FLATTEN_PROBE__.capture()')
  async function load(kind) {
    await window.loadURL(`${origin}/?gallery=flatten&case=${kind}&edgeScrolling=0&reduceMotion=1`)
    await until(async () => { const state = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()'); if (state?.error) throw new Error(state.error); return state?.ready }, '预览')
    await until(() => evaluate('window.__HICANVAS_FLATTEN_PROBE__.mediaReady()'), '媒体通道')
    await evaluate("document.querySelector('#canvas').focus();void 0")
    check(await evaluate('window.__HICANVAS_FLATTEN_GUARD__.intact()'), '主框保护失效')
    return read()
  }
  for (const kind of ['static', 'text', 'media', 'group-all', 'group-sibling', 'frame']) {
    console.log(`FLATTEN_STAGE case-${kind}`)
    const before = await load(kind), original = await capture()
    await key('a', [mod])
    if (kind === 'group-sibling') {
      await key('Enter')
      const group = before.document.store['shape:flat-group'], sibling = before.document.store['shape:flat-sibling']
      const x = sibling.x + sibling.props.w / 2, y = sibling.y + sibling.props.h / 2
      await click(group.x + x * Math.cos(group.rotation) - y * Math.sin(group.rotation), group.y + x * Math.sin(group.rotation) + y * Math.cos(group.rotation), ['shift'])
      check(JSON.stringify([...(await read()).state.selectedIds].sort()) === JSON.stringify(['shape:flat-a', 'shape:flat-b']), '未选兄弟准备选区错误')
    }
    check((await read()).availability.status === 'ready', `成功格选区不可扁平化：${kind}`)
    if (kind === 'static') await button('[data-flatten-action=start]')
    else await key('f', ['shift'])
    console.log('FLATTEN_ACTION ' + JSON.stringify(await evaluate(`(()=>{const p=window.__HICANVAS_FLATTEN_PROBE__.read(),s=window.__HICANVAS_RENDERER_PREVIEW__.getState();return{selected:p.state.selectedIds,phase:p.state.flattenStatus,tool:p.state.toolId,mode:p.state.mode,input:p.state.inputContext,availability:p.availability,commits:p.commits,error:s.lastError,notice:s.lastNotice}})()`)))
    const after = await until(async () => { const value = await read(); if (value.state.lastError) throw new Error(value.state.lastError.message); return !value.submitting && value.state.flattenStatus?.phase === 'idle' && value.commits === before.commits + 1 && value }, `替换${kind}`)
    const shapes = Object.values(after.document.store).filter(r => r.typeName === 'shape')
    const image = shapes.find(shape => shape.type === 'image' && !before.document.store[shape.id])
    check(image && after.state.selectedIds.length === 1 && after.state.selectedIds[0] === image.id && shapes.length === (kind === 'group-sibling' ? 3 : 1), '未合成一张选中图片')
    if (kind === 'group-sibling') for (const id of ['shape:flat-group', 'shape:flat-sibling']) check(JSON.stringify(after.document.store[id]) === JSON.stringify(before.document.store[id]), '组或未选兄弟被改变')
    const final = await capture(), left = nativeImage.createFromBuffer(Buffer.from(original.base64, 'base64')), right = nativeImage.createFromBuffer(Buffer.from(final.base64, 'base64'))
    check(left.getSize().width === right.getSize().width && left.getSize().height === right.getSize().height, '像素画布尺寸变化')
    const a = left.toBitmap(), b = right.toBitmap(); let changed = 0, ink = 0, delta = 0
    for (let i = 0; i < a.length; i += 4) { if (a[i + 3]) ink++; const d = Math.max(...[0, 1, 2, 3].map(k => Math.abs(a[i + k] - b[i + k]))); if (d) changed++; delta += d }
    check(ink > 1000, '源画面为空，不能算像素通过')
    // Raster resampling may change antialiasing at the same geometry. Keep
    // the full counts/artifacts and require most visible source pixels agree.
    check(delta / (ink * 255) < .025, `画面变化过大：${kind}/${changed}/${ink}`)
    await probe.save(`${kind}-before.png`, Buffer.from(original.base64, 'base64')); await probe.save(`${kind}-after.png`, Buffer.from(final.base64, 'base64'))
    await key('z', [mod]); await until(async () => snapshot(await read()) === snapshot(before), '一次撤销')
    // Restoring media records mounts new frames asynchronously. Do not redo
    // while those paused targets are still installing their guards/channels.
    await until(() => evaluate('window.__HICANVAS_FLATTEN_PROBE__.mediaReady()'), '撤销后媒体通道')
    await probe.assertGuards()
    await key('z', [mod, 'shift']); await until(async () => snapshot(await read()) === snapshot(after), '一次重做')
    samples.push({ kind, oneCommit: true, oneUndoRedo: true, changedPixels: changed, sourceInk: ink, normalizedDelta: delta / (ink * 255), image, original: { ...original, base64: undefined }, final: { ...final, base64: undefined } })
    await probe.save('flatten-progress.json', JSON.stringify({ samples, proof: probe.proof, frames: probe.frames }, null, 2))
    await probe.assertGuards()
  }
  const single = await load('image'); await key('a', [mod]); await key('f', ['shift']); await delay(100)
  check((await read()).commits === single.commits && snapshot(await read()) === snapshot(single), '孤立图片发生替换')
  const unsupported = await load('interleaved'); await click(210, 280); await click(440, 300, ['shift'])
  const unavailable = await read()
  check(unavailable.state.selectedIds.length === 2 && unavailable.availability.status === 'unavailable' && unavailable.availability.message?.includes('夹有未选对象'), '夹层拒绝格缺少真实前置')
  await key('f', ['shift']); await delay(100)
  check((await read()).commits === unsupported.commits && snapshot(await read()) === snapshot(unsupported), '夹层选择产生了部分替换')
  await probe.save('flatten-native.json', JSON.stringify({ proof: probe.proof, redErrors: probe.redErrors, samples, network: probe.network, frames: probe.frames }, null, 2))
  return { samples, proof: probe.proof, network: probe.network, frames: probe.frames }
}
