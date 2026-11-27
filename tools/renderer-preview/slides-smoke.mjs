import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const check = (value, message) => { if (!value) throw new Error(message) }
const signature = state => JSON.stringify([...state.slidesRecords].sort((a, b) => a.id.localeCompare(b.id)))
const record = (state, id) => state.slidesRecords.find(r => r.id === `shape:${id}`)
const guardSource = `(()=>{
  const calls=[];Object.defineProperty(window,'__slidesDenied',{value:calls});
  const deny=name=>{calls.push(name);window.__slidesViolation(name);throw new Error('SLIDES_CAPABILITY_DENIED:'+name)};
  Object.defineProperty(Navigator.prototype,'clipboard',{get(){return deny('browser.clipboard')},configurable:false});
  const command=Document.prototype.execCommand;Object.defineProperty(Document.prototype,'execCommand',{value:function(name,...args){if(/^(copy|cut|paste)$/i.test(name))return deny('browser.execCommand');return command.call(this,name,...args)},configurable:false,writable:false});
  for(const name of ['showOpenFilePicker','showSaveFilePicker','showDirectoryPicker'])Object.defineProperty(window,name,{value:()=>deny(name),configurable:false,writable:false});
  const click=HTMLInputElement.prototype.click;Object.defineProperty(HTMLInputElement.prototype,'click',{value:function(){if(this.type==='file')return deny('file.click');return click.call(this)},configurable:false,writable:false});
})()`

export async function prepareSlidesProbe(target, clipboard) {
  const calls = []
  for (const name of Object.keys(clipboard)) if (typeof clipboard[name] === 'function') Object.defineProperty(clipboard, name, { value() { calls.push(name); throw new Error('SLIDES_SYSTEM_CLIPBOARD_DENIED:' + name) }, writable: false, configurable: false })
  check(typeof clipboard.readText === 'function', '系统剪贴板守卫缺失')
  try { clipboard.readText() } catch { /* Positive guard probe, never reads OS. */ }
  check(calls.length === 1 && calls[0] === 'readText', '系统剪贴板负探针没有被阻止')
  calls.length = 0
  const contents = target.webContents
  contents.setWindowOpenHandler(() => { calls.push('window.open'); return { action: 'deny' } })
  await target.loadURL('data:text/html,<!doctype html><title>Slides guard</title>')
  contents.debugger.attach('1.3')
  contents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.bindingCalled' && params.name === '__slidesViolation') calls.push(params.payload) })
  await contents.debugger.sendCommand('Runtime.enable')
  await contents.debugger.sendCommand('Runtime.addBinding', { name: '__slidesViolation' })
  await contents.debugger.sendCommand('Page.enable')
  await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: guardSource })
  await contents.executeJavaScript(guardSource)
  const negative = await contents.executeJavaScript("(()=>{try{navigator.clipboard.readText()}catch{}return [...window.__slidesDenied]})()")
  check(JSON.stringify(negative) === '["browser.clipboard"]', '浏览器剪贴板负探针没有被阻止')
  const deadline = Date.now() + 2000
  while (!calls.length && Date.now() < deadline) await delay(5)
  check(JSON.stringify(calls) === '["browser.clipboard"]', '跨导航拒绝记录的负探针没有送达主进程')
  calls.length = 0
  return { calls, negative: { main: 'readText blocked', browser: negative } }
}

