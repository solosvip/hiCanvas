import {app,BrowserWindow} from 'electron'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

const manifest=JSON.parse(await readFile(process.argv.at(-1),'utf8')),origin=new URL(manifest.url).origin
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw new Error('仅允许本机合成页面')
app.setName('hiCanvas edit smoke');app.setPath('userData',manifest.profile);app.setPath('sessionData',manifest.profile)
if(process.platform==='darwin')app.setActivationPolicy('prohibited')
app.on('window-all-closed',()=>{})
async function run(){
app.dock?.hide()
const window=new BrowserWindow({show:false,width:1280,height:850,useContentSize:true,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'edit-'+process.pid}})
const contents=window.webContents,checks=[],errors=[],blocked=[],observations={}
contents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false))
contents.session.webRequest.onBeforeRequest((details,callback)=>{
  const url=new URL(details.url),allowed=url.origin===origin||['data:','blob:','about:'].includes(url.protocol)||/^[a-f0-9]{48}\.localhost$/.test(url.hostname)&&Number(url.port)===manifest.contentPort
  if(!allowed)blocked.push(details.url)
  callback({cancel:!allowed})
})
contents.on('console-message',detail=>{if(detail.level==='error')errors.push(detail.message.slice(0,500))})
const evaluate=code=>contents.executeJavaScript(code)
let inputSession
async function debug(){if(!contents.debugger.isAttached())contents.debugger.attach('1.3')}
async function childInputSession(){
  await debug()
  const {targetInfos}=await contents.debugger.sendCommand('Target.getTargets')
  const target=targetInfos.find(item=>item.type==='iframe'&&/^[a-f0-9]{48}\.localhost$/.test(new URL(item.url).hostname))
  if(!target)return null
  return(await contents.debugger.sendCommand('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId
}
const check=(name,value)=>{checks.push({name,pass:!!value});console.log('编辑原生：'+name+' '+!!value);if(!value)throw new Error(name)}
async function until(predicate){const end=Date.now()+30000;while(Date.now()<end){const value=await predicate();if(value)return value;await delay(25)}throw new Error('就地编辑等待超时')}
async function frame(){
  for(const child of contents.mainFrame.frames)try{if(await child.executeJavaScript('!!document.getElementById("first")'))return child}catch{/* Frame replaced. */}
  throw new Error('合成网页未找到')
}
async function child(code){return(await frame()).executeJavaScript(code)}
async function click(point){
  await debug()
  await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...point},inputSession)
  for(const type of ['mousePressed','mouseReleased'])await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1},inputSession)
  await delay(40)
}
async function button(text){
  const point=await until(()=>evaluate(`(()=>{const element=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)}||el.getAttribute('aria-label')===${JSON.stringify(text)});if(!element)return null;const r=element.getBoundingClientRect();return r.width&&r.height?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}:null})()`))
  inputSession=null;await click(point)
}
async function element(id){
  const local=await child(`(()=>{const el=document.getElementById(${JSON.stringify(id)}),range=document.createRange();range.selectNodeContents(el);const rect=range.getBoundingClientRect();return{x:Math.round(el.tagName==='BUTTON'?(rect.left+rect.right)/2:rect.right+7),y:Math.round(rect.top+Math.min(12,rect.height/2))}})()`)
  const outer=await evaluate('(()=>{const r=window.editProbe.iframe.getBoundingClientRect();return{x:r.x,y:r.y}})()')
  const point={x:Math.round(outer.x+local.x),y:Math.round(outer.y+local.y)}
  observations.lastPoint={local,outer,point,targets:await evaluate('document.elementsFromPoint('+point.x+','+point.y+').map(el=>({tag:el.tagName,cls:el.className,pe:getComputedStyle(el).pointerEvents}))')}
  inputSession=await childInputSession();await click(inputSession?local:point)
}
async function key(keyCode,modifiers=[]){if(inputSession){const key=keyCode==='Enter'?'Enter':keyCode;const code=keyCode==='Enter'?'Enter':keyCode;const vk=keyCode==='Enter'?13:37;await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk,modifiers:modifiers.includes('shift')?8:0,...(keyCode==='Enter'?{text:'\r'}:{})},inputSession);await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk,modifiers:modifiers.includes('shift')?8:0},inputSession);await delay(25);return}contents.sendInputEvent({type:'keyDown',keyCode:keyCode.replace(/^Arrow/,''),modifiers});if(keyCode==='Enter')contents.sendInputEvent({type:'char',keyCode:'\r',modifiers});contents.sendInputEvent({type:'keyUp',keyCode:keyCode.replace(/^Arrow/,''),modifiers});await delay(25)}
async function insert(text){if(inputSession)await contents.debugger.sendCommand('Input.insertText',{text},inputSession);else await contents.insertText(text);await delay(25)}
async function begin(){await until(()=>evaluate('!window.editProbe.state().session'));await button('编辑文本');await until(()=>evaluate('window.editProbe.state().session'));await until(()=>child('document.documentElement.hasAttribute("data-cowart-dom-editor-active")'));await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await contents.capturePage();await delay(100)}
async function persisted(){return evaluate('window.editProbe.persisted()')}
async function unloadBlocked(){return evaluate('(()=>{const event=new Event("beforeunload",{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})()')}
try{
  await window.loadURL(manifest.url+'/tools/content-host/edit.html?conversation='+manifest.conversationId)
  await until(()=>evaluate('!!window.__cowartEditor&&!!window.editProbe'))
  await evaluate(`window.editProbe.setup(${JSON.stringify(manifest.shapeId)})`)
  await until(async()=>{try{return await child('document.readyState!=="loading"')}catch{return false}})
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await contents.capturePage();await delay(100)
  check('开关选用预期加载路径',(await evaluate('window.editProbe.state().isolated'))===manifest.enabled)
  check('合成本地图片实际解码',await child('document.getElementById("raster").naturalWidth===1'))
  await begin()
  await child('window.__editInputTrace=[];document.addEventListener("pointerdown",event=>window.__editInputTrace.push({type:event.type,id:event.target.id,x:event.clientX,y:event.clientY}),true)')
  await element('first')
  observations.click=await child('({events:window.__editInputTrace,innerWidth,innerHeight,selected:document.querySelector("[data-cowart-dom-editor-selected]")?.id})');console.log(JSON.stringify(observations.click))
  check('点选文本添加plaintext-only',await child('document.getElementById("first").getAttribute("contenteditable")==="plaintext-only"'))
  await insert('!');await key('Enter');await insert('next')
  observations.afterTyping=await child('({text:document.getElementById("first").innerText,html:document.getElementById("first").innerHTML,selection:getSelection().toString(),active:document.activeElement?.id})')
  console.log(JSON.stringify(observations.afterTyping))
  check('光标定位、原生换行和连续输入',observations.afterTyping.text==='Alpha beta gamma!\nnext')
  for(let i=0;i<4;i++)await key('ArrowLeft',['shift'])
  check('原生选字保留四字符',await child('getSelection().toString()==="next"'))
  await insert('edited')
  observations.first=await child('({text:document.getElementById("first").innerText,html:document.getElementById("first").innerHTML,selection:getSelection().toString()})')
  check('选字替换不改动前文',observations.first.text==='Alpha beta gamma!\nedited')
  await element('second');await insert('!')
  check('切换点选后前一段退出临时编辑',await child('!document.getElementById("first").hasAttribute("contenteditable")&&document.getElementById("second").innerText==="one two three!"'))
  await element('preexisting');await insert('!')
  check('原有可编辑属性保持',await child('document.getElementById("preexisting").getAttribute("contenteditable")==="true"&&document.getElementById("preexisting").getAttribute("spellcheck")==="true"'))
  await element('action')
  check('编辑点击不执行页面按钮',await child('!window.actionClicks&&document.getElementById("action").hasAttribute("data-cowart-dom-editor-selected")'))
  await button('完成编辑')
  await until(()=>evaluate('window.editProbe.state().editing===null'))
  const saved=await persisted();observations.saved=saved.html
  check('真实编辑命令保存了输入',saved.html.includes('gamma!')&&saved.html.includes('edited')&&saved.html.includes('three!')&&saved.html.includes('Existing!'))
  check('保存无编辑标记和桥接残留',!/data-cowart-dom-editor-|cowart-dom-editor-style|\.hicanvas-channel|[a-f0-9]{48}\.localhost|blob:/i.test(saved.html))
  check('原始资源链接未变',saved.html.includes('href="'+origin+'/c/'+manifest.conversationId+'/assets/sample.css"'))
  check('图片保存保留开关对应路径',manifest.enabled?saved.html.includes('src="/c/'+manifest.conversationId+'/assets/sample.png"'):saved.html.includes('src="data:image/png;base64,'))
  check('原有contenteditable和spellcheck未被清理',saved.html.includes('contenteditable="true" spellcheck="true"'))
  if(manifest.enabled&&!manifest.observe){
    await begin();await element('second');await insert(' racing-A')
    check('输入后不等父状态即有子页退出保护',await child('(()=>{document.getElementById("second").dispatchEvent(new InputEvent("input",{bubbles:true}));const event=new Event("beforeunload",{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})()'))
    await until(()=>unloadBlocked())
    check('未保存输入阻止关闭页面',await unloadBlocked())
    const oldSource=await evaluate('window.editProbe.state().src')
    await evaluate('window.editProbe.hold();window.editProbe.flush()')
    await until(()=>evaluate('window.editProbe.state().saving||window.__editFlush?.error'));if(await evaluate('!!window.__editFlush?.error'))throw new Error(await evaluate('window.__editFlush.error'))
    await insert(' + racing-B')
    const visible=await child('document.getElementById("second").innerText')
    await evaluate('window.editProbe.release()')
    await until(()=>evaluate('window.__editFlush?.done||window.__editFlush?.error'))
    check('保存途中连续输入可完成',await evaluate('window.__editFlush.done===true'))
    check('保存回写不重载当前网页',await evaluate('window.editProbe.state().src')===oldSource)
    const concurrent=await persisted()
    check('最终画板内容与仍在编辑的页面一致',concurrent.html.includes(visible)&&await child('document.getElementById("second").innerText')===visible)
    check('后续输入产生下一次持版本写入',await evaluate('window.editProbe.requests.length')>=3)
    await button('完成编辑');await until(()=>evaluate('window.editProbe.state().editing===null'))
    observations.concurrent={visible,requests:await evaluate('window.editProbe.requests')}
    await until(async()=>!await unloadBlocked())
    check('保存成功解除未保存退出保护',!await unloadBlocked())
    await begin();await element('second');await insert(' merged-local')
    await evaluate('window.editProbe.hold();window.editProbe.flush()')
    await until(()=>evaluate('window.editProbe.state().saving||window.__editFlush?.error'));if(await evaluate('!!window.__editFlush?.error'))throw new Error(await evaluate('window.__editFlush.error'))
    const oldPosition=(await persisted()).shape.x
    await evaluate('window.editProbe.remoteMove()')
    await evaluate('window.editProbe.release()')
    await until(()=>evaluate('window.__editFlush?.done||window.__editFlush?.error'))
    check('真实位置冲突读取最新后携版本保存',await evaluate('window.__editFlush.done===true'))
    const merged=await persisted()
    check('远端位置和本地文字同时保留',merged.shape.x===oldPosition+20&&merged.html.includes('merged-local'))
    await button('完成编辑');await until(()=>evaluate('window.editProbe.state().editing===null'))
    await begin();await element('second');await insert(' local-conflict-draft')
    await evaluate('window.editProbe.hold();window.editProbe.flush()')
    await until(()=>evaluate('window.editProbe.state().saving||window.__editFlush?.error'));if(await evaluate('!!window.__editFlush?.error'))throw new Error(await evaluate('window.__editFlush.error'))
    const foreign=(await persisted()).html.replace('one two three!','Foreign original!')
    await evaluate('window.editProbe.remote('+JSON.stringify(foreign)+')')
    await evaluate('window.editProbe.release()')
    await until(()=>evaluate('window.__editFlush?.error'))
    check('同一网页原文冲突拒绝覆盖', (await persisted()).html===foreign)
    check('冲突后保留当前页面草稿',await child('document.getElementById("second").innerText.includes("local-conflict-draft")'))
    check('冲突原因与重试按钮可见',await evaluate('(()=>{const el=document.querySelector("[data-hicanvas-save-error]");return !!el&&el.textContent.includes("网页")&&el.textContent.includes("重试保存")&&el.getBoundingClientRect().height>0})()'))
    check('冲突后未保存退出保护仍生效',await unloadBlocked())
    observations.conflict={error:await evaluate('window.__editFlush.error'),requests:await evaluate('window.editProbe.requests')}
  }
  await writeFile(join(manifest.output,(manifest.observe?'legacy':manifest.enabled?'on':'off')+'-window.png'),(await contents.capturePage()).toPNG())
  check('未发起公网请求',blocked.length===0)
  await writeFile(manifest.result,JSON.stringify({checks,observations,errors,blocked,runtime:process.versions},null,2)+'\n')
  window.destroy();app.exit(0)
}catch(error){
  observations.failure=await evaluate('({state:window.editProbe?.state(),flush:window.__editFlush,current:window.__cowartEditor?.store.getStoreSnapshot(),notice:document.querySelector("[data-hicanvas-save-error]")?.textContent})').catch(()=>null)
  observations.persisted=await persisted().catch(()=>null)
  await writeFile(manifest.result,JSON.stringify({checks,observations,errors,blocked,error:error.stack},null,2)+'\n')
  await writeFile(join(manifest.output,'failed-'+(manifest.enabled?'on':'off')+'.png'),(await contents.capturePage()).toPNG())
  console.error(error);window.destroy();app.exit(1)
}

}
app.whenReady().then(run).catch(error=>{console.error(error);app.exit(1)})
