import {app,BrowserWindow} from 'electron'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {slideClickCases,syntheticCdnUrl} from './slides-cases.js'
import {verifySlidesPngOrder} from './slides-container-order.mjs'

const manifest=JSON.parse(await readFile(process.argv.at(-1),'utf8'))
const target=new URL(manifest.url),offline=target.protocol==='file:'
if(!offline&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(target.origin))throw new Error('仅允许本机合成幻灯片')
app.setName('hiCanvas slides smoke');app.setPath('userData',manifest.profile);app.setPath('sessionData',manifest.profile)
if(process.platform==='darwin')app.setActivationPolicy('prohibited')
app.on('window-all-closed',()=>{})
async function run(){
  app.dock?.hide()
  const window=new BrowserWindow({show:false,width:1280,height:850,useContentSize:true,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'slides-'+process.pid}})
  const contents=window.webContents,checks=[],observations={clicks:[],keys:[],nativeInputs:[]},blocked=[],errors=[],uncaught=[]
  contents.debugger.on('message',(_event,method,params,sessionId)=>{
    if(method==='Runtime.exceptionThrown')uncaught.push({source:'Runtime.exceptionThrown',sessionId,...params.exceptionDetails})
  })
  contents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false))
  contents.setWindowOpenHandler(()=>({action:'deny'}))
  contents.session.webRequest.onBeforeRequest((details,callback)=>{
    const url=new URL(details.url),allowed=['data:','blob:','about:'].includes(url.protocol)||offline&&url.protocol==='file:'&&url.href.startsWith(new URL('.',target).href)||!offline&&(url.origin===target.origin||/^[a-f0-9]{48}\.localhost$/.test(url.hostname)&&Number(url.port)===manifest.contentPort)
    if(!allowed)blocked.push(details.url)
    callback({cancel:!allowed})
  })
  contents.on('console-message',detail=>{
    if(detail.level==='error')errors.push(detail.message.slice(0,500))
    // Electron forwards console messages from child frames too, including
    // OOPIFs that do not belong to the main Runtime debugging session.
    if(detail.level==='error'&&/^Uncaught\b/.test(detail.message))uncaught.push({source:'console-message',message:detail.message,lineNumber:detail.lineNumber,sourceId:detail.sourceId})
    if(detail.message.startsWith('__SLIDES_INPUT__'))observations.nativeInputs.push(JSON.parse(detail.message.slice('__SLIDES_INPUT__'.length)))
  })
  const evaluate=code=>contents.executeJavaScript(code)
  async function frameEvaluate(frame,code){
    let timer
    // An OOPIF may retire after enumeration but before Electron resolves its
    // evaluation. Bound that read so ready() can retry the replacement frame.
    try{return await Promise.race([frame.executeJavaScript(code),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('演示子页已重载，重新查找')),1000)})])}finally{clearTimeout(timer)}
  }
  const check=(name,value)=>{checks.push({name,pass:!!value});console.log('幻灯片原生：'+name+' '+!!value);if(!value)throw new Error(name)}
  const reading=check
  async function until(predicate){const end=Date.now()+20000;while(Date.now()<end){const value=await predicate();if(value)return value;await delay(25)}throw new Error('幻灯片就绪等待超时')}
  const frameExpression=offline?'document.getElementById("slide")':'window.slidesProbe.iframe'
  const countExpression=offline?'document.getElementById("count").textContent':'window.slidesProbe.state().count'
  const count=()=>evaluate(countExpression)
  let inputSession
  async function childFrame(){
    await evaluate('('+frameExpression+')?.contentWindow?.postMessage({syntheticSlideProbe:"active-slide-probe"},"*")')
    await delay(5)
    for(const frame of contents.mainFrame.frames)try{if(await frameEvaluate(frame,'window.syntheticSlideProbe==="active-slide-probe"'))return frame}catch{/* Navigation replaced a context. */}
    throw new Error('没有当前演示子页')
  }
  async function child(code){return frameEvaluate(await childFrame(),code)}
  const pageOrder=manifest.pageOrder||[1,2,3],total=pageOrder.length,firstCount=`1 / ${total}`,secondCount=`2 / ${total}`,lastCount=`${total} / ${total}`
  const actualNumber=number=>pageOrder[number-1]
  async function ready(){await until(async()=>{try{const number=Number((await count()).split(' / ')[0]);return await child('window.slideLoaded===true&&window.slideNumber==='+actualNumber(number))}catch{return false}});await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');if(manifest.localAssets&&actualNumber(Number((await count()).split(' / ')[0]))===2){
    await until(async()=>{const state=await child('({script:window.syntheticLocalReady===true,color:getComputedStyle(document.querySelector(".local-resource")).color,image:document.getElementById("local-image").naturalWidth,audio:document.getElementById("local-audio").readyState,font:[...document.fonts].some(font=>font.family==="SlidesFixture"&&font.status==="loaded")})');observations.localResources=state;return state.script&&state.color==='rgb(12, 34, 56)'&&state.image===2&&state.audio>=1&&state.font})
  }}
  async function debug(){if(!contents.debugger.isAttached())contents.debugger.attach('1.3')}
  async function childSession(){
    await debug();const src=await evaluate(frameExpression+'.src')
    const {targetInfos}=await contents.debugger.sendCommand('Target.getTargets')
    const frame=targetInfos.find(item=>item.type==='iframe'&&item.url===src)
    return frame?(await contents.debugger.sendCommand('Target.attachToTarget',{targetId:frame.targetId,flatten:true})).sessionId:undefined
  }
  async function click(point,modifiers=0){await debug();await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...point,modifiers},inputSession);for(const type of ['mousePressed','mouseReleased'])await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1,modifiers},inputSession);await delay(60)}
  async function button(label){
    const point=await evaluate(`(()=>{const root=${offline?'document':'document.querySelector(".cowart-slides-viewer")'},el=[...root.querySelectorAll('button')].find(item=>item.getAttribute('aria-label')===${JSON.stringify(label)}||item.textContent.trim()===${JSON.stringify(label)});if(!el||el.disabled)throw new Error('按钮不可用 '+${JSON.stringify(label)});const r=el.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    inputSession=undefined;await click(point)
  }
  async function first(){while(await count()!==firstCount){await button('上一页');await ready()}}
  async function clickCase(item){
    const local=await child(`(()=>{const box=document.querySelector('[data-case="'+${JSON.stringify(item.id)}+'"]'),el=box.firstElementChild;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight}})()`)
    const outer=await evaluate('(()=>{const r='+frameExpression+'.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()')
    inputSession=await childSession()
    const point=inputSession?{x:local.x,y:local.y}:{x:Math.round(outer.x+local.x*outer.width/local.width),y:Math.round(outer.y+local.y*outer.height/local.height)}
    await click(point,item.modifiers||0)
  }
  async function key(key,inside=false,input=false){
    if(inside){await child(`(()=>{const el=${input?'document.querySelector("input")':'document.body'};el.tabIndex=-1;el.focus()})()`);inputSession=await childSession()}
    else{await evaluate('(()=>{const el=document.querySelector(".cowart-slides-present-controls")||document.getElementById("controls");el.tabIndex=-1;el.focus()})()');inputSession=undefined}
    const vk={ArrowLeft:37,ArrowRight:39,' ':32}[key]
    await debug();await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key,code:key===' '?'Space':key,windowsVirtualKeyCode:vk,...(key===' '?{text:' '}:{})},inputSession)
    await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key,code:key===' '?'Space':key,windowsVirtualKeyCode:vk},inputSession);await delay(60)
  }
  try{
    // sendCommand can await the first navigation. Initialize on a blank page
    // so Runtime is enabled before any application script or iframe loads.
    await window.loadURL('about:blank');await debug()
    await contents.debugger.sendCommand('Runtime.enable')
    await window.loadURL(manifest.url)
    if(!offline){await until(()=>evaluate('!!window.__cowartEditor&&!!window.slidesProbe'));await evaluate('window.slidesProbe.setup('+JSON.stringify(manifest.slidesId)+')');await button('播放');await until(()=>evaluate('window.slidesProbe.state().presenting'))}
    await ready();check(total+'页演示从第一页开始',await count()===firstCount)
    observations.pageOrder=[]
    for(let i=0;i<total;i++){
      await ready();observations.pageOrder.push(await child('({number:window.slideNumber,title:document.title})'))
      if(i<total-1)await button('下一页')
    }
    check('实际播放器按容器页序显示内容',JSON.stringify(observations.pageOrder.map(page=>page.number))===JSON.stringify(pageOrder)&&observations.pageOrder.every((page,i)=>page.title==='合成幻灯片 '+pageOrder[i]));await first()
    if(!manifest.orderOnly){
    for(const item of slideClickCases){
      await first();const inputStart=observations.nativeInputs.length;await clickCase(item)
      const after=await count(),advance=after===secondCount,expected=offline?item.offline:item.app
      const events=observations.nativeInputs.slice(inputStart)
      observations.clicks.push({id:item.id,before:firstCount,after,advance,predicted:expected,events})
      if(!['disabled','select','audio','video'].includes(item.id))check('实际点击命中 '+item.id,events.some(event=>event.case===item.id&&event.trusted))
      reading((offline?'离线':'应用内')+'点击 '+item.id,advance===expected)
    }
    for(const [label,keyValue,inside,input] of [['父页右键','ArrowRight',false,false],['父页空格',' ',false,false],['子页右键','ArrowRight',true,false],['子页空格',' ',true,false],['子页输入框右键','ArrowRight',true,true]]){
      await first();await ready();await key(keyValue,inside,input)
      const after=await count(),expected=!inside||offline
      observations.keys.push({label,after,advance:after===secondCount,predicted:expected})
      reading(label,(after===secondCount)===expected)
    }
    {
      await first();await ready();await until(()=>child('!!window.syntheticConnection'))
      await child('(()=>{const c=window.syntheticConnection,d=c.data;c.port.postMessage(d.protocol?{protocol:d.protocol,instance:d.instance,generation:d.generation,type:"slide-nav",value:"previous"}:{version:1,generation:d.generation,type:"slide-nav",value:"previous"});return true})()')
      await delay(100);check('边界意图不改变页码，随后仍能有效翻页',await count()===firstCount)
      await child('window.syntheticSendSlideFlood(true)');await delay(100);check('无效消息也消耗普通额度，紧随的合法意图被丢弃',await count()===firstCount);await delay(1000)
      check('原生页实际发送千条突发意图',await child('window.syntheticSendSlideFlood()')===1000)
      await delay(200);check('同代千条意图只翻一页',await count()===secondCount);await ready()
    }
    await first();await button('下一页');await ready();await key('ArrowLeft',true);await ready();check('子页左键保持原路径语义',await count()===(offline?firstCount:secondCount))
    {
      await first();await button('下一页');await ready();await until(()=>child('!!window.syntheticConnection'))
      // Return the automation evaluation before its message destroys this
      // document. Otherwise Electron can await the retired JS context forever.
      await child('(()=>{const c=window.syntheticConnection,d=c.data;setTimeout(()=>c.port.postMessage(d.protocol?{protocol:d.protocol,instance:d.instance,generation:d.generation,type:"slide-nav",value:"previous"}:{version:1,generation:d.generation,type:"slide-nav",value:"previous"}),50);return true})()')
      await until(async()=>await count()===firstCount);await ready();check('父页按上一页意图决定页码',await count()===firstCount)
    }
    await first();await key('ArrowLeft');await ready();check('第一页向前保持边界',await count()===firstCount)
    await button('下一页');await ready();await button('下一页');await ready();await key('ArrowRight');await ready();check('最后一页向后保持边界',await count()===lastCount)
    }
    // The driver cuts the synthetic CDN before DNS/network access. Author code
    // and ordinary navigation must remain usable when only that resource fails.
    if(pageOrder.includes(3)){
      await until(()=>Promise.resolve(blocked.includes(syntheticCdnUrl)))
      check('外网切断后仅外部部件缺失',await child('window.syntheticCdnLoaded!==true'))
    }else check('删掉外部资源所在页后不再请求该资源',!blocked.includes(syntheticCdnUrl))
    await first();await ready()
    await evaluate('window.__slidesPlayerSecret="synthetic-only"')
    observations.security=await child('(()=>{const denied=fn=>{try{fn();return false}catch{return true}};return{parentDocument:denied(()=>parent.document.body),parentGlobal:denied(()=>parent.__slidesPlayerSecret),parentWrite:denied(()=>{parent.__slidesPlayerSecret="changed"}),topDocument:denied(()=>top.document.body),openerNull:opener===null}})()')
    check('子页读写父窗口和top均被隔离',Object.values(observations.security).every(Boolean))
    if(manifest.localAssets)check('本地CSS、脚本、字体、SVG与音轨已完整加载',!!observations.localResources)
    if(!offline){
      observations.export=await evaluate('window.slidesProbe.export()')
      // The actual PNG action belongs to the canvas toolbar. Keep the complete
      // presentation baseline above, then expose all source pages for capture.
      await button('退出播放');await button('关闭演示页')
      await evaluate('window.__cowartEditor.setCamera({x:0,y:0,z:0.3});true')
      await delay(200)
      observations.pngActivation='canvas after presentation closes; all three source pages in view'
      const pngTask=evaluate('window.slidesProbe.exportImages()').then(value=>({value}),error=>({error}))
      await delay(2500)
      observations.captureFrames=await Promise.all(contents.mainFrame.frames.map(async frame=>({url:frame.url,value:await frameEvaluate(frame,'({visibility:document.visibilityState,images:[...document.images].map(i=>({complete:i.complete,width:i.naturalWidth})),frames:[...document.querySelectorAll("iframe")].map(f=>({realm:f.hasAttribute("data-hicanvas-capture-realm"),src:f.src,loaded:f.contentDocument?.readyState}))})').catch(error=>({error:error.message}))})))
      const pngResult=await pngTask
      if(pngResult.error)throw pngResult.error
      observations.pngExport=pngResult.value
      // Canvas exposes standard RGBA, avoiding NativeImage's platform-dependent
      // raw bitmap layout. These are pixels decoded from the exported PNG files.
      const decodeImage=buffer=>evaluate(`(async()=>{const image=new Image();image.src=${JSON.stringify('data:image/png;base64,'+buffer.toString('base64'))};await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);return{width:canvas.width,height:canvas.height,rgba:[...context.getImageData(8,8,1,1).data]}})()`)
      observations.pngOrder=await verifySlidesPngOrder(observations.pngExport,pageOrder,decodeImage)
      check('实际逐页PNG的名称和像素颜色按容器排序',observations.pngOrder.length===total)
      if(!manifest.orderOnly){observations.exportFailure=await evaluate('window.slidesProbe.exportFailure()');check('后页缺资源时整套导出预检失败',observations.exportFailure.failed)}
    }
    await writeFile(join(manifest.output,(offline?'offline':'app')+'-'+'isolated'+'.png'),(await contents.capturePage()).toPNG())
    if(!offline&&!manifest.orderOnly){
      await evaluate('(()=>{const editor=window.__cowartEditor;editor.select('+JSON.stringify(manifest.slidesId)+');editor.setCamera({x:100,y:500,z:0.3});editor.focus();return true})()')
      const trigger='[data-testid="tool.cowart-export-slides-'+manifest.slidesId+'"]'
      // The inherited contextual toolbar stays parked offscreen in this hidden
      // fixture. Activate its real React/DOM controls to verify new feedback;
      // physical toolbar placement remains part of the user's visual check.
      observations.exportMenuActivation='programmatic DOM click'
      await until(()=>evaluate('!!document.querySelector('+JSON.stringify(trigger)+')'))
      await evaluate('document.querySelector('+JSON.stringify(trigger)+').click();true')
      await until(()=>evaluate('!!document.querySelector(".cowart-export-popover button:last-child")'))
      await evaluate('document.querySelector(".cowart-export-popover button:last-child").click();true')
      await until(()=>evaluate('document.querySelector('+JSON.stringify(trigger)+')?.dataset.status==="sent"'))
      observations.exportNotice=await evaluate('(()=>{const el=document.querySelector('+JSON.stringify(trigger)+');return{title:el.title,label:el.getAttribute("aria-label")}})()')
      // The inherited toolbar component consumes title rather than placing a
      // native title attribute on its button. Its accessible name is observable.
      check('导出菜单组件的可访问名称列出需联网资源',observations.exportNotice.label.startsWith('导出完成；')&&observations.exportNotice.label.includes(syntheticCdnUrl))
    }
    check(offline?'断服后只尝试原外部引用、没有本机请求':'应用只尝试声明的外部引用',blocked.every(url=>url===syntheticCdnUrl))
    await delay(100)
    check('整轮幻灯片零未接住异常',uncaught.length===0)
    await writeFile(manifest.result,JSON.stringify({checks,observations,errors,uncaught,blocked,runtime:process.versions},null,2)+'\n')
    window.destroy();app.exit(0)
  }catch(error){
    observations.failure=await evaluate('({url:location.href,count:'+countExpression+',iframe:'+frameExpression+'?.outerHTML.slice(0,300)})').catch(()=>null)
    observations.frames=await Promise.all(contents.mainFrame.frames.map(async frame=>({url:frame.url,name:frame.name,value:await frameEvaluate(frame,'({name:window.name,number:window.slideNumber,loaded:window.slideLoaded,html:document.body.innerHTML.slice(0,100)})').catch(error=>({error:error.message}))})))
    await writeFile(manifest.result,JSON.stringify({checks,observations,errors,uncaught,blocked,error:error.stack},null,2)+'\n')
    await writeFile(join(manifest.output,'failed-'+(offline?'offline':'app')+'-isolated.png'),(await contents.capturePage()).toPNG())
    console.error(error);window.destroy();app.exit(1)
  }
}
app.whenReady().then(run).catch(error=>{console.error(error);app.exit(1)})
