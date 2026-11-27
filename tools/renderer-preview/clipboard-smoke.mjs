import { app, BrowserWindow, clipboard, Menu } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const manifest = JSON.parse(await readFile(process.argv.at(-1), 'utf8'))
const origin = new URL(manifest.url).origin
if (!origin.startsWith('http://127.0.0.1:')) throw new Error('仅允许隔离的本机合成宿主。')
const violations = [], errors = [], samples = [], guarded = [], locked = [], pasteRequests = [], trapRequests = []
const controlledErrors = [], controlledResponses = []
let expectingRuntimeFailure = false
function deny(target, prefix, only) {
  const names = new Set()
  for (let current = target; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) for (const name of Object.getOwnPropertyNames(current)) if (name !== 'constructor') names.add(name)
  for (const name of names) {
    if (only && !only.includes(name)) continue
    let descriptor
    for (let current = target; current && !descriptor; current = Object.getPrototypeOf(current)) descriptor = Object.getOwnPropertyDescriptor(current, name)
    if (typeof descriptor?.value !== 'function') continue
    const path = `${prefix}.${name}`, blocked = () => { violations.push(path); throw new Error(`SYSTEM_CLIPBOARD_FORBIDDEN:${path}`) }
    Object.defineProperty(target, name, { value: blocked, writable: false, configurable: false })
    locked.push([target, name, blocked]); guarded.push(path)
  }
}
deny(clipboard, 'electron.clipboard')
if (!guarded.includes('electron.clipboard.readText') || !guarded.includes('electron.clipboard.writeText')) throw new Error('未锁住系统剪贴板接口。')
app.setPath('userData', manifest.profile); app.setPath('sessionData', manifest.profile)
if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
app.on('window-all-closed', () => {})
let target
const check = (value, message) => { if (!value) throw new Error(message) }
const evaluate = code => target.webContents.executeJavaScript(code)
const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
async function until(predicate) {
  const end = Date.now() + 15000
  while (Date.now() < end) { const value = await state(); if (value?.error) throw new Error(value.error); if (predicate(value)) return value; await delay(20) }
  throw new Error(`剪贴板回归等待超时：${JSON.stringify(await state())}`)
}
const flush = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
async function input(value) { target.webContents.sendInputEvent(value); await flush() }
async function click(x, y) { for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) await input({ type, x, y, button: 'left', clickCount: 1 }) }
async function key(keyCode, modifiers = []) { for (const type of ['keyDown', 'keyUp']) await input({ type, keyCode, modifiers }) }
const mod = process.platform === 'darwin' ? 'meta' : 'control'
const pose = value => value.selectedShapes.map(r => [r.x, r.y])
async function remember(label) { const value = await state(); samples.push({ label, ...value }); return value }
async function event(type, formats = {}) {
  return evaluate(`(()=>{const data=new DataTransfer();for(const [type,text] of Object.entries(${JSON.stringify(formats)}))data.setData(type,text);const event=new ClipboardEvent(${JSON.stringify(type)},{clipboardData:data,bubbles:true,cancelable:true,composed:true});(document.activeElement||document.body).dispatchEvent(event);return{trusted:event.isTrusted,prevented:event.defaultPrevented}})()`)
}
async function open(board) {
  await target.loadURL(`${manifest.url}/?gallery=clipboard&board=${board}&edgeScrolling=0&reduceMotion=1`)
  await until(s => s?.ready); target.webContents.focus()
  await evaluate('document.querySelector("#canvas").focus();void 0')
}

