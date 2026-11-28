import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const check = (value, message) => { if (!value) throw new Error(message) }
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const signature = records => JSON.stringify(canonical([...records].sort((a, b) => a.id.localeCompare(b.id))))

// Same guarded Electron session as the original embeds suites. Only the
// fixed metadata client's fetch dependency is replaced, never its UI/engine.
export async function bookmarkMetadataSmoke(window, output) {
  const wc = window.webContents, evaluate = code => wc.executeJavaScript(code), stages = []
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const flush = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const mod = process.platform === 'darwin' ? 'meta' : 'control'
  async function until(predicate, label) {
    const end = Date.now() + 10000
    while (Date.now() < end) { const s = await state(); check(!s.error, s.error); if (predicate(s)) return s; await delay(20) }
    throw new Error(`${label}超时：${JSON.stringify(await state())}`)
  }
  async function record(label) {
    const s = await state(); stages.push({ label, state: s })
    await writeFile(join(output, 'bookmark-metadata-native.json'), JSON.stringify({ stages }, null, 2)); return s
  }
  async function key(keyCode, modifiers = []) {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    if (keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers })
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await flush()
  }
  async function click(selector, border = false) {
    const p = await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled||n.hidden)throw Error('书签控件不可用');const r=n.getBoundingClientRect();if(!r.width||!r.height)throw Error('书签控件不可见');return{x:Math.round(r.x+(${border} ? 2:r.width/2)),y:Math.round(r.y+r.height/2)}})()`)
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, ...p, button: 'left', clickCount: 1 })
    await flush()
  }
  const action = type => click(`[data-bookmark-action="${type}"]`)
  const select = id => click(`[data-shape-id="${id}"]`, true)
  async function type(url) {
    await click('[data-bookmark-action=url]'); await key('Home'); await key('End', ['shift']); await key('Backspace')
    await wc.insertText(url); await flush()
    check(await evaluate(`document.querySelector('[data-bookmark-action=url]').value===${JSON.stringify(url)}`), '原生网址输入读回错误')
  }
  const target = (s, id) => s.embedRecords.find(r => r.id === id)
  const asset = (s, id) => target(s, target(s, id).props.assetId)
  const unchanged = (before, after, message) => check(signature(before.embedRecords) === signature(after.embedRecords) && before.commitCalls === after.commitCalls, message)
  const url = new URL(wc.getURL()); url.searchParams.set('gallery', 'embed-editing'); url.searchParams.set('embedCase', 'bookmarks')
  window.setContentSize(1280, 800); await window.loadURL(url.href)
  const initial = await until(s => s.ready, '书签夹具')
  check(initial.bookmarkRequests.length === 0 && initial.commitCalls === 0, '打开画板自行抓取或写入')
  await record('initial-no-fetch')

  await select('shape:bookmark-a'); await action('refresh')
  const refreshed = await until(s => !s.bookmarkJobs.length && s.commitCalls === 1, '刷新共用资源')
  check(asset(refreshed, 'shape:bookmark-a').props.title.startsWith('合成标题'), '标题没有补齐')
  check(signature([target(refreshed, 'shape:bookmark-peer'), asset(refreshed, 'shape:bookmark-peer')]) === signature([target(initial, 'shape:bookmark-peer'), asset(initial, 'shape:bookmark-peer')]), '刷新影响共用资源的另一张卡')
  check(await evaluate('!!document.querySelector("[data-bookmark=\\"shape:bookmark-a\\"] [data-bookmark-description]") && !document.querySelector("[data-bookmark=\\"shape:bookmark-a\\"] [data-bookmark-preview]")'), '无图书签未显示描述')
  await record('refresh-shared-description')
  await key('Z', [mod]); const undone = await until(s => !s.submitting && signature(s.embedRecords) === signature(initial.embedRecords), '刷新一次撤销')
  check(undone.bookmarkRequests.length === 1, '撤销重发抓取')
  await key('Z', [mod, 'shift']); await until(s => !s.submitting && signature(s.embedRecords) === signature(refreshed.embedRecords), '刷新一次重做')
  await record('refresh-undo-redo')

  await action('open'); await until(s => !!s.bookmarkEditing, '改网址对话框')
  window.setContentSize(520, 780); await flush()
  check(await evaluate('(()=>{const r=document.querySelector("dialog[open]").getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight})()'), '窄窗改网址对话框越界')
  await writeFile(join(output, 'bookmark-url-narrow.png'), (await wc.capturePage()).toPNG())
  window.setContentSize(1280, 800); await flush(); await record('narrow-dialog')
  await evaluate(`(()=>{const input=document.querySelector('[data-bookmark-action=url]');window.__bookmarkIme=[];input.addEventListener('keydown',event=>window.__bookmarkIme.push({key:event.key,composing:event.isComposing}));input.focus();input.setSelectionRange(input.value.length,input.value.length)})();void 0`)
  // The clipboard guard owns this connection across navigations. Reuse it;
  // attaching twice throws, and detaching it would remove the guard's owner.
  check(wc.debugger.isAttached(), '既有剪贴板守卫调试连接未保留')
  await wc.debugger.sendCommand('Input.imeSetComposition', { text: 'han', selectionStart: 0, selectionEnd: 3 })
  await flush()
  check((await state()).bookmarkEditing.valid && (await state()).inputContext.isComposing && await evaluate('document.querySelector("[data-bookmark-action=url]").checkValidity()'), '组字反例需要有效网址和活动组字，不能依赖表单无效阻止提交')
  await key('h'); await key('Enter')
  check((await state()).bookmarkEditing && (await state()).bookmarkRequests.length === 1, '组字时Enter提交了改网址')
  await wc.debugger.sendCommand('Input.insertText', { text: '汉' })
  check(await evaluate('window.__bookmarkIme.some(event=>event.composing)'), '没有产生真实Chromium组字按键')
  unchanged(refreshed, await state(), '组字改变了画板')
  await record('dialog-ime-no-write')
  await type('https://old.example.invalid/card'); await key('Tab')
  check(await evaluate('document.activeElement?.dataset.bookmarkAction==="submit"'), 'Tab未到达保存按钮')
  await key('Tab')
  check(await evaluate('document.activeElement?.dataset.bookmarkAction==="cancel"'), 'Tab未到达取消按钮')
  await key('Enter'); await until(s => !s.bookmarkEditing, '按钮Enter取消')
  unchanged(refreshed, await state(), '取消按钮Enter误提交')
  await record('dialog-tab-enter-cancel')
  await action('open'); await until(s => !!s.bookmarkEditing, '重新打开改网址')
  await key('Escape'); await until(s => !s.bookmarkEditing, '原生Esc取消')
  unchanged(refreshed, await state(), 'Esc取消改变文档')
  await record('dialog-escape-no-write')

  await action('open'); await type('https://new.example.invalid/delayed-new')
  const beforeUrl = await state(); await key('Enter')
  const preparing = await until(s => s.bookmarkEditing?.phase === 'fetching', '改址读取中')
  unchanged(beforeUrl, preparing, '读取完成前已保存新网址')
  await record('url-prepare-no-write')
  await evaluate('window.__HICANVAS_BOOKMARK_NETWORK__.release()')
  const savedUrl = await until(s => !s.bookmarkEditing && !s.submitting && s.commitCalls === beforeUrl.commitCalls + 1, '改址一事务保存')
  check(target(savedUrl, 'shape:bookmark-a').props.url === 'https://new.example.invalid/delayed-new' && asset(savedUrl, 'shape:bookmark-a').props.title.startsWith('合成标题'), '网址/信息未一起保存')
  check(await evaluate('document.activeElement===document.querySelector("#canvas")'), '改址保存未归还画布焦点')
  await record('url-one-save')
  await key('Z', [mod]); await until(s => !s.submitting && signature(s.embedRecords) === signature(beforeUrl.embedRecords), '改址一次撤销完整记录')
  await key('Z', [mod, 'shift']); await until(s => !s.submitting && signature(s.embedRecords) === signature(savedUrl.embedRecords), '改址一次重做完整记录')
  await record('url-undo-redo')

  await action('open'); await type('http://127.0.0.1/private'); await key('Enter')
  const failed = await until(s => s.bookmarkEditing?.phase === 'failed', '私网已知错误')
  unchanged(savedUrl, failed, '读取失败仍修改了原卡')
  check(failed.bookmarkEditing.errorCode === 'target_not_public' && await evaluate('document.querySelector("#bookmark-url-help").textContent.includes("公开网络") && !document.querySelector("#bookmark-url-help").textContent.includes("SECRET")'), '私网错误原文泄漏或提示缺失')
  await record('known-error-no-write')
  await action('save-url-only')
  const only = await until(s => !s.bookmarkEditing && s.commitCalls === savedUrl.commitCalls + 1, '仅保存网址')
  check(target(only, 'shape:bookmark-a').props.url === 'http://127.0.0.1/private' && asset(only, 'shape:bookmark-a').props.title === '', '仅保存网址残留旧信息')
  await record('url-only-save')
  await key('Z', [mod]); await until(s => !s.submitting && signature(s.embedRecords) === signature(savedUrl.embedRecords), '仅网址一次撤销')
  await record('url-only-undo')

  const beforeCancel = await state()
  await action('open'); await type('https://cancel.example.invalid/delayed'); await action('submit')
  await until(s => s.bookmarkEditing?.phase === 'fetching', '取消前读取')
  await action('cancel'); await until(s => !s.bookmarkEditing && !s.bookmarkJobs.length, '取消读取')
  await evaluate('window.__HICANVAS_BOOKMARK_NETWORK__.release()'); await flush()
  const late = await state()
  await writeFile(join(output, 'bookmark-cancel-late.json'), JSON.stringify({ beforeCancel, late }, null, 2))
  unchanged(beforeCancel, late, '取消后迟到结果仍写入')
  check(late.bookmarkRequests.at(-1).aborted, '取消没有传到fetch Abort')
  await record('cancel-late-discard')

  await select('shape:bookmark-compact'); const compactBefore = await state(); await action('refresh')
  const compact = await until(s => !s.bookmarkJobs.length && s.commitCalls === compactBefore.commitCalls + 1, '紧凑书签刷新')
  check(JSON.stringify(target(compact, 'shape:bookmark-compact')) === JSON.stringify(target(compactBefore, 'shape:bookmark-compact')), '补齐自动增高或移动卡片')
  check(target(compact, 'shape:bookmark-compact').props.h === 46, '紧凑卡高度变化')
  await record('compact-size-preserved')

  const beforePaste = await state()
  const sent = await evaluate(`(()=>{const d=new DataTransfer();d.setData('text/plain','https://paste.example.invalid/new');const h=document.querySelector('#canvas');h.focus();const e=new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true});h.dispatchEvent(e);return{trusted:e.isTrusted,prevented:e.defaultPrevented}})()`)
  check(!sent.trusted && sent.prevented, '自动补齐粘贴没有走明确合成事件')
  const pasted = await until(s => !s.clipboardBusy && !s.submitting && !s.bookmarkJobs.length && s.commitCalls === beforePaste.commitCalls + 2, '粘贴后自动补齐')
  const pastedId = pasted.selectedIds[0]
  check(asset(pasted, pastedId).props.title.startsWith('合成标题'), '新网址没有自动补齐')
  await record('paste-auto-two-transactions')
  await key('Z', [mod]); const noInfo = await until(s => !s.submitting && target(s, pastedId) && asset(s, pastedId).props.title === '', '先撤销补齐')
  check(noInfo.bookmarkRequests.length === pasted.bookmarkRequests.length, '撤销补齐又发起抓取')
  await key('Z', [mod]); await until(s => !s.submitting && !target(s, pastedId), '再撤销创建')
  await record('paste-two-undo-boundaries')

  check(await evaluate('window.__embedClipboardViolations.length===0'), '书签专项碰了系统剪贴板')
  await writeFile(join(output, 'bookmark-metadata-complete.png'), (await wc.capturePage()).toPNG())
  return { stages, syntheticFetchOnly: true, syntheticClipboardEvents: true, systemClipboardCalls: 0, liveWebsitesTested: false }
}
