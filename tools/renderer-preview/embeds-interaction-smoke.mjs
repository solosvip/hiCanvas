import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Native interaction regression; uses only this run's guarded local fake pages.
// Called by embeds-smoke.mjs after its existing 18 stages. Uses the existing
// Electron session/request/clipboard boundary, never starts another process.
// Fixture contract: embedCase=interaction supplies G13/G06/Scratch, one valid
// synthetic video and one text-capable geo without overlapping their centres.
// Only fake-embed.html child DOM may be read by this test, never provider DOM.
const check = (value, message) => { if (!value) throw new Error(message) }

export async function embedsInteractionSmoke(window, output) {
  const wc = window.webContents, evaluate = code => wc.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const flush = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const stages = [], mod = process.platform === 'darwin' ? 'meta' : 'control'
  async function until(predicate, label) {
    const end = Date.now() + 15000
    while (Date.now() < end) { const value = await state(); check(!value.error, value.error); if (predicate(value)) return value; await delay(20) }
    throw new Error(`${label}超时：${JSON.stringify(await state())}`)
  }
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
  const signature = records => JSON.stringify(canonical([...records].sort((a, b) => a.id.localeCompare(b.id))))
  async function record(label) {
    const value = await state(); stages.push({ label, state: value })
    await writeFile(join(output, 'embeds-interaction-native.json'), JSON.stringify({ stages }, null, 2))
    return value
  }
  async function key(keyCode, modifiers = []) {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    if (keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers })
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await flush()
  }
  async function point(selector, childSelector = null) {
    return evaluate(`(()=>{
      const node=document.querySelector(${JSON.stringify(selector)}); if(!node)throw Error('合成目标不存在');
      let r=node.getBoundingClientRect(), x=r.x, y=r.y, w=r.width, h=r.height;
      if(${JSON.stringify(childSelector)}){
        const doc=node.contentDocument;
        if(!doc||new URL(doc.URL).pathname!=='/tools/renderer-preview/fake-embed.html')throw Error('只准观察本机假子页');
        const c=doc.querySelector(${JSON.stringify(childSelector)});if(!c)throw Error('合成子控件不存在');
        const cr=c.getBoundingClientRect();x+=cr.x;y+=cr.y;w=cr.width;h=cr.height;
      }
      if(!w||!h||node.hidden||node.disabled)throw Error('合成目标不可见或不可用');
      return{x:Math.round(x+w/2),y:Math.round(y+h/2)};
    })()`)
  }
  async function clickAt(p) {
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, ...p, button: 'left', clickCount: 1 })
    await flush()
  }
  const click = async selector => clickAt(await point(selector))
  async function doubleClick(selector) { await delay(450); await click(selector); await click(selector) }
  const frame = id => `[data-embed-content="${id}"]`
  const attrs = id => evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(frame(id))});return{pointer:f.style.pointerEvents,tab:f.tabIndex,owner:f.dataset.canvasInputOwner,sandbox:f.getAttribute('sandbox'),allow:f.getAttribute('allow'),referrer:f.getAttribute('referrerpolicy')}})()`)
  const focusCanvas = () => evaluate('document.querySelector("#canvas").focus({preventScroll:true})')
  const exit = async () => { await click('[data-embed-action=finish-interaction]'); await until(s => !s.interactingEmbedId, '父侧退出按钮') }

  const url = new URL(wc.getURL()); url.searchParams.set('gallery', 'embed-editing'); url.searchParams.set('embedCase', 'interaction'); url.searchParams.set('edgeScrolling', '0')
  await window.loadURL(url.href)
  const initial = await until(s => s.ready, '互动夹具')
  const a = initial.embedRecords.find(r => r.type === 'embed' && r.props.url.includes('youtu'))?.id
  const b = initial.embedRecords.find(r => r.type === 'embed' && r.props.url.includes('figma'))?.id
  const video = initial.embedRecords.find(r => r.type === 'video')?.id
  const geo = initial.embedRecords.find(r => r.type === 'geo')?.id
  check(a && b && video && geo, '互动夹具缺少两个嵌入、视频或可编辑文字形状')
  const baseline = signature(initial.embedRecords), revision = initial.revision
  // The original external-URL redirect is still audited by the host, but its
  // redirected request retains cross-site fetch metadata and the unchanged
  // local-read guard rejects it. Navigate only this synthetic fixture's frames
  // directly to the same local fake page; never relax the parent request gate.
  const fixtureNavigation = await evaluate(`(async()=>{
    const frames=[...document.querySelectorAll('iframe[data-external-service]')], rows=[];
    for(const f of frames){
      const source=f.src, service=f.dataset.externalService;
      if(!/^https:/.test(source)||!['G13','G06','G12'].includes(service))throw Error('非批准合成服务');
      const local=new URL('/tools/renderer-preview/fake-embed.html',location.origin);local.searchParams.set('service',service);
      const done=new Promise(resolve=>f.addEventListener('load',resolve,{once:true}));f.src=local.href;await done;
      const doc=f.contentDocument;if(!doc||doc.URL!==local.href||!doc.querySelector('input'))throw Error('假子页未实际载入');
      rows.push({source,local:local.href});
    }return rows;
  })()`)
  const passiveA = await attrs(a), passiveB = await attrs(b)
  check(passiveA.pointer === 'none' && passiveA.tab === -1 && passiveB.pointer === 'none' && passiveB.tab === -1, '初始iframe并非被动')
  await evaluate(`void(window.__embed206Frames=new Map(${JSON.stringify([a, b])}.map(id=>[id,document.querySelector('[data-embed-content="'+id+'"]')])))`)
  await record('passive')

  await doubleClick(frame(a)); await until(s => s.interactingEmbedId === a, '真实双击进入')
  const activeA = await attrs(a)
  check(activeA.pointer === 'auto' && activeA.tab === 0 && activeA.owner === 'embed', '活动iframe指针/tab/输入归属错误')
  check(activeA.sandbox === passiveA.sandbox && activeA.allow === passiveA.allow && activeA.referrer === passiveA.referrer, '互动放宽了外部iframe权限')
  check((await attrs(b)).pointer === 'none' && (await attrs(b)).tab === -1, '非活动iframe同时开放了输入')
  check(await evaluate('(()=>{const n=document.querySelector("[data-embed-action=finish-interaction]"),r=n.getBoundingClientRect();return!n.hidden&&!n.disabled&&r.width>0&&r.y>=0&&r.bottom<=innerHeight&&!n.closest("[data-shape-id]")})()'), '可信父侧退出按钮不可见或被放进画框')
  await record('double-click-enters')
  window.setContentSize(520, 780); await flush()
  check(await evaluate('(()=>{const n=document.querySelector("[data-embed-action=finish-interaction]"),r=n.getBoundingClientRect();return!n.hidden&&r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===n})()'), '窄窗父侧退出按钮不可见或被iframe遮住')
  await writeFile(join(output, 'embeds-interaction-narrow.png'), (await wc.capturePage()).toPNG())
  window.setContentSize(1280, 800); await flush()
  check((await state()).interactingEmbedId === a, '视口变化错误结束了互动')
  await record('narrow-window-keeps-exit-available')

  await clickAt(await point(frame(a), 'input'))
  await wc.insertText('嵌入独有输入'); await flush()
  const childValue = () => evaluate(`document.querySelector(${JSON.stringify(frame(a))}).contentDocument.querySelector('input').value`)
  check((await childValue()).includes('嵌入独有输入'), '真实输入没有进入子页面')
  for (const [code, modifiers] of [['Escape', []], ['H', []], ['Right', []], ['Z', [mod]]]) {
    await key(code, modifiers)
    check((await state()).interactingEmbedId === a && (await state()).toolId === 'select', `子框${code}误入画布`)
  }
  check((await state()).revision === revision && signature((await state()).embedRecords) === baseline, '子框按键改写了画板')
  await record('child-focus-and-keys')
  const childCamera = JSON.stringify((await state()).camera), wheelPoint = await point(frame(a), 'input')
  wc.sendInputEvent({ type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY: -120, canScroll: true }); await delay(150); await flush()
  check(await evaluate(`document.querySelector(${JSON.stringify(frame(a))}).contentDocument.scrollingElement.scrollTop>0`), '子框没有实际滚动')
  check((await state()).interactingEmbedId === a && JSON.stringify((await state()).camera) === childCamera, '子框滚轮改变了画板相机')
  await record('child-wheel-does-not-pan-canvas')

  await exit()
  check(await evaluate('document.activeElement===document.querySelector("#canvas")'), '退出按钮没有归还画布焦点')
  check((await attrs(a)).pointer === 'none' && (await attrs(a)).tab === -1, '退出后iframe仍接受输入')
  await record('button-exit-restores-focus')
  await doubleClick(frame(a)); await until(s => s.interactingEmbedId === a, '键盘退出前进入')
  await evaluate('document.querySelector("[data-embed-action=open]").focus({preventScroll:true})')
  await key('Tab')
  check(await evaluate('document.activeElement?.dataset.embedAction==="finish-interaction"'), 'Tab无法到达父侧退出按钮')
  await key('Enter'); await until(s => !s.interactingEmbedId, 'Tab+Enter退出')
  check(await evaluate('document.activeElement===document.querySelector("#canvas")'), '键盘退出没有归还画布焦点')
  await record('button-tab-enter')
  await doubleClick(frame(a)); await until(s => s.interactingEmbedId === a, '再次进入')
  await focusCanvas(); await key('Escape')
  const escaped = await until(s => !s.interactingEmbedId, '父画布Esc')
  check(escaped.selectedIds.length === 1 && escaped.selectedIds[0] === a, '一次Esc顺带清了选区')
  await record('canvas-escape-preserves-selection')

  await doubleClick(frame(a)); await until(s => s.interactingEmbedId === a, '切换前进入')
  await doubleClick(frame(b)); await until(s => s.interactingEmbedId === b, '换成第二个嵌入')
  check((await attrs(a)).pointer === 'none' && (await attrs(a)).tab === -1 && (await attrs(b)).pointer === 'auto', '两嵌入没有唯一互动所有者')
  await record('one-owner')

  // A real outside form is created by the native harness, not product UI.
  await evaluate(`(()=>{const input=document.createElement('input');input.id='embed206-outside-form';input.setAttribute('aria-label','合成框外输入');document.querySelector('nav').append(input)})()`)
  await click('#embed206-outside-form'); await until(s => !s.interactingEmbedId, '框外表单退出')
  check(await evaluate('document.activeElement?.id==="embed206-outside-form"'), '框外退出抢走了表单焦点')
  await wc.insertText('outside'); await flush(); await key('H')
  check((await state()).toolId === 'select' && await evaluate('document.querySelector("#embed206-outside-form").value.includes("outside")'), '框外表单快捷键被画布抢走')
  await evaluate('document.querySelector("#embed206-outside-form").remove()')
  await record('outside-form-keeps-focus')

  await doubleClick(frame(a)); await until(s => s.interactingEmbedId === a, '相机前进入')
  const beforeCamera = await childValue()
  await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:-100,y:-80,z:.8})'); await flush()
  await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:1})'); await flush()
  check((await state()).interactingEmbedId === a && await childValue() === beforeCamera, '相机变化退出互动或清了子页输入')
  check(await evaluate('Array.from(window.__embed206Frames).every(([id,node])=>node===document.querySelector(\'[data-embed-content="\'+id+\'"]\')&&node.isConnected)'), '相机或互动开关重挂载iframe')
  await record('camera-keeps-frame-and-child-state')
  await click(`[data-shape-id="${geo}"]`)
  const outside = await until(s => !s.interactingEmbedId, '框外选择')
  check(outside.selectedIds.length === 1 && outside.selectedIds[0] === geo && !outside.textEditing, '退出吞掉了同一次框外点击的选择')
  await record('outside-click-still-selects')
  await doubleClick(frame(a)); await until(s => s.interactingEmbedId === a, '换工具前进入')

  await focusCanvas(); await key('H'); await until(s => s.toolId === 'hand' && !s.interactingEmbedId, '换工具退出')
  await key('V'); await until(s => s.toolId === 'select', '切回选择')
  await record('tool-exit')
  await doubleClick(frame(a)); await until(s => s.interactingEmbedId === a, '视频前进入')
  await doubleClick(`[data-shape-id="${video}"]`); await until(s => s.interactingVideoId === video && !s.interactingEmbedId, '视频接管互动')
  await doubleClick(frame(a)); await until(s => s.interactingEmbedId === a && !s.interactingVideoId, '嵌入接管互动')
  await record('video-mutual-exclusion')
  await doubleClick(`[data-shape-id="${geo}"]`); await until(s => s.textEditing?.id === geo && !s.interactingEmbedId, '文字编辑退出嵌入')
  await key('Escape'); await until(s => !s.textEditing, '取消未改文字')
  await record('text-mutual-exclusion')

  await focusCanvas(); await delay(550)
  await click(frame(a))
  const p = await point(frame(a)), beforeDrag = (await state()).embedRecords.find(r => r.id === a)
  wc.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseMove', x: p.x + 40, y: p.y + 30, button: 'left', modifiers: ['leftButtonDown'] }); await flush()
  check(!(await state()).interactingEmbedId, '第二击拖动在松手前进入了iframe')
  wc.sendInputEvent({ type: 'mouseUp', x: p.x + 40, y: p.y + 30, button: 'left', clickCount: 1 })
  const dragged = await until(s => !s.submitting && s.commitCalls === 1, '第二击拖动保存')
  const moved = dragged.embedRecords.find(r => r.id === a)
  check(!dragged.interactingEmbedId && (moved.x !== beforeDrag.x || moved.y !== beforeDrag.y), '第二击拖动没有只移动对象')
  await record('second-click-hold-drag')
  await key('Z', [mod]); await until(s => !s.submitting && signature(s.embedRecords) === baseline, '移动一步撤销')
  check(!(await state()).interactingEmbedId, '撤销恢复了互动会话')
  await record('undo-does-not-restore-interaction')

  // Active borders use the unchanged engine handles; input starts just outside
  // the iframe, inside the existing screen-space corner hit area.
  async function cornerDrag(id, dx, dy) {
    const p = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(frame(id))}).getBoundingClientRect();return{x:Math.round(r.right+2),y:Math.round(r.bottom+2)}})()`)
    wc.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseMove', x: p.x+dx, y: p.y+dy, button: 'left', modifiers: ['leftButtonDown'] }); await flush()
    check(!(await state()).interactingEmbedId, '边框手势没有先结束互动')
    wc.sendInputEvent({ type: 'mouseUp', x: p.x+dx, y: p.y+dy, button: 'left', clickCount: 1 }); await flush()
  }
  await doubleClick(frame(a)); await until(s => s.interactingEmbedId === a, '视频比例缩放前进入')
  const resizeCommits = (await state()).commitCalls
  await cornerDrag(a, 100, 20)
  const resized = await until(s => !s.submitting && s.commitCalls === resizeCommits+1, '互动边框缩放')
  const resizedA = resized.embedRecords.find(r => r.id === a)
  check(Math.abs(resizedA.props.w/resizedA.props.h-16/9)<1e-9 && resizedA.props.h>=200, '互动放宽了视频比例或最小高度')
  await record('active-border-keeps-video-constraints')
  await key('Z', [mod]); await until(s => !s.submitting && signature(s.embedRecords) === baseline, '缩放撤销')
  await doubleClick(frame(a)); await until(s => s.interactingEmbedId === a, '最小尺寸前进入')
  await cornerDrag(a, -400, -200)
  const minimum = await until(s => !s.submitting && s.embedRecords.find(r => r.id === a).props.h<=200.0001, '视频最小尺寸')
  check(Math.abs(minimum.embedRecords.find(r => r.id === a).props.h-200)<1e-9, '视频最小高度200未保留')
  await record('active-video-minimum-height')
  await key('Z', [mod]); await until(s => !s.submitting && signature(s.embedRecords) === baseline, '最小尺寸撤销')
  const scratch = 'shape:embed-scratch', scratchBefore = (await state()).embedRecords.find(r => r.id === scratch)
  await doubleClick(frame(scratch)); await until(s => s.interactingEmbedId === scratch, 'Scratch进入')
  await cornerDrag(scratch, 50, 20)
  const scratchAfter = await until(s => !s.submitting, 'Scratch角点')
  const unchanged = scratchAfter.embedRecords.find(r => r.id === scratch)
  check(unchanged.props.w === scratchBefore.props.w && unchanged.props.h === scratchBefore.props.h, 'Scratch互动时获得了缩放权限')
  await record('scratch-still-cannot-resize')
  if (signature(scratchAfter.embedRecords) !== baseline) { await key('Z', [mod]); await until(s => !s.submitting && signature(s.embedRecords) === baseline, 'Scratch移动撤销') }

  await evaluate(`document.querySelector(${JSON.stringify(frame(a))}).contentDocument.scrollingElement.scrollTop=0`)
  await doubleClick(frame(a)); await until(s => s.interactingEmbedId === a, '重新加载前进入')
  await clickAt(await point(frame(a), '#reload'))
  await until(s => !s.interactingEmbedId, '子页重新加载结束互动')
  check((await attrs(a)).pointer === 'none' && (await attrs(a)).tab === -1, '重新加载保留了旧互动权限')
  check(await evaluate('document.activeElement===document.querySelector("#canvas")'), '重新加载结束互动后仍将焦点困在子框')
  await record('child-load-invalidates-interaction')

  check(await evaluate('window.__embedClipboardViolations.length===0'), '互动触碰了系统剪贴板')
  check(await evaluate('Array.from(window.__embed206Frames).every(([id,node])=>node===document.querySelector(\'[data-embed-content="\'+id+\'"]\'))'), '非来源变化重建了iframe')
  await doubleClick(frame(a)); await until(s => s.interactingEmbedId === a, '删除前进入')
  await evaluate(`void(window.__embed206DeletedFrame=document.querySelector(${JSON.stringify(frame(a))}))`)
  await focusCanvas(); await key('Delete')
  await until(s => !s.submitting && !s.interactingEmbedId && !s.embedRecords.some(r => r.id === a), '删除结束互动')
  check(await evaluate('!window.__embed206DeletedFrame.isConnected'), '删除仍残留旧iframe')
  await record('delete-detaches-frame')
  await key('Z', [mod]); await until(s => !s.submitting && signature(s.embedRecords) === baseline, '删除一步撤销')
  await flush()
  check(!(await state()).interactingEmbedId && (await attrs(a)).pointer === 'none' && (await attrs(a)).tab === -1, '删除撤销恢复了旧互动权限')
  check(await evaluate(`document.querySelector(${JSON.stringify(frame(a))})!==window.__embed206DeletedFrame&&!window.__embed206DeletedFrame.isConnected`), '删除撤销复用了已经释放的旧iframe')
  await record('undo-delete-mounts-passive-frame')
  await writeFile(join(output, 'embeds-interaction.png'), (await wc.capturePage()).toPNG())
  return { stages, fixtureNavigation, nativePointerAndKeys: true, syntheticChildOnly: true, remoteInvalidationCoveredByNodeTests: true }
}
