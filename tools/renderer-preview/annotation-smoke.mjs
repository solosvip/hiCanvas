import { app, BrowserWindow, clipboard, dialog, shell, net as electronNet } from 'electron'
import { writeFile } from 'node:fs/promises'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute, join, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { setTimeout as delay } from 'node:timers/promises'

// Installed before loading the synthetic editor, in every document including
// paused OOPIF targets. No original clipboard getter/native method is called.
function pageGuard() {
  if (globalThis.__HICANVAS_ANNOTATION_GUARD__) return
  const emit = globalThis.__annotationBoundary
  const block = name => { emit(JSON.stringify({denied:name})); throw new Error(`ANNOTATION_DENIED:${name}`) }
  const lock = (object,name,value) => Object.defineProperty(object,name,{value,writable:false,configurable:false})
  const memory = Object.freeze(Object.fromEntries(['read','readText','write','writeText'].map(name=>[name,()=>block('clipboard')])))
  Object.defineProperty(Navigator.prototype,'clipboard',{get:()=>memory,configurable:false});lock(navigator,'clipboard',memory)
  const exec = Document.prototype.execCommand
  lock(Document.prototype,'execCommand',function(name,...args){return /^(copy|cut|paste)$/i.test(name)?block('clipboard'):exec.call(this,name,...args)})
  for (const name of ['copy','cut','paste']) document.addEventListener(name,event=>{if(event.isTrusted){event.preventDefault();event.stopImmediatePropagation();block('clipboard')}},true)
  for (const name of ['print','alert','confirm','prompt','open','showOpenFilePicker','showSaveFilePicker','showDirectoryPicker']) if(typeof window[name]==='function')lock(window,name,()=>block(name==='print'?'print':'dialog'))
  if(typeof HTMLInputElement.prototype.showPicker==='function')lock(HTMLInputElement.prototype,'showPicker',()=>block('dialog'))
  document.addEventListener('click',event=>{if(event.target?.closest?.('input[type=file]')){event.preventDefault();event.stopImmediatePropagation();block('dialog')}},true)
  lock(window,'__HICANVAS_ANNOTATION_GUARD__',Object.freeze({intact:()=>navigator.clipboard===memory,probe(name){
    if(name==='clipboard')return navigator.clipboard.readText()
    if(name==='print')return window.print()
    if(name==='dialog')return window.alert('synthetic')
    if(name==='network')return fetch('https://annotation-denied.example.invalid/probe')
    if(name==='model')return fetch('/api/image-models/generate',{method:'POST'})
    if(name==='download'){const a=document.createElement('a');a.href='data:application/octet-stream;base64,c3ludGhldGlj';a.download='refused.bin';document.body.append(a);a.click();a.remove();return true}
    throw new Error('Unknown guard probe')
  }}))
  emit(JSON.stringify({ready:true,url:location.href}))
}

