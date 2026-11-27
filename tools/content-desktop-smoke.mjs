import './test-sandbox.mjs'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdir,mkdtemp,readFile,writeFile,cp,rm,access} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {packager} from '@electron/packager'
import {build} from 'esbuild'
import {workspaceIdentity} from '../server/workspace-identity.mjs'
import {launchDesktopProcess} from './content-host/desktop-process.mjs'

const root=fileURLToPath(new URL('../',import.meta.url)),output=join(root,'.scratch/content-desktop-smoke')
const port=Number(process.env.HICANVAS_DESKTOP_SECURITY_PORT)
if(!Number.isInteger(port)||port<43300||port>65535)throw new Error('先登记白板专用端口，再设置HICANVAS_DESKTOP_SECURITY_PORT（43300以上）。')
// *_DIR inputs are intentionally rewritten by test-sandbox. This is a read-only
// runtime cache input, not a user data directory.
const zipDir=process.env.HICANVAS_TEST_ELECTRON_ZIP
if(!zipDir)throw new Error('请提供已有Electron缓存ZIP的目录HICANVAS_TEST_ELECTRON_ZIP；本门禁不下载运行时。')
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
await access(join(zipDir,`electron-v${pkg.devDependencies.electron}-darwin-arm64.zip`))
await mkdir(output,{recursive:true})
const runtime=await mkdtemp(join(output,'runtime-')),stage=join(runtime,'stage'),config=join(runtime,'config'),project=join(runtime,'project'),canvas=join(project,'canvas'),base=`http://127.0.0.1:${port}`
let appProcess,service,inspector
const logs=[],targets=new Set([base+'/'])
const script=createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1')
  if(url.pathname==='/redirect'){
    const target=url.searchParams.get('target')
    if(!targets.has(target)){res.writeHead(403).end();return}
    res.writeHead(302,{location:target}).end();return
  }
  res.setHeader('content-type','text/javascript');res.end('window.__thirdPartyLoaded=true')
})
async function until(predicate,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){service?.check();appProcess?.check();try{const value=await predicate();if(value)return value}catch{/* Process is still starting. */}await delay(30)}throw new Error('桌面安全门禁等待超时')}
async function api(path){const response=await fetch(base+path,{headers:{'x-hicanvas-client':'1'},signal:AbortSignal.timeout(2000)});assert.ok(response.ok,path);return response.json()}
function connectInspector(url){
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(url),pending=new Map(),events=new Map();let sequence=0
    const connecting=setTimeout(()=>{socket.close();reject(new Error('Inspector连接超时'))},10000)
    socket.addEventListener('error',error=>{clearTimeout(connecting);reject(error)},{once:true})
    socket.addEventListener('open',()=>{clearTimeout(connecting);resolve({
      request(method,params={},timeout=30000){return new Promise((yes,no)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);no(new Error('Inspector超时：'+method))},timeout);pending.set(id,{yes,no,timer});socket.send(JSON.stringify({id,method,params}))})},
      event(method){return new Promise((yes,no)=>{const timer=setTimeout(()=>{events.delete(method);no(new Error('Inspector事件超时：'+method))},10000);events.set(method,value=>{clearTimeout(timer);yes(value)})})},
      close(){for(const entry of pending.values()){clearTimeout(entry.timer);entry.no(new Error('Inspector已关闭'))}pending.clear();socket.close()},
    })},{once:true})
    socket.addEventListener('message',event=>{
      const data=JSON.parse(event.data),entry=pending.get(data.id)
      if(entry){pending.delete(data.id);clearTimeout(entry.timer);data.error?entry.no(new Error(JSON.stringify(data.error))):entry.yes(data.result)}
      if(events.has(data.method)){events.get(data.method)(data.params);events.delete(data.method)}
    })
  })
}
async function evaluate(expression,timeout=30000){
  const result=await inspector.request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},timeout)
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text)
  return result.result.value
}
const electron="process.getBuiltinModule('module').createRequire(process.execPath)('electron')"
const contents=`${electron}.BrowserWindow.getAllWindows()[0].webContents`
const browser=code=>evaluate(`${contents}.executeJavaScript(${JSON.stringify(code)})`,120000)
try{
  await cp(join(root,'build/desktop-stage'),stage,{recursive:true})
  await build({absWorkingDir:root,stdin:{contents:"import {runContentSecurity} from './tools/content-host/probe.js';window.runContentSecurity=runContentSecurity",resolveDir:root},bundle:true,format:'esm',outfile:join(stage,'dist','synthetic-security.js'),logLevel:'silent'})
  const apps=await packager({dir:stage,out:join(runtime,'packed'),name:'hiCanvas security',executableName:'hiCanvas',appBundleId:'com.hicanvas.synthetic-security',platform:'darwin',arch:'arm64',electronVersion:pkg.devDependencies.electron,electronZipDir:zipDir,asar:true,prune:false,overwrite:true,quiet:true})
  const application=join(apps[0],'hiCanvas security.app'),executable=join(application,'Contents/MacOS/hiCanvas'),appRoot=join(application,'Contents/Resources/app.asar')
  const env={...process.env,HICANVAS_DESKTOP_CONFIG_DIR:config,HICANVAS_PROJECT_DIR:project,HICANVAS_CANVAS_DIR:canvas,HICANVAS_SETTINGS_DIR:join(project,'settings'),HICANVAS_URL:base,HICANVAS_APP_ROOT:appRoot,HICANVAS_SKILL_HOME:join(runtime,'skill-home')}
  for(const name of ['HICANVAS_PORT','HICANVAS_DESKTOP_DEBUG_PORT','HICANVAS_DESKTOP_APP','ELECTRON_RUN_AS_NODE'])delete env[name]
  await mkdir(config,{recursive:true});await writeFile(join(config,'skill-preferences.json'),JSON.stringify({deferred:true}))
  const assets=join(canvas,'assets');await mkdir(assets,{recursive:true})
  const direct=`const attempt=fn=>{try{fn();return false}catch{return true}};parent.postMessage({type:'direct-security',window:attempt(()=>parent.document.body),storage:attempt(()=>parent.localStorage.length),domain:attempt(()=>{document.domain='localhost'})},new URL(document.URL).origin)`
  await writeFile(join(assets,'direct.html'),'<script>'+direct+'</script>')
  await writeFile(join(assets,'direct.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><script><![CDATA['+direct+']]></script></svg>')
  await writeFile(join(assets,'redirect.html'),`<script>parent.postMessage({type:'escape-started',kind:'resource-redirect'},${JSON.stringify(base)});setTimeout(()=>location.assign(${JSON.stringify(base+'/')}),100)<\/script>`)
  service=launchDesktopProcess(executable,[join(appRoot,'runtime/service.mjs')],{env:{...env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','ignore','pipe']});service.child.stderr.on('data',data=>logs.push(data.toString()))
  const health=await until(()=>api('/api/health'))
  assert.equal(health.workspace,workspaceIdentity(canvas))
  await new Promise((resolve,reject)=>{script.once('error',reject);script.listen(0,'127.0.0.1',resolve)})
  let inspectorUrl
  appProcess=launchDesktopProcess(executable,['--inspect-brk=127.0.0.1:0'],{env,stdio:['ignore','ignore','pipe']});appProcess.child.stderr.on('data',data=>{logs.push(data.toString());inspectorUrl ||= logs.join('').match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/)?.[0]})
  await until(()=>inspectorUrl);inspector=await connectInspector(inspectorUrl)
  await inspector.request('Runtime.enable');await inspector.request('Debugger.enable')
  const paused=inspector.event('Debugger.paused');await inspector.request('Runtime.runIfWaitingForDebugger');const pause=await paused
  logs.push('Initial pause: '+JSON.stringify(pause.callFrames.map(frame=>({function:frame.functionName,url:frame.url,location:frame.location})))+'\n')
  // Intercept only external effects: system URL registration, visible windows
  // and modal error output. The production entry, BrowserWindow preferences,
  // preload, IPC handlers, service and generated content remain unchanged.
  // Paused code must use the paused call frame, without awaiting a microtask
  // that cannot run until resume. Later browser work uses Runtime.evaluate.
  const patched=await inspector.request('Debugger.evaluateOnCallFrame',{callFrameId:pause.callFrames[0].callFrameId,expression:`(()=>{const e=${electron};globalThis.__securityHarness={protocolCalls:[],errors:[]};e.app.setAsDefaultProtocolClient=(...args)=>{__securityHarness.protocolCalls.push(args);return false};e.app.setActivationPolicy('prohibited');e.BrowserWindow.prototype.showInactive=function(){};e.dialog.showErrorBox=(title,message)=>__securityHarness.errors.push({title,message});return true})()`,returnByValue:true})
  if(patched.exceptionDetails)throw new Error(patched.exceptionDetails.exception?.description||patched.exceptionDetails.text)
  await inspector.request('Debugger.resume')
  await until(()=>evaluate(`${electron}.BrowserWindow.getAllWindows()[0]?.webContents.getURL().startsWith(${JSON.stringify(base)})`))
  await until(()=>browser('typeof hiCanvasDesktop?.skillStatus==="function"&&document.readyState==="complete"&&!!window.__cowartEditor'))
  const preferences=await evaluate(`${contents}.getLastWebPreferences()`)
  for(const [key,value] of Object.entries({nodeIntegration:false,contextIsolation:true,sandbox:true,webviewTag:false}))assert.equal(preferences[key],value,key)
  assert.equal(await evaluate(`${electron}.app.getPath('userData')`),config,'正式入口必须使用合成配置目录')
  const before=await api('/api/conversations')
  const injected=await browser("(async()=>{const errors=[],error=event=>errors.push({message:event.message,file:event.filename,line:event.lineno});addEventListener('error',error);try{await new Promise((resolve,reject)=>{const script=document.createElement('script');script.type='module';script.src='/synthetic-security.js';script.onload=()=>resolve();script.onerror=()=>reject(new Error('合成门禁脚本加载失败'));document.head.append(script)});return {ready:typeof window.runContentSecurity==='function',errors}}finally{removeEventListener('error',error)}})()")
  assert.ok(injected.ready,JSON.stringify(injected))
  const observed=await browser(`Promise.resolve().then(()=>window.runContentSecurity(${JSON.stringify({desktop:true,scriptUrl:`http://127.0.0.1:${script.address().port}/third-party.js`})})).then(value=>({value}),error=>({error:String(error?.message||error),stack:error?.stack}))`)
  if(observed.error)throw new Error(observed.stack||observed.error)
  const result=observed.value
  assert.deepEqual(await api('/api/conversations'),before,'攻击不能创建额外画板')
  for(const origin of ['null',`http://${'a'.repeat(48)}.localhost:${health.contentHost.port}`]){
    const response=await fetch(base+'/api/conversations/open',{method:'POST',headers:{origin,'x-hicanvas-client':'1','content-type':'application/json'},body:'{"title":"forbidden"}'})
    assert.equal(response.status,403)
  }
  const harness=await evaluate('globalThis.__securityHarness')
  assert.deepEqual(harness.errors,[])
  assert.equal(harness.protocolCalls.length,1)
  await writeFile(join(output,'report.json'),JSON.stringify({...result,packaged:true,asar:true,releaseSigningTested:false,preferences:{nodeIntegration:preferences.nodeIntegration,contextIsolation:preferences.contextIsolation,sandbox:preferences.sandbox,webviewTag:preferences.webviewTag},externalEffectsIntercepted:['OS protocol registration','showInactive','error dialog'],protocolCalls:harness.protocolCalls.length,canvasUnchanged:true,sourceRejections:2},null,2)+'\n')
  await writeFile(join(output,'desktop.png'),Buffer.from(await evaluate(`${contents}.capturePage().then(image=>image.toPNG().toString('base64'))`),'base64'))
  console.log('实际ASAR桌面入口内容安全门禁通过：'+output)
}finally{
  inspector?.close()
  await Promise.all([appProcess?.stop(),service?.stop()])
  script.closeAllConnections();if(script.listening)await new Promise(resolve=>script.close(resolve))
  try{await writeFile(join(output,'runtime.txt'),logs.join(''))}finally{await rm(runtime,{recursive:true,force:true})}
}
