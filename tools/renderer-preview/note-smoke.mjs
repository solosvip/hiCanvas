import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Every document change below is native pointer/key/text input. Script only
// reads the public preview state and DOM positions, or focuses the host.
export async function noteSmoke(target, output) {
  const contents = target.webContents, samples = []
  const evaluate = code => contents.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const check = (ok, message) => { if (!ok) throw new Error(message) }
  async function until(predicate, label) {
    const end = Date.now() + 10000
    while (Date.now() < end) { const s = await state(); if (s.error) throw new Error(s.error); if (predicate(s)) return s; await delay(20) }
    throw new Error(`便签原生回归超时：${label}；${JSON.stringify(await state())}`)
  }
  const mouse = async (type, x, y) => { contents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, ...(type === 'mouseMove' && { modifiers: ['leftButtonDown'] }) }); await delay(35) }
  const click = async (x,y) => { await mouse('mouseDown',x,y); await mouse('mouseUp',x,y) }
  const key = async (keyCode,modifiers=[]) => { for (const type of ['keyDown','keyUp']) contents.sendInputEvent({type,keyCode,modifiers}); await delay(35) }
  const text = async value => { await contents.insertText(value); await delay(50) }
  const record = (s,id) => s.noteRecords?.find(r=>r.id===id) || s.selectedShapes.find(r=>r.id===id)
  const remember = async label => { samples.push({label,...await state()}) }
  async function load(gallery='note-editing',name='Avery Longname') {
    const url=new URL(contents.getURL());url.search=`?gallery=${gallery}&edgeScrolling=0&displayName=${encodeURIComponent(name)}`
    await target.loadURL(url.href);await until(s=>s.ready,'就绪');await evaluate("document.querySelector('#canvas').focus();void 0")
  }
  const pump=setInterval(()=>contents.invalidate(),30)
  let attached=false
  try {
    contents.debugger.attach('1.3');attached=true
    await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    await load('creation');await key('N');await click(400,350)
    let s=await until(s=>s.textEditing?.kind==='note','N单击进入便签文字'),id=s.textEditing.id
    check(s.selectedShapes[0].x===300&&s.selectedShapes[0].y===250,'N单击必须以200方纸居中')
    check(s.revision==='0'&&s.selectedShapes[0].props.textFirstEditedBy===null,'创建空便签不应提前提交或署名')
    await text('Native note');await key('Escape');s=await until(s=>s.revision==='1'&&!s.textEditing,'保存便签')
    const author=await evaluate("(()=>{const n=document.querySelector('[data-note-author]');return n&&{text:n.textContent,title:n.title}})()")
    check(author?.text==='Avery'&&author.title==='Avery Longname','宿主显示名未显示为作者第一段')
    await key('Z',['meta']);await until(s=>s.revision==='2'&&s.renderedShapes===0,'创建与首次文字整次撤销')
    await remember('create-author-single-undo')

    await load('creation');await key('N');await mouse('mouseDown',300,350);await mouse('mouseMove',500,450);await mouse('mouseUp',500,450)
    s=await until(s=>s.textEditing?.kind==='note','拖动便签');check(s.selectedShapes[0].x===400&&s.selectedShapes[0].y===350,'便签拖动应移动固定纸面而非拉伸')
    await key('Escape');await remember('fixed-paper-drag')

    await load();await click(400,400)
    check(await evaluate("document.querySelectorAll('[data-note-handle]').length")===4,'没有显示四个便签+柄')
    check(await evaluate("Array.from(document.querySelectorAll('[data-note-handle]')).every(n=>{const b=n.getBoundingClientRect();return Array.from(n.children).length===2&&Array.from(n.children).every(c=>{const r=c.getBoundingClientRect();return Math.abs(r.x+r.width/2-b.x-b.width/2)<.01&&Math.abs(r.y+r.height/2-b.y-b.height/2)<.01})})"),'便签+的两条笔画没有在圆柄中心交叉')
    await click(500,400);s=await until(s=>s.textEditing?.id!=='shape:note'&&s.textEditing?.kind==='note','右侧+创建')
    id=s.textEditing.id;check(record(s,id).x===510&&record(s,id).y===300,'右侧+未按10间隔创建相邻便签')
    await text('Neighbour');await key('Escape');await until(s=>s.revision==='1'&&!s.textEditing,'相邻便签保存')
    await key('Z',['meta']);s=await until(s=>s.revision==='2','撤销相邻便签');check(s.noteRecords.filter(r=>r.type==='note').length===4,'一次撤销没有移除整张相邻便签')
    await remember('plus-edit-undo')

    await load();await click(400,400);await click(400,400);await until(s=>s.textEditing?.id==='shape:note','源编辑')
    await text('Source native');await key('Tab');s=await until(s=>s.revision==='1'&&s.textEditing?.id!=='shape:note','Tab续建')
    id=s.textEditing.id;check(record(s,id).x===510,'Tab不是向右续建')
    await text('Next native');await key('Enter',['meta']);s=await until(s=>s.revision==='2'&&s.textEditing?.id!==id,'ModEnter续建')
    check(record(s,s.textEditing.id).x===510&&record(s,s.textEditing.id).y===510,'ModEnter未结束源并向下续建')
    await key('Escape');await remember('tab-mod-enter-continuation')
    await writeFile(join(output,'notes.png'),(await contents.capturePage()).toPNG())

    await load();await click(850,600);await click(850,600);await until(s=>s.textEditing?.id==='shape:scaled','缩放便签编辑')
    const layout=await evaluate("(()=>{const n=document.querySelector('[data-canvas-text-editor]');return{left:parseFloat(n.style.left),top:parseFloat(n.style.top),transform:n.style.transform,width:parseFloat(n.style.width)}})()")
    check(layout.left===808&&Math.abs(layout.top-592.578125)<.001&&layout.width===168&&layout.transform.includes('0.5'),`缩放便签编辑区与纸面文字偏移：${JSON.stringify(layout)}`)
    await writeFile(join(output,'scaled-note.png'),(await contents.capturePage()).toPNG());await key('Escape');await remember('scaled-editor-layout')

    await load();await click(400,650);await click(400,650);await key('Tab')
    s=await until(s=>s.revision==='1'&&s.textEditing?.id!=='shape:rtl','RTL续建');check(record(s,s.textEditing.id).x===90,'RTL Tab没有向左续建');await key('Escape');await remember('rtl-continuation')

    await load();await mouse('mouseDown',950,400);await mouse('mouseMove',619,400)
    s=await state();check(record(s,'shape:moving').x===510&&s.overlays.some(o=>o.kind==='snap'),'9px内没有吸附或临时指示')
    await key('Escape');await mouse('mouseUp',619,400);s=await state();check(record(s,'shape:moving').x===850&&s.revision==='0'&&!s.overlays.some(o=>o.kind==='snap'),'取消没有恢复便签或清理吸附')
    await mouse('mouseDown',950,400);await mouse('mouseMove',620,400);await mouse('mouseUp',620,400)
    s=await until(s=>s.revision==='1','距离10保存');check(record(s,'shape:moving').x===520,'10px边界不应吸附');await remember('radial-snap-boundary-cancel')

    await load('creation','');await key('N');await click(400,350);await text('Unnamed');await key('Escape')
    s=await until(s=>s.revision==='1'&&!s.textEditing,'无姓名保存');check(s.selectedShapes[0].props.textFirstEditedBy===null,'缺少宿主姓名不应读取其他身份');await remember('missing-display-name')
    await writeFile(join(output,'notes.json'),JSON.stringify({samples,nativeInput:true},null,2))
    return {cases:samples.map(s=>s.label),nativeInput:true}
  } finally {clearInterval(pump);if(attached&&contents.debugger.isAttached())contents.debugger.detach()}
}
