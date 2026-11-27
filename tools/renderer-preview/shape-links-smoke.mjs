import { app, clipboard, shell, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { prepareEmbedsProbe } from './embeds-smoke.mjs'

const check = (value, message) => { if (!value) throw new Error(message) }
const frame = wc => wc.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')

// Installed before the first window. Original shell/clipboard/dialog/printing
// methods are never saved or invoked. Red disables recording only; deny stays on.
export async function prepareShapeLinksProbe({ createWindow, errors }) {
  const opens = [], blocked = [], mainGuards = new Map()
  let recording = true, denied = 0
  const opening = (kind, url) => { denied++; if (recording) opens.push({ kind, url }) }
  const deny = label => () => { blocked.push(label); throw new Error(`Native boundary blocked: ${label}`) }
  for (const [object, prefix, names] of [[clipboard, 'clipboard', Object.getOwnPropertyNames(clipboard).filter(name => typeof clipboard[name] === 'function')],
    [dialog, 'dialog', ['showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync', 'showMessageBox', 'showMessageBoxSync', 'showErrorBox']]]) {
    for (const name of names) { const guard = deny(`${prefix}.${name}`); Object.defineProperty(object, name, { value: guard }); mainGuards.set(`${prefix}.${name}`, { object, name, guard }) }
  }
  const shellGuard = async url => { opening('shell', url) }
  Object.defineProperty(shell, 'openExternal', { value: shellGuard, writable: false, configurable: false })
  app.on('web-contents-created', (_event, wc) => {
    wc.setWindowOpenHandler(({ url }) => { opening('new-window', url); return { action: 'deny' } })
    for (const event of ['will-navigate', 'will-redirect']) wc.on(event, (e, url) => { e.preventDefault(); opening(event, url) })
    for (const name of ['print', 'printToPDF']) Object.defineProperty(wc, name, { value: deny(`webContents.${name}`) })
    wc.session.on('will-download', event => { event.preventDefault(); blocked.push('download') })
  })
  check(shell.openExternal === shellGuard && [...mainGuards.values()].every(({ object, name, guard }) => object[name] === guard), '原生替身身份不符')
  try { clipboard.readText() } catch { /* Safe replaced function only. */ }
  check(blocked.length === 1, '剪贴板原生报错桩红例失效'); blocked.length = 0
  const window = createWindow('shape-links'), wc = window.webContents
  const clipboardProof = await prepareEmbedsProbe(window), debug = wc.debugger
  await debug.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    window.__shapeLinkAudit = { opens: [], blocked: [], events: [] };
    const a=window.__shapeLinkAudit, deny=kind=>(...args)=>{a.blocked.push(kind);throw Error('Page boundary blocked: '+kind)};
    for(const key of ['alert','confirm','prompt','print','showOpenFilePicker','showSaveFilePicker','showDirectoryPicker'])Object.defineProperty(window,key,{value:deny(key),configurable:false});
    Object.defineProperty(window,'open',{value:(url,target,features)=>{a.opens.push({url,target,features});return null},configurable:false});
    document.addEventListener('click',e=>{const node=e.target.closest?.('a');if(node)a.events.push({trusted:e.isTrusted,url:node.href,target:node.target,rel:node.rel});const input=e.target.closest?.('input');if(input&&['file','color'].includes(input.type)){e.preventDefault();a.blocked.push(input.type)}},true);
    addEventListener('keydown',e=>{window.__shapeLinkLastKey=e},true);
  })()` })
  const evaluate = code => wc.executeJavaScript(code), url = 'https://example.invalid/links/guard'
  await window.loadURL('data:text/html,<a id="guard" style="display:block;width:100px;height:100px" target="_blank" rel="noopener noreferrer" href="'+url+'">probe</a>')
  for (const [marker, script] of [['SHAPE_LINK_UNCAUGHT', "queueMicrotask(()=>{throw Error('SHAPE_LINK_UNCAUGHT')});void 0"], ['SHAPE_LINK_REJECTION', "Promise.reject(Error('SHAPE_LINK_REJECTION'));void 0"]]) {
    await evaluate(script); await delay(40)
    check(errors.some(error => error.includes(marker)), `静默异常负探针漏记 ${marker}`)
    for (let i = errors.length - 1; i >= 0; i--) if (errors[i].includes(marker)) errors.splice(i, 1)
  }
  const guards = await evaluate(`(()=>{const result=[];for(const name of ['alert','confirm','prompt','print','showOpenFilePicker','showSaveFilePicker','showDirectoryPicker']){let caught=false;try{window[name]()}catch{caught=true}result.push({name,caught})}window.__shapeLinkAudit.blocked=[];return result})()`)
  check(guards.every(r => r.caught), '页面弹窗保护缺失')
  const click = async () => { for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x: 30, y: 30, button: 'left', clickCount: 1 }); await frame(wc); await delay(30) }
  recording = false; await click()
  let red = false
  try { check(opens.some(r => r.url === url), '故意漏记应失败') } catch { red = true }
  check(red && denied === 1, '红例必须漏记但始终拒绝打开')
  recording = true; await click()
  check(opens.length === 1 && opens[0].url === url && denied === 2, '恢复后真实点击没有记录一次打开')
  const events = await evaluate('window.__shapeLinkAudit.events')
  check(events.length === 2 && events.every(e => e.trusted && e.target === '_blank' && e.rel === 'noopener noreferrer'), '打开红例未走可信原生 anchor')
  await shell.openExternal(url)
  check(opens.length === 2 && opens[1].kind === 'shell', 'shell 记录替身失效')
  const windowOpen = await evaluate(`window.open(${JSON.stringify(url)},'_blank','noopener,noreferrer')===null`)
  check(windowOpen, 'window.open 必须只记录并返回 null')
  await evaluate(`location.href=${JSON.stringify(url)};void 0`); await delay(30)
  check(opens.at(-1)?.kind === 'will-navigate' && opens.at(-1)?.url === url, '同窗口导航未被拒绝')
  const proof = { red, denyStayedEnabled: denied >= 3, clipboardProof, guards, events, opens: [...opens] }
  opens.length = 0
  return { window, opens, blocked, proof }
}

export async function shapeLinksSmoke(window, output, probe) {
  const wc = window.webContents, evaluate = code => wc.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const samples = [], mod = process.platform === 'darwin' ? 'meta' : 'control'
  const flush = () => frame(wc)
  async function until(predicate, label) { const end = Date.now() + 15000; while (Date.now() < end) { const s = await state(); if (s.error) throw new Error(s.error); if (await predicate(s)) return s; await delay(20) } throw new Error(`${label}超时`) }
  async function key(keyCode, modifiers = [], char = keyCode === 'Enter' ? '\r' : null) {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); await flush()
    if (char && !await evaluate('Boolean(window.__shapeLinkLastKey?.defaultPrevented)')) { wc.sendInputEvent({ type: 'char', keyCode: char, modifiers }); await flush() }
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await flush()
  }
  async function click(selector) {
    const p = await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled||n.hidden)throw Error('控件不可用');const r=n.getBoundingClientRect();if(!r.width||!r.height)throw Error('控件不可见');return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, ...p, button: 'left', clickCount: 1 })
    await flush()
  }
  async function point(x, y, count = 1) { for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x, y, button: 'left', clickCount: count }); await flush() }
  async function typeUrl(value) {
    await key('Home'); await key('End', ['shift']); await key('Backspace')
    check(await evaluate('document.querySelector("[data-shape-link-action=url]").value===""'), '原生输入未清空旧网址')
    await wc.insertText(value); await flush()
    check(await evaluate(`document.querySelector('[data-shape-link-action=url]').value===${JSON.stringify(value)}`), '网址输入读回不符')
  }
  async function load() {
    const url = new URL(wc.getURL()); url.search = '?gallery=shape-links&edgeScrolling=0'
    await window.loadURL(url.href); await until(s => s.ready, '链接夹具'); await evaluate("document.querySelector('#canvas').focus();void 0")
    probe.opens.length = 0
  }
  const record = (s, id) => s.linkRecords.find(r => r.id === id)
  async function capture(label) {
    const s = await state(), page = await evaluate('({audit:window.__shapeLinkAudit,clipboard:window.__embedClipboardViolations})')
    check(!page.audit.blocked.length && !page.clipboard.length && !probe.blocked.length, '专项触碰了原生边界')
    samples.push({ label, selectedIds: s.selectedIds, revision: s.revision, commitCalls: s.commitCalls, toolId: s.toolId, linkEditing: s.linkEditing, opens: [...probe.opens] })
    await writeFile(join(output, `${samples.length}-${label}.png`), (await wc.capturePage()).toPNG())
  }
  try {
    await load()
    const a = '[data-shape-link="shape:link-geo"]'
    const attributes = await evaluate(`(()=>{const a=document.querySelector(${JSON.stringify(a)}),r=a.getBoundingClientRect();return {href:a.href,target:a.target,rel:a.rel,label:a.getAttribute('aria-label'),hidden:!!a.closest('[aria-hidden="true"]'),w:r.width,h:r.height}})()`)
    check(attributes.w === 44 && attributes.h === 44 && attributes.target === '_blank' && attributes.rel === 'noopener noreferrer' && attributes.label === '打开链接' && !attributes.hidden, '链接入口尺寸/可访问/属性不符')
    await click(a); check(probe.opens.length === 1 && probe.opens[0].url === attributes.href, '一次点击没有恰好一个目标打开')
    check((await state()).revision === '0' && (await state()).commitCalls === 0, '只读打开写了文档')
    await evaluate("document.querySelector('#canvas').focus();void 0")
    let tabbed = false
    for (let i = 0; i < 40; i++) { await key('Tab'); if (await evaluate(`document.activeElement?.matches(${JSON.stringify(a)})`)) { tabbed = true; break } }
    check(tabbed, '真实 Tab 未到链接'); await key('Enter')
    check(probe.opens.length === 2 && !(await state()).textEditing, '链接 Enter 应只打开一次、不进入文字编辑')
    await key('Space', [], ' '); check(probe.opens.length === 2, 'anchor Space 不应打开')
    await key('K'); check((await state()).toolId === 'laser', 'anchor K 未沿 #209 进入激光笔')
    await capture('native-open-keys')
    await load(); await point(180, 160)
    await click('[data-shape-link-action=open]')
    check(await evaluate('document.activeElement?.dataset.shapeLinkAction==="url"'), 'URL 输入没有初始焦点')
    await typeUrl('example.invalid/changed')
    check((await state()).commitCalls === 0 && record(await state(), 'shape:link-geo').props.url.endsWith('/geo'), '草稿提前写入')
    await key('Enter'); let saved = await until(s => !s.linkEditing && !s.submitting, '原生提交')
    check(saved.commitCalls === 1 && record(saved, 'shape:link-geo').props.url === 'https://example.invalid/changed', '裸域名提交错误')
    await key('Z', [mod]); await until(s => record(s, 'shape:link-geo').props.url.endsWith('/geo'), '一次撤销')
    await key('Z', [mod, 'shift']); await until(s => record(s, 'shape:link-geo').props.url.endsWith('/changed'), '一次重做')
    await capture('edit-one-undo-redo')
    await click('[data-shape-link-action=open]'); await typeUrl('javascript:void(0)')
    check(!(await state()).linkEditing.valid && await evaluate('document.querySelector("[data-shape-link-action=submit]").disabled'), '危险地址没有禁用提交')
    const protectedRecords = JSON.stringify((await state()).linkRecords)
    await key('Delete'); await key('K', [], 'k'); await flush()
    check((await state()).toolId === 'select' && JSON.stringify((await state()).linkRecords) === protectedRecords && (await state()).commitCalls === 1, '真实 input 键错误操作画布')
    await key('Escape'); check(!(await state()).linkEditing && (await state()).commitCalls === 1, 'Esc 应取消草稿')
    await click('[data-shape-link-action=open]'); await click('[data-shape-link-action=clear]')
    saved = await until(s => !s.linkEditing && !s.submitting, '清除')
    check(saved.commitCalls === 2 && record(saved, 'shape:link-geo').props.url === '' && !await evaluate(`!!document.querySelector(${JSON.stringify(a)})`), '清除没有移除链接')
    await capture('invalid-form-clear')
    await load()
    for (const [id, x, y] of [['note', 470, 180], ['image', 760, 180], ['video', 1020, 180]]) {
      await point(x, y); check((await state()).selectedIds[0] === `shape:link-${id}`, `${id}选择前提失败`)
      await click('[data-shape-link-action=open]'); await typeUrl(`example.invalid/${id}-changed`); await key('Enter')
      await until(s => !s.linkEditing && !s.submitting, `${id}保存`)
      check(record(await state(), `shape:link-${id}`).props.url === `https://example.invalid/${id}-changed`, `${id}链接未保存`)
    }
    await capture('four-supported-types')
    await load(); await click('[data-shape-link="shape:link-locked"]')
    check(probe.opens.length === 1 && probe.opens[0].url.endsWith('/locked'), '锁定已有链接仍应只读打开')
    await point(860, 480); check(!(await state()).links.canEdit, '锁定对象不得编辑')
    await point(1100, 470); check(!(await state()).links.canEdit, '普通文字不得编辑附加链接')
    await capture('locks-unsupported')
    await load(); await point(180, 160); await point(180, 160, 2)
    await until(s => Boolean(s.textEditing), '本体文字双击')
    await key('K', [], 'k'); check((await state()).toolId === 'select' && probe.opens.length === 0, '文字输入抢键或误打开链接')
    await key('Escape'); await capture('text-coexist')
    await load(); await point(1020, 180); await point(1020, 180, 2)
    await until(s => s.interactingVideoId === 'shape:link-video', '本地视频互动')
    await evaluate("document.querySelector('video').focus();void 0")
    check(await evaluate('document.querySelector("video").readyState>=2&&document.querySelector("video").paused'), '视频保护没有已解码/暂停前提')
    await key('K', [], 'k'); await key('Space', [], ' ')
    await until(() => evaluate('!document.querySelector("video").paused'), '视频原生 Space')
    check((await state()).toolId === 'select' && (await state()).revision === '0' && !probe.opens.length, '视频输入改了画板或误打开链接')
    await capture('video-coexist')
    await load()
    const clipping = await evaluate(`(()=>{const a=document.querySelector('[data-shape-link="shape:link-clipped"]');return {inside:document.elementFromPoint(298,447)?.closest('a')===a,outside:document.elementFromPoint(320,447)?.closest('a')!==a,rotation:document.querySelector('[data-shape-link-container="shape:link-child"]').style.transform}})()`)
    check(clipping.inside && clipping.outside && clipping.rotation.includes('rotate(0.5rad)'), '原生入口未遵循父框裁切/组旋转')
    await point(320, 447); check(!probe.opens.length, '被裁区域仍能打开链接')
    await point(298, 447); check(probe.opens.length === 1 && probe.opens[0].url.endsWith('/clipped'), '可见的裁切入口不能打开')
    await capture('frame-group-clipping')
    await load(); await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:.5});void 0'); await flush()
    check(await evaluate(`document.querySelector(${JSON.stringify(a)}).getBoundingClientRect().width===22`), '链接没有按文档单位缩放')
    await capture('zoom-clipping')
    await writeFile(join(output, 'shape-links-native.json'), JSON.stringify({ attributes, samples, proof: probe.proof }, null, 2))
    return { attributes, samples, proof: probe.proof }
  } catch (error) {
    await writeFile(join(output, 'shape-links-failure.json'), JSON.stringify({ error: error.stack, state: await state(), opens: probe.opens, blocked: probe.blocked }, null, 2))
    await writeFile(join(output, 'shape-links-failure.png'), (await wc.capturePage()).toPNG()); throw error
  }
}