const inspectExternal = () => evaluate('window.__HICANVAS_EXTERNAL_CLIPBOARD_PROBE__.inspect()')
async function externalPaste(fixture) {
  const before = await inspectExternal(), stateBefore = await state(), requests = pasteRequests.length
  const sent = await evaluate(`window.__HICANVAS_EXTERNAL_CLIPBOARD_PROBE__.paste(${JSON.stringify(fixture.name)})`)
  check(!sent.trusted && sent.prevented, `${fixture.name}: 未经过私有合成事件。`)
  const s = await until(value => value.privateClipboard.reads === stateBefore.privateClipboard.reads + 1 && !value.clipboardBusy && !value.submitting)
  const after = await inspectExternal()
  check(after.executionCount === 0 && trapRequests.length === 0, `${fixture.name}: HTML执行或资源请求不为零。`)
  if (fixture.rejected || fixture.empty) {
    check(before.signature === after.signature && before.revision === after.revision && pasteRequests.length === requests, `${fixture.name}: 拒绝/全跳过改变了记录、版本或提交。`)
    check(JSON.stringify(s.selectedIds) === JSON.stringify(stateBefore.selectedIds), `${fixture.name}: 拒绝改变了选择。`)
    if (fixture.rejected) check(s.lastError?.message.includes(fixture.rejected) && !s.lastNotice, `${fixture.name}: 错误提示或错误/通知互斥不正确。`)
    else check(!s.lastError && s.lastNotice?.message.includes('没有可导入的内容') && !after.status.includes('操作失败'), `${fixture.name}: 全跳过未显示普通通知。`)
  } else {
    check(after.count === before.count + fixture.count && after.revision !== before.revision && pasteRequests.length === requests + 1, `${fixture.name}: 没有整批一次提交。`)
    check(s.selectedShapes.length === fixture.count, `${fixture.name}: 新对象未被选择。`)
    if (fixture.text !== undefined) check(JSON.stringify(after.selectedText) === JSON.stringify([fixture.text]), `${fixture.name}: 正文/段落不匹配。`)
    if (fixture.marks) {
      const runs = s.selectedShapes[0].props.richText.content[0].content.filter(node => node.marks?.length).map(node => [node.text, node.marks.map(mark => mark.type)])
      check(JSON.stringify(runs) === JSON.stringify([['B', ['bold']], ['I', ['bold', 'italic']]]), '粗体斜体在真实浏览器中丢失。')
    }
    if (fixture.poses) s.selectedShapes.forEach((r, i) => {
      check(r.parentId === 'page:page', 'Excalidraw错误进入框/组。')
      for (const [actual, expected] of [[r.x, fixture.poses[i][0]], [r.y, fixture.poses[i][1]], [r.rotation, fixture.poses[i][2]]]) check(Math.abs(actual - expected) < 1e-8, `旋转落点不匹配 ${actual} != ${expected}`)
    })
    check(!s.lastError, `${fixture.name}: 成功导入走了错误通道。`)
  }
  if (fixture.notice) check(s.lastNotice?.source === 'clipboard' && !after.status.includes('操作失败'), `${fixture.name}: 缺少独立汇总通知。`)
  samples.push({ label: fixture.name, before, after, pasteRequests: pasteRequests.length - requests, lastNotice: s.lastNotice, lastError: s.lastError })
  return { before, after, state: s }
}

