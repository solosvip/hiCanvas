import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Fail quietly before Electron can turn an uncaught entry error into a dialog.
let app, target, manifest, finishing = false
const errors = [], violations = [], samples = [], locked = [], commits = [], proof = {}
async function finish(error) {
  if (finishing) return
  finishing = true
  if (error) errors.push(String(error.stack || error))
  try {
    if (error && target && !target.isDestroyed()) {
      await writeFile(join(manifest.output, 'failure.png'), (await target.webContents.capturePage()).toPNG())
      await writeFile(join(manifest.output, 'failure-state.json'), JSON.stringify(await state(), null, 2))
    }
  } catch (failure) { errors.push(`Failure capture: ${failure.stack || failure}`) }
  try {
    if (manifest) await writeFile(manifest.result, JSON.stringify({ ok: !errors.length && !violations.length, pid: process.pid,
      fingerprint: manifest.fingerprint, boundary: 'Native pointer/focus/history/text; untrusted private ClipboardEvent only. OS clipboard denied.',
      samples, proof, errors, violations, commits, runtime: process.versions }, null, 2))
    else process.stderr.write(`${errors.join('\n')}\n`)
  } catch (failure) { process.stderr.write(`${failure.stack || failure}\n`) }
  target?.destroy(); app ? app.exit(error || errors.length || violations.length ? 1 : 0) : process.exit(1)
}
process.on('uncaughtException', finish); process.on('unhandledRejection', finish)
const electron = await import('electron')
app = electron.app
manifest = JSON.parse(await readFile(process.argv.at(-1), 'utf8'))
const origin = new URL(manifest.url).origin
if (!origin.startsWith('http://127.0.0.1:')) throw new Error('仅允许本机隔离宿主。')
app.setPath('userData', manifest.profile); app.setPath('sessionData', manifest.profile)
if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
app.on('window-all-closed', () => {})
function deny(object, prefix, only) {
  for (let current = object; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name === 'constructor' || only && !only.includes(name) || typeof Object.getOwnPropertyDescriptor(current, name)?.value !== 'function') continue
      const guard = () => { violations.push(`${prefix}.${name}`); throw Error(`Native boundary blocked: ${prefix}.${name}`) }
      Object.defineProperty(current, name, { value: guard, configurable: false, writable: false }); locked.push([current, name, guard])
    }
  }
}
deny(electron.clipboard, 'clipboard')
deny(electron.dialog, 'dialog', ['showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync', 'showMessageBox', 'showMessageBoxSync', 'showErrorBox'])
deny(electron.shell, 'shell', ['openExternal', 'openPath', 'showItemInFolder'])
const check = (ok, message) => { if (!ok) throw Error(message) }
const evaluate = code => target.webContents.executeJavaScript(code)
const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
const flush = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
const mod = process.platform === 'darwin' ? 'meta' : 'control'
async function until(predicate, label) {
  const end = Date.now() + 10000
  while (Date.now() < end) { const s = await state(); if (s?.error) throw Error(s.error); if (await predicate(s)) return s; await delay(20) }
  throw Error(`${label}超时：${JSON.stringify(await state())}`)
}
async function key(keyCode, modifiers = []) {
  for (const type of ['keyDown', 'keyUp']) target.webContents.sendInputEvent({ type, keyCode, modifiers })
  await flush()
}
async function point(x, y, clickCount = 1) {
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) target.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount })
  await flush()
}
async function click(selector) {
  const p = await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),r=n?.getBoundingClientRect();if(!r?.width||!r.height)throw Error('缺少可见控件');return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
  await point(p.x, p.y)
}
async function focus(owner) {
  await click(`[data-control-225="${owner}"]`)
  check((await state()).inputContext.owner === owner, `${owner}真实焦点未到位`)
  check(await evaluate(`document.activeElement?.getAttribute('data-control-225')===${JSON.stringify(owner)}`), `${owner}焦点前提失败`)
}
async function event(type, formats = {}) {
  return evaluate(`(()=>{const data=new DataTransfer();for(const [type,value]of Object.entries(${JSON.stringify(formats)}))data.setData(type,value);const e=new ClipboardEvent(${JSON.stringify(type)},{clipboardData:data,bubbles:true,cancelable:true,composed:true});document.activeElement.dispatchEvent(e);return{trusted:e.isTrusted,prevented:e.defaultPrevented}})()`)
}
async function load(gallery) {
  if (await evaluate('Boolean(window.__HICANVAS_RENDERER_PREVIEW__)')) await pageBoundary()
  await target.loadURL(`${manifest.url}/?gallery=${gallery}&board=source&edgeScrolling=0&reduceMotion=1`)
  await until(s => s?.ready, '夹具加载'); target.webContents.focus()
  await evaluate(`(()=>{
    const controls=document.createElement('section');controls.id='controls225';controls.style='position:fixed;left:10px;top:100px;z-index:1000;display:grid;gap:8px';
    controls.innerHTML='<button data-control-225="button">ordinary</button><div role="toolbar"><button data-control-225="toolbar-button">toolbar</button></div><a href="#private" data-control-225="anchor">link</a><button aria-haspopup="menu" aria-expanded="false" data-control-225="menu-trigger">menu</button>';
    controls.querySelector('a').onclick=e=>e.preventDefault();document.body.append(controls);document.querySelector('#canvas').focus();
  })();void 0`)
  check(await evaluate('window.__hicanvasEmbedClipboardBoundary?.check()'), '页面剪贴板守卫缺失')
}
const signature = () => evaluate('window.__HICANVAS_EXTERNAL_CLIPBOARD_PROBE__.inspect().then(s=>s.signature)')
const notes = s => JSON.stringify(s.noteRecords)
async function pageBoundary() {
  check(await evaluate('window.__hicanvasEmbedClipboardBoundary?.check() && window.__embedClipboardViolations.length===0'), '页面剪贴板守卫身份或调用记录异常')
}
async function remember(label) {
  const s = await state()
  await pageBoundary()
  check(!s.lastError && !errors.length && !violations.length, `${label}错误：${JSON.stringify({ errors, violations, lastError: s.lastError })}`)
  samples.push({ label, state: s })
  await writeFile(join(manifest.output, 'samples.json'), JSON.stringify(samples, null, 2))
}
async function clipboardCases(owner) {
  await load('clipboard'); await key('A', [mod]); check((await state()).selectedIds.length === 2, '选择源对象失败')
  await focus(owner)
  const initial = await state(), original = await signature(), ids = initial.selectedIds, initialCommits = commits.length
  let sent = await event('copy')
  check(!sent.trusted && sent.prevented, `${owner}复制未经过私有事件`)
  const copied = await until(s => !s.clipboardBusy && s.privateClipboard.writes === 1, '复制')
  check(copied.revision === initial.revision && commits.length === initialCommits && await signature() === original, '复制改了文档')
  check(JSON.stringify(copied.selectedIds) === JSON.stringify(ids), '复制改了选区')
  const formats = copied.privateClipboard.formats
  sent = await event('paste', formats); check(!sent.trusted && sent.prevented, '粘贴未接管')
  const pasted = await until(s => !s.clipboardBusy && !s.submitting && s.renderedShapes === 4, '粘贴')
  check(commits.length === initialCommits + 1 && pasted.selectedIds.length === 2 && pasted.selectedIds.every(id => !ids.includes(id)), '粘贴未整次新增/选择新ID')
  check(JSON.stringify(pasted.selectedShapes.map(s => s.props)) === JSON.stringify(initial.selectedShapes.map(s => s.props)), '粘贴属性改变')
  const pastedSignature = await signature()
  await key('Z', [mod]); await until(s => !s.submitting && s.renderedShapes === 2, '撤销粘贴')
  check(await signature() === original, '粘贴一步撤销不精确')
  await key('Z', [mod, 'shift']); await until(s => !s.submitting && s.renderedShapes === 4, '重做粘贴')
  check(await signature() === pastedSignature, '粘贴一步重做不精确')
  await key('Z', [mod]); await until(s => !s.submitting && s.renderedShapes === 2, '恢复初态')
  await key('A', [mod]); await focus(owner)
  const beforeCutCommits = commits.length; sent = await event('cut')
  check(!sent.trusted && sent.prevented, '剪切未接管')
  const cut = await until(s => !s.clipboardBusy && !s.submitting && s.renderedShapes === 0, '剪切')
  check(commits.length === beforeCutCommits + 1 && cut.privateClipboard.writes === 2, '剪切不止一次IO/提交')
  await key('Z', [mod]); await until(s => !s.submitting && s.renderedShapes === 2, '撤销剪切')
  check(await signature() === original, '剪切一步撤销不精确')
  await key('Z', [mod, 'shift']); await until(s => !s.submitting && s.renderedShapes === 0, '重做剪切')
  await key('Z', [mod]); await until(s => !s.submitting && s.renderedShapes === 2, '恢复源板')
  await remember(`${owner}-clipboard`)
}
async function noteCase(owner) {
  await load('note-editing'); await point(400, 400); await focus(owner)
  const initial = await state()
  const rightPoint = s => {
    const handle = s.overlays.find(o => o.kind === 'note')?.handles.find(h => h.id === 'right')
    check(handle, '控件聚焦时没有续建入口')
    return { x: Math.round((handle.x + s.camera.x) * s.camera.z), y: Math.round((handle.y + s.camera.y) * s.camera.z) }
  }
  const clickRight = async () => { const p = rightPoint(await state()); await point(p.x, p.y) }
  rightPoint(initial)
  await writeFile(join(manifest.output, `${owner}-before-continuation.png`), (await target.webContents.capturePage()).toPNG())
  const source = notes(initial)
  await clickRight()
  let s = await until(s => s.textEditing?.kind === 'note' && s.textEditing.id !== 'shape:note', '指针续建')
  const id = s.textEditing.id
  await target.webContents.insertText(`CONTROL225 ${owner}`); await key('Escape')
  s = await until(s => !s.textEditing && !s.submitting && s.commitCalls === 1, '完成便签')
  const saved = notes(s)
  check(s.noteRecords.filter(r => r.type === 'note').length === 5 && JSON.stringify(s.noteRecords.find(r => r.id === id).props.richText).includes(`CONTROL225 ${owner}`), '续建没有保存整张便签及文字')
  await key('Z', [mod]); await until(s => !s.submitting && notes(s) === source, '续建一步撤销')
  await key('Z', [mod, 'shift']); await until(s => !s.submitting && notes(s) === saved, '续建一步重做')
  await point(400, 400); await focus(owner); await clickRight()
  s = await until(s => s.textEditing?.id === id, '复用相邻便签')
  check(s.noteRecords.filter(r => r.type === 'note').length === 5 && s.commitCalls === 1, '复用多建便签/提交')
  await key('Escape'); await remember(`${owner}-note`)
  await writeFile(join(manifest.output, `${owner}-note.png`), (await target.webContents.capturePage()).toPNG())
}
async function protectedCase(kind) {
  await load('clipboard'); await key('A', [mod])
  const markup = { input: '<input>', textarea: '<textarea></textarea>', contenteditable: '<div contenteditable="true">text</div>',
    menu: '<button aria-haspopup="menu" aria-expanded="true">expanded</button>', select: '<select><option>safe</option></select>',
    video: '<video tabindex="0" data-canvas-input-owner="video"></video>', 'text-editing': '<div tabindex="0" data-canvas-input-owner="text-editing">editing owner</div>',
    composition: '<button>composing</button>' }[kind]
  await evaluate(`(()=>{const n=document.createElement('section');n.id='protected225';n.innerHTML=${JSON.stringify(markup)};document.body.append(n);n.firstElementChild.focus();${kind === 'composition' ? "n.firstElementChild.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));" : ''}})();void 0`)
  const before = await state(), original = await signature(), beforeCommits = commits.length
  const owner = { menu: 'menu-trigger', select: 'select', 'text-editing': 'text-editing', composition: 'button' }[kind] || 'form'
  check(before.inputContext.owner === owner && (kind !== 'composition' || before.inputContext.isComposing), `${kind}保护前提失败`)
  for (const type of ['copy', 'cut', 'paste']) { const sent = await event(type, { 'text/plain': 'CONTROL225 PROTECTED' }); check(!sent.trusted && !sent.prevented, `${kind}截获${type}`) }
  await flush()
  const after = await state()
  check(await signature() === original && after.revision === before.revision && commits.length === beforeCommits && JSON.stringify(after.privateClipboard) === JSON.stringify(before.privateClipboard), `${kind}触发文档或剪贴板IO`)
  await remember(`${kind}-protected`)
  // The same real DOM contexts must hide the selected note's continuation.
  await load('note-editing'); await point(400, 400)
  await evaluate(`(()=>{const n=document.createElement('section');n.innerHTML=${JSON.stringify(markup)};document.body.append(n);n.firstElementChild.focus();${kind === 'composition' ? "n.firstElementChild.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));" : ''}})();void 0`)
  await flush()
  check(!(await state()).overlays.some(o => o.kind === 'note'), `${kind}显示了续建入口`)
  await pageBoundary()
}
async function run() {
  const { prepareEmbedsProbe } = await import('./embeds-smoke.mjs')
  electron.Menu.setApplicationMenu(null); app.dock?.hide()
  target = new electron.BrowserWindow({ show: false, useContentSize: true, width: 1280, height: 800,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, partition: `control225-${process.pid}` } })
  const wc = target.webContents
  deny(wc, 'webContents', ['copy', 'cut', 'paste', 'pasteAndMatchStyle', 'copyImageAt', 'copyVideoFrameAt', 'print', 'printToPDF'])
  wc.setIgnoreMenuShortcuts(true); wc.setWindowOpenHandler(() => { violations.push('new-window'); return { action: 'deny' } })
  for (const name of ['will-navigate', 'will-redirect']) wc.on(name, e => { e.preventDefault(); violations.push(name) })
  wc.on('context-menu', e => e.preventDefault())
  wc.on('before-input-event', (e, v) => { if ((v.meta || v.control) && ['c', 'x', 'v'].includes(v.key.toLowerCase()) || v.key === 'Insert' || v.shift && v.key === 'Delete') e.preventDefault() })
  wc.on('console-message', details => { if (details.level === 'error' || details.level >= 3) errors.push(details.message) })
  wc.on('render-process-gone', (_e, details) => { errors.push(`render-process-gone:${details.reason}`) })
  wc.session.setPermissionRequestHandler((_wc, _permission, reply) => reply(false)); wc.session.setPermissionCheckHandler(() => false)
  wc.session.on('will-download', e => { e.preventDefault(); violations.push('download') })
  wc.session.webRequest.onBeforeRequest((details, reply) => {
    const u = new URL(details.url), allowed = u.origin === origin || u.protocol === 'ws:' && u.host === new URL(origin).host || ['data:', 'blob:', 'about:'].includes(u.protocol)
    if (details.method === 'POST' && ['/api/canvas/clipboard/paste', '/__interaction/commit'].includes(u.pathname)) commits.push({ path: u.pathname, method: details.method })
    if (!allowed) violations.push(`network:${details.url}`)
    reply({ cancel: !allowed })
  })
  // Offscreen contents need an initial document before Runtime.enable can
  // answer. Install native/request guards first; the blank page has no script.
  await target.loadURL('about:blank')
  wc.debugger.attach('1.3')
  await wc.debugger.sendCommand('Runtime.enable'); await wc.debugger.sendCommand('Runtime.addBinding', { name: '__controlFault' })
  wc.debugger.on('message', (_e, method, params) => { if (method === 'Runtime.bindingCalled' && params.name === '__controlFault') errors.push(params.payload) })
  await wc.debugger.sendCommand('Page.enable'); await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{
    addEventListener('error',e=>{__controlFault(String(e.error?.stack||e.message));e.preventDefault()});addEventListener('unhandledrejection',e=>{__controlFault(String(e.reason?.stack||e.reason));e.preventDefault()});
    const deny=name=>()=>{__controlFault('Page boundary:'+name);throw Error('Page boundary:'+name)};
    for(const name of ['alert','confirm','prompt','print','open','showOpenFilePicker','showSaveFilePicker','showDirectoryPicker'])Object.defineProperty(window,name,{value:deny(name),configurable:false});
    for(const type of ['copy','cut','paste'])document.addEventListener(type,e=>{if(e.isTrusted){e.preventDefault();e.stopImmediatePropagation();__controlFault('Trusted OS clipboard event:'+type)}},true);
    document.addEventListener('click',e=>{if(e.target.closest?.('input[type=file],input[type=color]')){e.preventDefault();__controlFault('Native picker')}} ,true);
  })()` })
  proof.clipboard = await prepareEmbedsProbe(target)
  await target.loadURL('data:text/html,<title>control clipboard guard proof</title>')
  for (const marker of ['CONTROL_UNCAUGHT', 'CONTROL_REJECTION']) {
    const before = errors.length
    await evaluate(marker === 'CONTROL_UNCAUGHT' ? "queueMicrotask(()=>{throw Error('CONTROL_UNCAUGHT')});void 0" : "Promise.reject(Error('CONTROL_REJECTION'));void 0")
    await delay(40); check(errors.slice(before).some(e => e.includes(marker)), `${marker}静默负探针失效`)
    for (let i = errors.length - 1; i >= before; i--) if (errors[i].includes(marker)) errors.splice(i, 1)
    check(errors.length === before, `${marker}期间有非预期异常`)
  }
  check(locked.some(([object, name, guard]) => name === 'readText' && object[name] === guard && electron.clipboard.readText === guard), '没有确证主进程自有剪贴板桩')
  try { electron.clipboard.readText() } catch { /* Replaced stub only. */ }
  check(violations.length === 1, '主进程剪贴板红例漏记'); violations.length = 0
  proof.quietExceptions = true; proof.mainClipboard = true
  for (const owner of ['button', 'toolbar-button', 'anchor', 'menu-trigger']) { await clipboardCases(owner); await noteCase(owner) }
  for (const kind of ['input', 'textarea', 'contenteditable', 'text-editing', 'menu', 'select', 'video', 'composition']) await protectedCase(kind)
  for (const [object, name, guard] of locked) check(Object.getOwnPropertyDescriptor(object, name)?.value === guard, '原生守卫身份变化')
  check(!errors.length && !violations.length, '原生边界异常')
}
app.whenReady().then(() => run()).then(() => finish()).catch(finish)