export async function slidesSmoke(target, output) {
  const contents = target.webContents, base = new URL(contents.getURL()).origin
  const evaluate = code => contents.executeJavaScript(code), state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
  const samples = []
  async function until(predicate) {
    const end = Date.now() + 20000
    while (Date.now() < end) { const value = await state(); if (value?.error) throw new Error(value.error); if (predicate(value)) return value; await delay(25) }
    throw new Error('Slides 原生等待超时：' + JSON.stringify(await state()))
  }
  let held = false
  async function pointer(type, x, y) {
    if (type === 'mouseDown') held = true
    contents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers: type === 'mouseMove' && held ? ['leftButtonDown'] : [] })
    if (type === 'mouseUp') held = false
    await delay(30)
  }
  const click = async (x, y) => { for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) await pointer(type, x, y) }
  async function drag(from, to) { await pointer('mouseMove', ...from); await pointer('mouseDown', ...from); await pointer('mouseMove', ...to); await pointer('mouseUp', ...to) }
  async function key(keyCode, modifiers = []) { for (const type of ['keyDown', 'keyUp']) { contents.sendInputEvent({ type, keyCode, modifiers }); await delay(30) } }
  const mod = process.platform === 'darwin' ? 'meta' : 'control'
  async function load(kind) {
    await target.loadURL(`${base}/?gallery=slides&case=${kind}&edgeScrolling=0&reduceMotion=1`)
    const initial = await until(s => s?.ready)
    await evaluate('document.querySelector("#canvas").focus();void 0')
    return initial
  }
  async function saved(before) { return until(s => !s.submitting && s.revision !== before.revision) }
  async function undo(before) { await key('z', [mod]); return until(s => !s.submitting && signature(s) === signature(before)) }
  async function cycle(before, after) {
    await undo(before); await key('z', [mod, 'shift']); await until(s => !s.submitting && signature(s) === signature(after)); await undo(before)
  }
  let before = await load('base')
  await drag([80, 80], [400, 80])
  let after = await saved(before)
  check(JSON.stringify(['b', 'c', 'a'].map(id => record(after, id).x)) === '[12,404,616]', '同父级拖页未按中心整理')
  await cycle(before, after); samples.push({ case: 'same-parent-reorder', oneUndo: true, oneRedo: true })
  before = await state()
  await drag([220, 90], [800, 90]); after = await saved(before)
  check(record(after, 'b').parentId === 'shape:target' && record(after, 'b').x === 12 && record(after, 'c').x === 284, '跨套没有在同一事务整理两边')
  await cycle(before, after); samples.push({ case: 'cross-deck', oneUndo: true })
  before = await state()
  await drag([220, 90], [620, 400]); after = await saved(before)
  check(record(after, 'b').parentId === 'page:page' && !record(after, 'b').meta.cowartAiSlidesParentShapeId, '拖出后被旧hint拉回')
  await cycle(before, after); samples.push({ case: 'explicit-out', hintCleared: true })
  before = await state()
  await click(220, 90); await key('Backspace'); after = await saved(before)
  check(!record(after, 'b') && record(after, 'c').x === 284, '键盘删除未补位')
  await cycle(before, after); samples.push({ case: 'delete-middle', oneUndo: true })
  before = await state()
  await click(500, 300); await key('d', [mod]); after = await saved(before)
  const clone = after.selectedIds[0], clonePages = after.slidesRecords.filter(r => r.parentId === clone)
  check(clone !== 'shape:d' && clonePages.length === 3, '整套Mod+D副本缺页')
  check(clonePages.find(r => r.meta.cowartAiSlidesParentShapeId)?.meta.cowartAiSlidesParentShapeId === clone, '整套复制hint仍指原框')
  check(after.slidesRecords.filter(r => r.parentId === 'shape:d').length === 3, '副本页被拉回原框')
  await cycle(before, after); samples.push({ case: 'whole-Mod-D', sourcePages: 3, copiedPages: 3 })
  // ClipboardEvent is private, untrusted input. No OS clipboard is involved.
  const event = (type, formats = {}) => evaluate(`(()=>{const data=new DataTransfer();for(const [type,text] of Object.entries(${JSON.stringify(formats)}))data.setData(type,text);const e=new ClipboardEvent(${JSON.stringify(type)},{clipboardData:data,bubbles:true,cancelable:true});document.dispatchEvent(e);return {trusted:e.isTrusted,prevented:e.defaultPrevented}})()`)
  before = await state(); await click(500, 300)
  check(!(await event('copy')).trusted, '复制事件不应是系统剪贴板事件')
  const copied = await until(s => s.privateClipboard.writes > 0 && !s.clipboardBusy)
  check((await event('paste', copied.privateClipboard.formats)).prevented, '私有粘贴未经过正式处理器')
  after = await saved(before)
  const pasted = after.selectedIds[0]
  check(record(after, pasted.slice(6)).parentId === 'page:page', '整套粘贴进入了原框')
  check(after.slidesRecords.filter(r => r.parentId === pasted).length === 3, '整套粘贴树被拆开')
  check(after.slidesRecords.filter(r => r.parentId === 'shape:d').length === 3, 'C03反例：副本塞回原框')
  await cycle(before, after); samples.push({ case: 'whole-private-copy-paste', treePreserved: true })
  await new Promise(resolve => { contents.once('did-finish-load', resolve); target.reload() }); await until(s => s?.ready)
  check(signature(await state()) === signature(before), '保存重载和撤销后记录不一致')
  before = await load('empty')
  await drag([80, 520], [100, 90]); after = await saved(before)
  check(record(after, 'outside').parentId === 'shape:d' && record(after, 'outside').x === 12 && record(after, 'd').props.w === 1048, '空小框首张页没有撑到默认尺寸')
  await cycle(before, after); samples.push({ case: 'empty-first-page', beforeWidth: 280, afterWidth: 1048 })
  before = await load('locked')
  await click(80, 80); await key('Backspace')
  after = await until(s => !s.submitting && s.lastError?.code === 'slides-layout-locked')
  check(signature(after) === signature(before) && after.revision === before.revision, '锁页拒绝仍改了记录/版本')
  samples.push({ case: 'locked-refusal', reason: after.lastError.code })
  for (const kind of ['rotated', 'group']) {
    before = await load(kind)
    // Pick the container's clear bottom area, away from page handles.
    await click(kind === 'group' ? 480 : 450, 300)
    await key('Right'); after = await saved(before)
    check(record(after, 'd').rotation === record(before, 'd').rotation, '平移改变容器旋转')
    check(record(after, 'a').parentId === 'shape:d', '组/旋转操作拆开了页树')
    await cycle(before, after); samples.push({ case: kind, parentChainPreserved: true })
  }
  check((await evaluate('window.__slidesDenied')).length === 0, '原生过程触碰系统能力')
  await writeFile(join(output, 'slides-native.png'), (await contents.capturePage()).toPNG())
  return { samples, clipboard: 'private ClipboardEvent', input: 'Electron sendInputEvent', persistent: true }
}
