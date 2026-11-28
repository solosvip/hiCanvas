import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { externalSamples } from './external-samples.js'
import { embedsInteractionSmoke } from './embeds-interaction-smoke.mjs'

const check = (condition, message) => { if (!condition) throw new Error(message) }
export async function prepareEmbedsProbe(window) {
  const debug = window.webContents.debugger
  if (!debug.isAttached()) debug.attach('1.3')
  await window.loadURL('data:text/html,<title>isolated embed probe</title>')
  await debug.sendCommand('Page.enable')
  await debug.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    window.__embedClipboardViolations = [];
    const denied = () => { window.__embedClipboardViolations.push('system clipboard'); throw new Error('System clipboard blocked by embed probe') };
    Object.defineProperty(navigator, 'clipboard', { configurable: false, get: denied });
    Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: false, get: denied });
    const exec = Document.prototype.execCommand;
    const guardedExec = function(name, ...args) { if (['copy','cut','paste'].includes(String(name).toLowerCase())) return denied(); return exec.call(this, name, ...args) };
    Object.defineProperty(Document.prototype, 'execCommand', { configurable: false, writable: false, value: guardedExec });
    Object.defineProperty(window, '__hicanvasEmbedClipboardBoundary', { configurable: false, writable: false, value: Object.freeze({
      check: () => Object.getOwnPropertyDescriptor(navigator, 'clipboard')?.get === denied && Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard')?.get === denied && Object.getOwnPropertyDescriptor(Document.prototype, 'execCommand')?.value === guardedExec
    }) });
  })()` })
  await window.loadURL('data:text/html,<title>embed clipboard guard proof</title>')
  const proof = await window.webContents.executeJavaScript(`(async()=>{
    if(!window.__hicanvasEmbedClipboardBoundary?.check())throw Error('Browser clipboard guard identity missing; do not call native methods');
    let blocked=0;for(const run of [()=>navigator.clipboard,()=>document.execCommand('copy')]){try{run()}catch{blocked++}}
    const frame=document.createElement('iframe'),loaded=new Promise(resolve=>frame.onload=resolve);frame.src='about:blank';document.body.append(frame);await loaded;
    const child=frame.contentWindow;if(!child.__hicanvasEmbedClipboardBoundary?.check())throw Error('Child clipboard guard identity missing; do not call native methods');
    let childBlocked=0;try{child.document.execCommand('copy')}catch{childBlocked++}
    const result={blocked,violations:window.__embedClipboardViolations.length,childBlocked,childViolations:child.__embedClipboardViolations.length};frame.remove();return result;
  })()`)
  check(proof.blocked === 2 && proof.violations === 2 && proof.childBlocked === 1 && proof.childViolations === 1, '浏览器或子框架剪贴板报错桩红例未达到预期')
  return proof
}

// Ordinary native pointer/key input plus explicitly untrusted ClipboardEvents.
// No real clipboard, provider page or input HTML is ever loaded.
export async function embedsSmoke(window, output) {
  const wc = window.webContents, evaluate = code => wc.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const stages = [], mod = process.platform === 'darwin' ? 'meta' : 'control'
  const until = async (predicate, label) => { const end = Date.now() + 15000; while (Date.now() < end) { const value = await state(); if (predicate(value)) return value; await delay(20) } throw new Error(`${label}超时：${JSON.stringify(await state())}`) }
  const flush = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  async function key(keyCode, modifiers = []) {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    // Electron's raw keyDown/Up omits the character event used by native form
    // activation. Send the real carriage return, rather than calling click().
    if (keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers })
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await flush()
  }
  async function click(selector) {
    const point = await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node||node.disabled||node.hidden)throw Error('当前控件不可用');const r=node.getBoundingClientRect();if(!r.width||!r.height)throw Error('当前控件不可见');return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 })
    await flush()
  }
  async function type(value) {
    await key('Home'); await key('End', ['shift']); await key('Backspace')
    check(await evaluate('document.querySelector("[data-embed-action=url]").value===""'), '原生输入未清空旧网址')
    await wc.insertText(value); await flush()
    check(await evaluate(`document.querySelector('[data-embed-action=url]').value===${JSON.stringify(value)}`), '原生输入读回与网址不一致')
  }
  async function record(label) { const value = await state(); stages.push({ label, state: value }); await writeFile(join(output, 'embeds-native.json'), JSON.stringify({ stages }, null, 2)); return value }
  async function capture(label) { await writeFile(join(output, `${label}.png`), (await wc.capturePage()).toPNG()) }
  const initial = await record('initial')
  const recordsSignature = records => JSON.stringify([...records].sort((a, b) => a.id.localeCompare(b.id)), (_key, value) => value && !Array.isArray(value) && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)
  await click('[data-embed-action=open]')
  await until(s => s.embedEditing && !s.embedEditing.serviceId, '打开列表')
  check(await evaluate('document.querySelectorAll("[data-embed-action^=service-]").length===18 && document.querySelector("[data-embed-action=service-G16]").disabled'), '服务列表或Gist状态错误')
  await capture('services-wide')
  window.setContentSize(520, 780); await flush(); await capture('services-narrow')
  check(await evaluate('(()=>{const d=document.querySelector("dialog[open]"),r=d.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight})()'), '窄窗对话框越界')
  window.setContentSize(1280, 800); await flush()
  await click('[data-embed-action=service-G06]'); await until(s => s.embedEditing?.serviceId === 'G06', '选择Figma')
  await click('[data-embed-action=back]'); await until(s => s.embedEditing && !s.embedEditing.serviceId, '返回列表')
  await click('[data-embed-action=cancel]'); await until(s => !s.embedEditing, '取消')
  await capture('cancelled')
  check((await state()).revision === initial.revision && (await state()).commitCalls === 0, '列表/返回/取消写了文档')
  await key('I', [mod]); await until(s => !!s.embedEditing, 'Mod+I')
  await click('[data-embed-action=service-G13]'); await until(s => s.embedEditing?.serviceId === 'G13', '选择YouTube')
  for (const url of ['not-a-url', 'javascript:alert(1)', 'https://unknown.example.invalid', 'http://www.youtube.com/watch?v=synthetic83']) {
    await type(url)
    check(!(await state()).embedEditing.valid && await evaluate('document.querySelector("[data-embed-action=submit]").disabled'), '坏地址启用了创建')
  }
  await capture('invalid-url')
  await type('https://www.youtube.com/watch?v=synthetic83')
  await until(s => s.embedEditing?.valid, '有效网址')
  await capture('valid-url')
  await key('Tab')
  check(await evaluate('document.activeElement?.dataset.embedAction==="back"'), 'Tab没有到返回按钮')
  await key('Enter'); await until(s => s.embedEditing && !s.embedEditing.serviceId, '原生Enter返回')
  check((await state()).commitCalls === 0, '返回按钮Enter误提交')
  await click('[data-embed-action=service-G13]'); await type('https://www.youtube.com/watch?v=synthetic83')
  await key('Tab'); await key('Tab'); await key('Tab')
  check(await evaluate('document.activeElement?.dataset.embedAction==="cancel"'), 'Tab没有到取消按钮')
  await key('Enter'); await until(s => !s.embedEditing, '原生Enter取消')
  check((await state()).commitCalls === 0 && (await state()).revision === initial.revision, '取消按钮Enter误提交')
  await key('I', [mod]); await click('[data-embed-action=service-G13]'); await type('https://www.youtube.com/watch?v=synthetic83')
  await click('[data-embed-action=submit]')
  const created = await until(s => !s.embedEditing && s.commitCalls === 1 && !s.submitting, '创建')
  const embed = created.selectedShapes[0]
  check(embed.type === 'embed' && embed.w === 800 && embed.h === 450 && embed.x === 240 && embed.y === 175, '默认尺寸或视口中心落点不符')
  check(await evaluate('document.activeElement===document.querySelector("#canvas")'), '关闭对话框没有归还画布焦点')
  await capture('created-embed'); await record('created')
  const signature = JSON.stringify(created.embedRecords)
  await key('Z', [mod]); await until(s => !s.submitting && s.embedRecords.length === 0, '原生撤销')
  await key('Z', [mod, 'shift']); await until(s => !s.submitting && JSON.stringify(s.embedRecords) === signature, '原生重做')
  await click(`[data-embed-content="${embed.id}"]`)
  await until(s => s.selectedIds.length === 1 && s.selectedIds[0] === embed.id, '重新选择重做后的嵌入')
  // A same-ID record type change must unmount the old React content view.
  // External embeds allocate no generated-content instance; generated sources
  // are rejected by the semantic conversion command before this view changes.
  await evaluate(`window.__oldConvertedEmbedFrame=document.querySelector('[data-embed-content="${embed.id}"]')`)
  check(await evaluate('!!window.__oldConvertedEmbedFrame?.isConnected'), '转换前实际iframe未挂载')
  await click('[data-embed-action=convert-bookmark]')
  const bookmarked = await until(s => !s.submitting && s.selectedShapes[0]?.id === embed.id && s.selectedShapes[0]?.type === 'bookmark', '同ID转书签')
  check(bookmarked.commitCalls === 2 && bookmarked.selectedShapes[0].w === 300 && bookmarked.selectedShapes[0].h === 46, '转换并非一条命令或书签尺寸错误')
  const noOldFrame = () => evaluate(`!window.__oldConvertedEmbedFrame.isConnected && document.querySelectorAll('[data-embed-content="${embed.id}"]').length===0`)
  check(await noOldFrame(), '同ID转换残留旧iframe')
  check(await evaluate('document.activeElement===document.querySelector("#canvas")'), '转换后没有归还画布焦点')
  await record('converted-bookmark'); await capture('converted-bookmark')
  await key('Z', [mod]); await until(s => !s.submitting && recordsSignature(s.embedRecords) === recordsSignature(created.embedRecords), '转换一步撤销完整记录')
  check(await evaluate(`document.querySelectorAll('[data-embed-content="${embed.id}"]').length===1 && !window.__oldConvertedEmbedFrame.isConnected`), '撤销没有重新挂载嵌入视图')
  await key('Z', [mod, 'shift']); await until(s => !s.submitting && recordsSignature(s.embedRecords) === recordsSignature(bookmarked.embedRecords), '转换一步重做完整记录')
  check(await noOldFrame(), '重做转换残留iframe')
  await click('[data-embed-action=convert-embed]')
  const convertedBack = await until(s => !s.submitting && s.selectedShapes[0]?.id === embed.id && s.selectedShapes[0]?.type === 'embed', '同ID转嵌入')
  check(convertedBack.commitCalls === 3 && convertedBack.selectedShapes[0].x === embed.x && convertedBack.selectedShapes[0].y === embed.y, '反向转换未保持中心或事务次数错误')
  check(await evaluate(`document.querySelectorAll('[data-embed-content="${embed.id}"]').length===1 && !window.__oldConvertedEmbedFrame.isConnected`), '反向转换没有挂载唯一的新iframe')
  await record('converted-embed')
  async function paste(formats, { type: expectedType, size, notice = false, rejected = false } = {}) {
    const before = await state()
    const sent = await evaluate(`(()=>{const data=new DataTransfer();for(const [type,text] of Object.entries(${JSON.stringify(formats)}))data.setData(type,text);const host=document.querySelector('#canvas');host.focus();const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});host.dispatchEvent(event);return{trusted:event.isTrusted,prevented:event.defaultPrevented}})()`)
    check(!sent.trusted && sent.prevented, '没有经过既有合成剪贴板事件')
    const after = await until(s => !s.clipboardBusy && !s.submitting && s.privateClipboard.reads === before.privateClipboard.reads + 1, '合成粘贴')
    if (rejected) check(after.revision === before.revision && after.commitCalls === before.commitCalls && JSON.stringify(after.embedRecords) === JSON.stringify(before.embedRecords) && after.lastError, '坏iframe改变了记录/版本或漏报错误')
    else {
      check(after.commitCalls === before.commitCalls + 1 && after.selectedShapes[0].type === expectedType && !after.lastError, '粘贴类型或单次事务不符')
      if (size) check(JSON.stringify([after.selectedShapes[0].w, after.selectedShapes[0].h]) === JSON.stringify(size), '输入宽高覆盖服务默认尺寸')
      check(Boolean(after.lastNotice) === notice, '书签回退提示不符')
    }
    check(await evaluate('window.__hicanvasExternalExecuted===0 && window.__embedClipboardViolations.length===0'), '输入HTML执行了代码或碰了系统剪贴板')
    if (!rejected && expectedType === 'bookmark') {
      await key('Z', [mod]); await until(s => !s.submitting && recordsSignature(s.embedRecords) === recordsSignature(before.embedRecords), '书签与资源一次撤销')
      await key('Z', [mod, 'shift']); await until(s => !s.submitting && recordsSignature(s.embedRecords) === recordsSignature(after.embedRecords), '书签与资源一次重做')
    }
    return record(`paste-${stages.length}`)
  }
  await paste({ 'text/html': '<iframe src="https://www.youtube.com/embed/synthetic83" width="900" height="300" sandbox="allow-top-navigation" allow="camera" onload="window.__hicanvasExternalExecuted++" srcdoc="&lt;script&gt;window.parent.__hicanvasExternalExecuted++&lt;/script&gt;"></iframe>' }, { type: 'embed', size: [800, 450] })
  check(await evaluate('(()=>{const f=[...document.querySelectorAll("iframe")].at(-1);return !f.hasAttribute("srcdoc")&&!f.hasAttribute("onload")&&f.getAttribute("sandbox").includes("allow-presentation")&&!f.getAttribute("sandbox").includes("allow-top-navigation")})()'), '输入权限或srcdoc进入实际iframe')
  for (const url of ['https://unknown.example.invalid/page', 'http://www.youtube.com/watch?v=synthetic83']) await paste({ 'text/html': `<iframe src="${url}"></iframe>` }, { type: 'bookmark', size: [300, 46], notice: true })
  for (const html of ['<iframe src="javascript:alert(1)"></iframe>', '<iframe src="/relative"></iframe>', '<iframe srcdoc="bad"></iframe>', '<iframe src="https://youtu.be/synthetic83"></iframe><iframe src="https://youtu.be/other"></iframe>', '<script>window.__hicanvasExternalExecuted++</script><iframe src="https://youtu.be/synthetic83"></iframe>']) await paste({ 'text/html': html }, { rejected: true })
  for (const url of ['https://www.tldraw.com/r/synthetic83', 'https://gist.github.com/synthetic/0123456789abcdef0123456789abcdef', 'https://ordinary.example.invalid/page']) await paste({ 'text/plain': url }, { type: 'bookmark', size: [300, 46] })
  const figma = externalSamples.find(sample => sample.id === 'G06' && sample.kind === 'base')
  await paste({ 'text/plain': figma.input }, { type: 'embed', size: [720, 500] })
  await paste({ 'text/plain': 'Some prose https://ordinary.example.invalid/page tail' }, { type: 'text' })
  await record('complete'); await capture('paste-result')
  const interaction = await embedsInteractionSmoke(window, output)
  return { stages, interaction, syntheticClipboardEvents: true, systemClipboardCalls: 0, inputHtmlExecutions: 0, dialog: true, history: true, sameIdConversion: true, detachedFrames: true, bookmarkAssetUndo: true }
}