export async function annotationSmoke(manifest) {
  const root=fileURLToPath(new URL('../../',import.meta.url)),origin=new URL(manifest.url).origin
  const evidence={ok:false,mode:manifest.mode,pid:process.pid,fingerprint:manifest.fingerprint,violations:[],network:[],frames:[],samples:[],errors:[],runtime:process.versions}
  let target,painting,deadline
  const pending=new Map(),denied=name=>{evidence.violations.push(name);return new Error(`ANNOTATION_DENIED:${name}`)}
  const lock=(object,name,value)=>Object.defineProperty(object,name,{value,writable:false,configurable:false})
  const functions=object=>{const names=new Set();for(let p=object;p&&p!==Object.prototype;p=Object.getPrototypeOf(p))for(const name of Object.getOwnPropertyNames(p))if(name!=='constructor'&&typeof Object.getOwnPropertyDescriptor(p,name)?.value==='function')names.add(name);return [...names]}
  const block=(object,names,label)=>{for(const name of names)lock(object,name,()=>{throw denied(label)})}
  const inside=(base,path)=>{
    const full=resolve(path),part=relative(base,full)
    if(!part||part==='..'||part.startsWith('..'+sep)||isAbsolute(part))throw denied('file-path')
    for(let current=full;current!==base;current=dirname(current))if(existsSync(current)&&(lstatSync(current).isSymbolicLink()||realpathSync(current)!==current))throw denied('file-path')
    return full
  }
  // Invalid output paths must reject the promise before any result is returned
  // to the shared entry, which writes successful and failed smoke evidence alike.
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)||new URL(origin).port==='43398')throw new Error('非合成本机地址。')
  inside(join(root,'.scratch'),manifest.output);inside(manifest.output,manifest.profile);inside(manifest.output,manifest.result)
  try {
    block(clipboard,functions(clipboard),'clipboard');block(dialog,functions(dialog),'dialog');block(shell,['openExternal','openPath','showItemInFolder'],'dialog')
    block(electronNet,['request','fetch'],'network');block(globalThis,['fetch'],'network')
    block(http,['request','get'],'network');block(https,['request','get'],'network');block(net,['connect','createConnection'],'network');block(net.Socket.prototype,['connect'],'network');block(tls,['connect'],'network')
    app.dock?.hide()
    target=new BrowserWindow({show:false,width:1280,height:800,useContentSize:true,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:`annotation-${process.pid}`}})
    const wc=target.webContents,debug=wc.debugger,evaluate=code=>wc.executeJavaScript(code)
    block(wc,['copy','cut','paste','pasteAndMatchStyle','copyImageAt'],'clipboard');block(wc,['print','printToPDF'],'print')
    wc.setWindowOpenHandler(()=>{denied('dialog');return {action:'deny'}})
    wc.session.setPermissionCheckHandler(()=>false);wc.session.setPermissionRequestHandler((_wc,_type,callback)=>callback(false))
    wc.session.on('will-download',(event,item)=>{event.preventDefault();item.cancel();denied('download')})
    wc.on('console-message',detail=>{if(detail.level==='error'||detail.level>=3)evidence.errors.push(detail.message)})
    wc.on('context-menu',event=>event.preventDefault())
    wc.session.webRequest.onBeforeRequest((details,callback)=>{
      let allowed=false,external=true,model=false
      try{
        const url=new URL(details.url),board=['127.0.0.1','localhost'].includes(url.hostname)&&url.port===new URL(origin).port&&['http:','ws:'].includes(url.protocol),local=board||manifest.contentPort&&url.protocol==='http:'&&Number(url.port)===manifest.contentPort&&/^[a-f0-9]{48}\.localhost$/.test(url.hostname)
        external=!local&&!['data:','blob:','about:'].includes(url.protocol)
        allowed=!external||url.protocol==='ws:'&&url.host===new URL(origin).host
        if(board&&url.pathname.startsWith('/api/')&&!['/api/health','/api/content-host/instances'].includes(url.pathname)){allowed=false;model=true}
      }catch{}
      evidence.network.push({url:details.url,referrer:details.referrer,type:details.resourceType,external,allowed,model})
      callback({cancel:!allowed});if(!allowed)denied(model?'model':'network')
    })
    const check=(value,message)=>{if(!value)throw new Error(message)}
    const text=node=>(node?.text||'')+(node?.content||[]).map(text).join('')
    async function until(predicate,label){const end=Date.now()+12000;while(Date.now()<end){const value=await predicate();if(value)return value;await delay(20)}throw new Error(`标注等待超时：${label}`)}
    deadline=setTimeout(()=>{target?.destroy()},150000)
    await target.loadURL('about:blank');debug.attach('1.3')
    function acknowledge(row){if(row?.registered&&row.installed&&row.resumed){clearTimeout(pending.get(row.sessionId));pending.delete(row.sessionId)}}
    async function setup(sessionId){
      const send=(method,params={})=>debug.sendCommand(method,params,sessionId)
      await send('Runtime.enable');await send('Page.enable');await send('Runtime.addBinding',{name:'__annotationBoundary'})
      const registration=await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${pageGuard.toString()})()`,runImmediately:true})
      await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'iframe'},{exclude:true}]})
      if(sessionId){const row=evidence.frames.find(row=>row.sessionId===sessionId);check(row&&registration.identifier,'子框守卫没有登记');row.registered=true;await send('Runtime.runIfWaitingForDebugger');row.resumed=true;acknowledge(row)}
    }
    debug.on('message',(_event,method,params,sessionId)=>{
      if(method==='Target.attachedToTarget'){
        const id=params.sessionId;evidence.frames.push({sessionId:id,registered:false,installed:false,resumed:false})
        pending.set(id,setTimeout(()=>{evidence.errors.push('子框守卫未确认');target?.destroy()},3000));void setup(id).catch(error=>{evidence.errors.push(String(error));target?.destroy()})
      }
      if(method==='Runtime.bindingCalled'&&params.name==='__annotationBoundary'){
        const value=JSON.parse(params.payload)
        if(value.ready){const row=evidence.frames.find(row=>row.sessionId===sessionId);if(row){row.installed=true;row.url=value.url;acknowledge(row)}}else denied(value.denied)
      }
      if(method==='Runtime.exceptionThrown')evidence.errors.push(params.exceptionDetails?.exception?.description||params.exceptionDetails?.text)
    })
    await setup();await debug.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    const state=()=>evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
    const read=()=>evaluate('window.__HICANVAS_ANNOTATION_PROBE__.read()')
    const flush=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const key=async(keyCode,modifiers=[])=>{for(const type of ['keyDown','keyUp']){wc.sendInputEvent({type,keyCode,modifiers});await flush()}}
    const mouse=async(type,x,y)=>{wc.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1,modifiers:type==='mouseMove'?['leftButtonDown']:[]});await flush()}
    const click=async(x,y)=>{await mouse('mouseDown',x,y);await mouse('mouseUp',x,y)}
    const button=async selector=>{
      const box=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),r=n?.getBoundingClientRect();if(!r||document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)!==n)throw Error('按钮未命中');return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await click(box.x,box.y)
    }
    async function load(kind,zoom=1){
      await target.loadURL(`${origin}/?gallery=annotation&case=${kind}&zoom=${zoom}&edgeScrolling=0`)
      await until(async()=>{const s=await state();if(s?.error)throw new Error(s.error);return s?.ready},'预览就绪')
      check(await evaluate('window.__HICANVAS_ANNOTATION_GUARD__.intact()'),'主文档守卫被覆盖')
    }
    if(manifest.mode!=='smoke'){
      await target.loadURL(`${origin}/__export_guard`)
      const [scope,probe]=manifest.mode.split('-')
      if(scope==='native'){
        try{if(probe==='clipboard')clipboard.readText();else if(probe==='dialog')dialog.showErrorBox('synthetic','blocked');else if(probe==='network')await globalThis.fetch('https://annotation-denied.example.invalid/probe');else if(probe==='print')wc.print()}catch{}
      }else{
        let frame
        if(scope==='frame'||manifest.mode==='green'){
          await evaluate(`(()=>{const f=document.createElement('iframe');f.src=${JSON.stringify(`http://localhost:${new URL(origin).port}/__export_guard`)};document.body.append(f)})()`)
          frame=await until(()=>evidence.frames.find(row=>row.registered&&row.installed&&row.resumed),'子框安装确认')
        }
        const expression=`window.__HICANVAS_ANNOTATION_GUARD__.${manifest.mode==='green'?'intact()':`probe(${JSON.stringify(probe)})`}`
        try{if(scope==='frame')await debug.sendCommand('Runtime.evaluate',{expression,awaitPromise:true},frame.sessionId);else await evaluate(expression)}catch{}
      }
      await delay(150)
      if(manifest.mode==='green')check(evidence.frames.length>0&&evidence.frames.every(row=>row.registered&&row.installed&&row.resumed)&&!pending.size,'子框守卫没有完整确认')
    }else{
      painting=setInterval(()=>wc.invalidate(),30)
      await load('drawing');await click(1100,300);await key('C')
      check((await state()).toolId==='annotation','原生C没有进入标注')
      await mouse('mouseDown',600,280);await mouse('mouseMove',607,280);await mouse('mouseUp',607,280)
      check(!(await state()).textEditing&&(await read()).commits===0,'短拖留下历史')
      await mouse('mouseDown',600,350);await mouse('mouseMove',700,400);await key('Escape');await mouse('mouseUp',700,400)
      check((await state()).toolId==='annotation'&&(await read()).commits===0,'Esc没有取消草稿')
      await mouse('mouseDown',500,280);await mouse('mouseMove',350,280);await mouse('mouseUp',350,280)
      const editing=await until(async()=>(await state()).textEditing,'标签编辑'),id=editing.id
      await wc.insertText('原生 标注 🙂');await flush()
      await debug.sendCommand('Input.imeSetComposition',{text:'组',selectionStart:1,selectionEnd:1});await key('Enter',['meta'])
      check((await state()).textEditing?.id===id,'组字中误完成标注')
      await debug.sendCommand('Input.insertText',{text:'组字'});await flush();await key('Escape')
      await until(async()=>!(await state()).textEditing,'保存标签')
      const first=await read(),record=first.document.store[id]
      check(record.meta.cowartAnnotationArrow===true&&record.props.labelPosition===0&&record.props.bend===18,'标注身份/弧度/起点标签不符')
      check(text(record.props.richText).replace(/\u00a0/g,' ')==='原生 标注 🙂组字','原生中文/emoji/组字最终内容不符')
      check(first.commits===1&&!Object.values(first.document.store).some(r=>r.typeName==='binding'),'新建标签不为一次提交或误绑定')
      evidence.samples.push({case:'native-first-label',first})
      await writeFile(join(manifest.output,'annotation-label.png'),await wc.capturePage().then(image=>image.toPNG()))
      await key('Z',['meta']);await until(async()=>!(await read()).document.store[id],'一步撤销')
      check((await read()).document.store['shape:annotation-unrelated'],'撤销删掉无关图形')
      await key('Z',['meta','shift']);await until(async()=>!!(await read()).document.store[id],'一步重做')
      // Document redo intentionally leaves session selection empty. Re-select
      // through native input before exercising the existing Enter-to-edit rule.
      await click(500,280);await until(async()=>(await state()).selectedIds.includes(id),'重做后选择标注')
      await key('Enter');await until(async()=>(await state()).textEditing?.id===id,'重新改字');await wc.insertText('失焦保存');await button('[data-annotation-cancel]')
      await until(async()=>!(await state()).textEditing,'失焦保存')
      const blurred=await read();check(blurred.commits===2&&blurred.state.inputContext.owner==='button'&&blurred.active==='cancel','失焦未干净保存/抢走按钮焦点')
      check(text(blurred.document.store[id].props.richText)==='失焦保存','再次改字失焦保存丢字')
      evidence.samples.push({case:'native-drawing-history-composition-blur',first,blurred})
      let reference
      for(const [zoom,dpr]of [[1,1],[.5,2],[2,1]]){
        await debug.sendCommand('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:dpr,mobile:false})
        await load('static',zoom);const before=await read();await button('[data-annotation-capture]')
        const after=await until(async()=>{const r=await read();return r.output.history.length&&r},'实际PNG')
        const result=after.output.history.at(-1),pixels=await evaluate('window.__HICANVAS_ANNOTATION_PROBE__.pixels([[225,245],[375,245],[225,335],[375,335]],[{x:402,y:280,w:155,h:150},{x:565,y:410,w:160,h:100}])')
        check(JSON.stringify(pixels.rgba)===JSON.stringify([[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255]]),'四角色标PNG像素不符')
        check(pixels.regions[0].red>20&&pixels.regions[1].dark>20,'PNG缺少底图以外的标注箭头/文字像素')
        check(pixels.width===result.width&&pixels.height===result.height&&result.ids.length===3,'PNG编码尺寸或标注集合不符')
        check(JSON.stringify(before.document)===JSON.stringify(after.document)&&before.commits===after.commits&&JSON.stringify(before.state.camera)===JSON.stringify(after.state.camera)&&JSON.stringify(before.state.selectedIds)===JSON.stringify(after.state.selectedIds),'截图改了原稿/选择/视角/历史')
        if(reference)check(JSON.stringify([result.width,result.height,result.bounds])===reference,'缩放/DPR改变截图尺寸');else reference=JSON.stringify([result.width,result.height,result.bounds])
        evidence.samples.push({case:'actual-png',zoom,dpr,result,pixels})
      }
      for(const [kind,width,height,allowed]of [['fraction',790,410,true],['edge',4096,164,true],['edge-over',4097,164,false],['area',4000,4000,true],['area-over',4000,4001,false],['web',528,408,true],['slides',528,408,true]]){
        // Capture only after mounted generated content bound its channel (#141 merge
        // run 2026-11-27: under load the web case clicked first and was refused).
        await load(kind);await until(()=>evaluate('window.__HICANVAS_ANNOTATION_PROBE__.mediaReady()'),`${kind}内容通道就绪`);await button('[data-annotation-capture]')
        const result=await until(async()=>{const r=await read();return !r.output.busy&&(r.output.history.length||r.output.lastError)&&r},kind)
        if(allowed){const row=result.output.history.at(-1),pixels=await evaluate('window.__HICANVAS_ANNOTATION_PROBE__.pixels()');check(row.width===width&&row.height===height&&pixels.width===width&&pixels.height===height,`${kind}实际PNG尺寸不符`);evidence.samples.push({case:kind,result:row,pixels})}
        else{check(result.output.renders===0&&result.output.history.length===0&&result.output.message.includes(`${width}×${height}`),`${kind}未前置拒绝/尺寸提示不符`);evidence.samples.push({case:kind,output:result.output})}
      }
      check(!evidence.violations.length&&!pending.size,'专项产生了外部作用或守卫未确认')
    }
    if(manifest.mode==='green'||manifest.mode==='smoke')check(!evidence.errors.length,`浏览器异常：${JSON.stringify(evidence.errors)}`)
    evidence.ok=!evidence.violations.length
  }catch(error){
    evidence.error=String(error.stack||error)
    try{if(target&&!target.isDestroyed())evidence.diagnostic=await target.webContents.executeJavaScript('window.__HICANVAS_ANNOTATION_PROBE__?.read()')}catch{}
  }
  finally{clearInterval(painting);clearTimeout(deadline);for(const timer of pending.values())clearTimeout(timer);if(target&&!target.isDestroyed())target.destroy()}
  return evidence
}