async function externalSmoke() {
  const cases = await evaluate('window.__HICANVAS_EXTERNAL_CLIPBOARD_PROBE__.cases()')
  await key('A', [mod]); await until(s => s.selectedIds.length === 2)
  const failCommit = async () => {
    const before = await inspectExternal(), responses = controlledResponses.length, errorCount = controlledErrors.length
    expectingRuntimeFailure = true
    try {
      const result = await evaluate('window.__HICANVAS_EXTERNAL_CLIPBOARD_PROBE__.failCommit()')
      await flush()
      const after = await inspectExternal()
      check(result.runtimeError && (await state()).lastError && after.signature === before.signature && after.revision === before.revision, '受控提交失败没有留下真实runtime错误或修改了画板。')
      check(controlledResponses.length === responses + 1 && controlledResponses.at(-1).status === 400, '未收到本次合成update的确切400回执。')
      check(controlledErrors.slice(errorCount).every(error => error.url === controlledResponses.at(-1).url), '受控错误不是本次提交请求。')
    } finally { expectingRuntimeFailure = false }
  }
  await failCommit()
  await externalPaste(cases.find(item => item.name === 'excal-all-skipped'))
  check((await inspectExternal()).runtimeError, '显示层不应篡改runtime错误状态。')
  await failCommit()
  const writes = (await state()).privateClipboard.writes
  check((await event('copy')).prevented, '受控失败后复制未接管。')
  await until(s => !s.clipboardBusy && s.privateClipboard.writes === writes + 1)
  check(!(await state()).lastError && !(await inspectExternal()).status.includes('操作失败'), '成功复制被旧runtime错误遮住。')
  await externalPaste(cases.find(item => item.name === 'excal-all-skipped'))
  // Exercise the real host feedback callback with a synthetic error, then a
  // native hover refresh. This is a display-lifecycle test, not a network test.
  await evaluate('window.__HICANVAS_EXTERNAL_CLIPBOARD_PROBE__.reportHostError()')
  await input({ type: 'mouseMove', x: 120, y: 180 })
  check((await inspectExternal()).status.includes('Synthetic host feedback failure'), '持续存在的旧通知清掉了新宿主错误。')
  for (const fixture of cases) {
    const { before, after } = await externalPaste(fixture)
    if (fixture.rejected || fixture.empty) continue
    if (['html-marks', 'excal-convert-skip'].includes(fixture.name)) {
      const camera = (await state()).camera
      if (fixture.name === 'html-marks') await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:160,y:140,z:1})')
      await flush()
      await writeFile(join(manifest.output, `${fixture.name}.png`), (await target.webContents.capturePage()).toPNG())
      if (fixture.name === 'html-marks') await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera(${JSON.stringify(camera)})`)
    }
    let revision = after.revision
    await key('Z', [mod]); await until(s => !s.submitting && s.revision !== revision)
    check((await inspectExternal()).signature === before.signature, `${fixture.name}: 一次原生撤销没恢复整板。`)
    if (fixture.name === 'html-marks') {
      // Rejected/empty pastes must preserve an existing redo branch too.
      await externalPaste(cases.find(item => item.name === 'excal-bad-json'))
      await externalPaste(cases.find(item => item.name === 'excal-all-skipped'))
    }
    revision = (await state()).revision
    await key('Z', [mod, 'shift']); await until(s => !s.submitting && s.revision !== revision)
    check((await inspectExternal()).signature === after.signature, `${fixture.name}: 拒绝后重做分支或内容丢失。`)
    revision = (await state()).revision
    await key('Z', [mod]); await until(s => !s.submitting && s.revision !== revision)
    check((await inspectExternal()).signature === before.signature, `${fixture.name}: 下一夹具前未恢复初态。`)
  }
  await evaluate('window.__HICANVAS_EXTERNAL_CLIPBOARD_PROBE__.prepareContainers()')
  await click(120, 120); await click(120, 120)
  await until(s => s.focusedGroupId === 'shape:external-group')
  const button = await evaluate('(()=>{const r=document.querySelector("[data-selection-action=paste-at-cursor]").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()')
  if (!(await state()).pasteAtCursor) await click(Math.round(button.x), Math.round(button.y))
  await input({ type: 'mouseMove', x: 700, y: 420 })
  const rotation = cases.find(item => item.name === 'excal-rotation')
  await externalPaste(rotation)
  await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:-200,y:-100,z:.5})')
  await externalPaste({ ...rotation, poses: rotation.poses.map(([x, y, angle]) => [x + 700, y + 450, angle]) })
}

function browserGuard() {
  const violation = path => { globalThis.__clipboardViolation(path); throw new Error(`SYSTEM_CLIPBOARD_FORBIDDEN:${path}`) }
  const getter = () => violation('browser.clipboard')
  Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: false, get: getter })
  Object.defineProperty(navigator, 'clipboard', { configurable: false, get: getter })
  const original = Document.prototype.execCommand
  const exec = function (command, ...args) { if (['copy', 'cut', 'paste'].includes(String(command).toLowerCase())) return violation('browser.execCommand'); return original.call(this, command, ...args) }
  Object.defineProperty(Document.prototype, 'execCommand', { configurable: false, writable: false, value: exec })
  // Red probes only call these stubs after checking exact function identities.
  Object.defineProperty(globalThis, '__HICANVAS_CLIPBOARD_BOUNDARY__', { configurable: false, value: Object.freeze({
    check() {
      const own = Object.getOwnPropertyDescriptor(navigator, 'clipboard'), prototype = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard'), command = Object.getOwnPropertyDescriptor(Document.prototype, 'execCommand')
      return own?.get === getter && own.configurable === false && prototype?.get === getter && prototype.configurable === false && command?.value === exec && command.configurable === false && command.writable === false
    },
  }) })
  for (const type of ['copy', 'cut', 'paste']) document.addEventListener(type, event => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); violation(`trusted-${type}`) } }, true)
}
async function run() {
  app.dock?.hide(); Menu.setApplicationMenu(null)
  if (manifest.mode === 'main-red') {
    check(locked.some(([object, name, blocked]) => object === clipboard && name === 'readText' && Object.getOwnPropertyDescriptor(object, name)?.value === blocked), '主进程红灯前未确认自有桩。')
    clipboard.readText(); throw new Error('主进程守卫没有报错。')
  }
  target = new BrowserWindow({ show: false, useContentSize: true, width: 1000, height: 700, webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, partition: `clipboard-${process.pid}` } })
  const contents = target.webContents
  deny(contents, 'webContents', ['copy', 'cut', 'paste', 'pasteAndMatchStyle', 'copyImageAt', 'copyVideoFrameAt'])
  check(['copy', 'cut', 'paste'].every(name => guarded.includes(`webContents.${name}`)), '未锁住窗口原生剪贴板方法。')
  contents.setIgnoreMenuShortcuts(true)
  contents.on('before-input-event', (event, value) => {
    if ((value.meta || value.control) && ['c', 'x', 'v'].includes(String(value.key).toLowerCase()) || value.key === 'Insert' || value.shift && value.key === 'Delete') event.preventDefault()
  })
  contents.on('context-menu', event => event.preventDefault())
  contents.on('console-message', details => {
    if (details.level === 'error' || details.level >= 3) {
      let url
      try { url = new URL(details.sourceId) } catch { /* An unlocated error is never an expected HTTP failure. */ }
      if (expectingRuntimeFailure && url?.origin === origin && url.pathname === '/__interaction/commit' && /Failed to load resource: the server responded with a status of 400\b/.test(details.message)) controlledErrors.push({ message: details.message, url: url.href })
      else errors.push(details.message)
    }
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.session.setPermissionRequestHandler((_contents, _permission, reply) => reply(false))
  contents.session.setPermissionCheckHandler(() => false)
  contents.session.webRequest.onBeforeRequest((details, reply) => {
    const url = new URL(details.url), allowed = url.origin === origin || url.protocol === 'ws:' && url.host === new URL(origin).host || ['data:', 'blob:', 'about:'].includes(url.protocol)
    if (details.method === 'POST' && url.pathname === '/api/canvas/clipboard/paste') pasteRequests.push({ url: details.url, method: details.method })
    if (url.pathname.includes('__clipboard_trap__')) trapRequests.push({ url: details.url, type: details.resourceType })
    if (!allowed) errors.push(`Unexpected network: ${details.url}`)
    reply({ cancel: !allowed })
  })
  contents.session.webRequest.onCompleted(details => {
    const url = new URL(details.url)
    if (expectingRuntimeFailure && details.method === 'POST' && url.origin === origin && url.pathname === '/__interaction/commit') controlledResponses.push({ url: details.url, status: details.statusCode })
  })
  contents.on('will-frame-navigate', event => { if (event.url.includes('__clipboard_trap__')) { event.preventDefault(); trapRequests.push({ url: event.url, type: 'frame-navigation' }) } })
  await target.loadURL('about:blank')
  contents.debugger.attach('1.3')
  contents.debugger.on('message', (_event, method, params) => {
    if (method === 'Runtime.bindingCalled' && params.name === '__clipboardViolation') violations.push(params.payload)
    if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Runtime exception')
  })
  await contents.debugger.sendCommand('Runtime.enable')
  await contents.debugger.sendCommand('Page.enable')
  // A hidden offscreen window has no OS focus. Emulate document focus so native
  // pointer clicks emit focusin/out and exercise the host's real focus routing.
  await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  await contents.debugger.sendCommand('Runtime.addBinding', { name: '__clipboardViolation' })
  await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(${browserGuard.toString()})();` })
  await open('source')
  if (manifest.mode === 'browser-red') { await evaluate('(()=>{if(!globalThis.__HICANVAS_CLIPBOARD_BOUNDARY__?.check())throw new Error("Missing own browser guard");return navigator.clipboard})()'); throw new Error('浏览器守卫没有报错。') }
  if (manifest.mode === 'frame-red') { await evaluate('(async()=>{const f=document.createElement("iframe");await new Promise(r=>{f.onload=r;f.src="about:blank";document.body.append(f)});if(!f.contentWindow.__HICANVAS_CLIPBOARD_BOUNDARY__?.check())throw new Error("Missing own child guard");f.contentWindow.document.execCommand("copy")})()'); throw new Error('子框守卫没有报错。') }
  check(await evaluate('globalThis.__HICANVAS_CLIPBOARD_BOUNDARY__?.check()'), '回归页面的剪贴板守卫未安装。')
  await key('A', [mod]); await until(s => s.selectedIds.length === 2)
  let before = await state(), dispatched = await event('copy')
  check(!dispatched.trusted && dispatched.prevented, '复制必须经过合成ClipboardEvent边界。')
  let s = await until(s => !s.clipboardBusy && s.privateClipboard.writes === 1)
  check(s.revision === before.revision, '复制改了画板版本。')
  const formats = s.privateClipboard.formats
  for (let i = 0; i < 2; i++) {
    const revision = s.revision
    await event('paste', formats); s = await until(s => !s.clipboardBusy && !s.submitting && s.revision !== revision)
    check(JSON.stringify(pose(s)) === '[[100,160],[340,260]]', '默认/重复粘贴没有原位重叠。')
  }
  await remember('repeat-original-position')
  let revision = s.revision; await key('Z', [mod]); s = await until(s => s.revision !== revision && !s.submitting && s.renderedShapes === 4)
  check(s.renderedShapes === 4, '一次撤销没有移除整次两项粘贴。')
  revision = s.revision; await key('Z', [mod, 'shift']); await until(s => s.revision !== revision && !s.submitting)
  const box = await evaluate('(()=>{const r=document.querySelector("[data-selection-action=paste-at-cursor]").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()')
  await click(Math.round(box.x), Math.round(box.y)); await until(s => s.pasteAtCursor)
  await input({ type: 'mouseMove', x: 800, y: 550 })
  revision = (await state()).revision; await event('paste', formats)
  s = await until(s => s.revision !== revision && !s.clipboardBusy && !s.submitting)
  check(JSON.stringify(pose(s)) === '[[640,440],[880,540]]', '光标偏好没有把整体中心放在指针处。')
  await remember('cursor-preference-native-button')
  await evaluate('(()=>{const e=document.createElement("input");e.id="clipboard-input";e.style="position:fixed;left:20px;top:500px;z-index:20;width:200px;height:44px";document.body.append(e)})();void 0')
  await click(70, 520); before = await remember('native-form-focused')
  check(await evaluate('document.activeElement?.id === "clipboard-input"'), `原生点击没有聚焦表单：${JSON.stringify(before.inputContext)}`)
  check(before.inputContext.owner === 'form', `表单焦点没有转交输入归属：${JSON.stringify(before.inputContext)}`)
  for (const type of ['copy', 'cut', 'paste']) check(!(await event(type, formats)).prevented, '表单中的剪贴板事件被画布截获。')
  s = await state(); check(JSON.stringify(s.privateClipboard) === JSON.stringify(before.privateClipboard) && s.revision === before.revision, '表单触发了剪贴板IO或修改。')
  await evaluate('document.querySelector("#canvas").focus();document.querySelector("#canvas").dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));void 0')
  for (const type of ['copy', 'cut', 'paste']) check(!(await event(type, formats)).prevented, '组字中截获了剪贴板事件。')
  await evaluate('document.querySelector("#canvas").dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}));void 0')
  await remember('native-form-focus-synthetic-composition-no-io')
  before = await state(); await event('cut')
  s = await until(s => !s.clipboardBusy && !s.submitting && s.revision !== before.revision && s.renderedShapes === before.renderedShapes - 2)
  check(!s.selectedIds.length && s.renderedShapes === before.renderedShapes - 2, '剪切没有删除一次选择。')
  await key('Z', [mod]); await until(s => s.renderedShapes === before.renderedShapes && !s.submitting)
  await writeFile(join(manifest.output, 'clipboard-source.png'), (await contents.capturePage()).toPNG())
  await open('target'); revision = (await state()).revision
  // Canonical records arrive before the renderer's next frame. Require the
  // actual DOM count too, rather than mistaking a committed receipt for paint.
  await event('paste', formats); s = await until(s => !s.clipboardBusy && !s.submitting && s.revision !== revision && s.renderedShapes === 2)
  samples.push({ label: 'cross-board-receipt', ...s })
  check(JSON.stringify(pose(s)) === '[[100,160],[340,260]]' && s.renderedShapes === 2, `跨板没有保留内容和世界落点：${JSON.stringify({ pose: pose(s), rendered: s.renderedShapes, selected: s.selectedIds })}`)
  await remember('cross-board'); await open('target')
  check((await until(s => s.renderedShapes === 2)).renderedShapes === 2, '刷新后粘贴丢失。')
  await writeFile(join(manifest.output, 'clipboard-target.png'), (await contents.capturePage()).toPNG())
  await externalSmoke()
  check(!violations.length && !errors.length, JSON.stringify({ violations, errors }))
  for (const [object, name, blocked] of locked) check(Object.getOwnPropertyDescriptor(object, name)?.value === blocked, '系统剪贴板守卫被替换。')
}
async function main() {
  try {
    await run()
    await writeFile(manifest.result, JSON.stringify({ ok: true, mode: manifest.mode, fingerprint: manifest.fingerprint, pid: process.pid, boundary: 'synthetic ClipboardEvent/private DataTransfer; emulated document focus with native pointers, modifiers, preference button and form click; system clipboard never used', samples, guarded, violations, errors, controlledErrors, controlledResponses, pasteRequests, trapRequests, runtime: process.versions }, null, 2))
    target?.destroy(); app.exit(0)
  } catch (error) {
    await writeFile(manifest.result, JSON.stringify({ ok: false, mode: manifest.mode, fingerprint: manifest.fingerprint, pid: process.pid, guarded, violations, errors: [...errors, String(error.stack || error)], samples, controlledErrors, controlledResponses, pasteRequests, trapRequests }, null, 2))
    target?.destroy(); app.exit(1)
  }
}
// Electron waits for its entry module to finish before emitting ready. Awaiting
// run() at module scope while run waits for ready would deadlock this probe.
app.whenReady().then(main).catch(error => { console.error(error); app.exit(1) })
