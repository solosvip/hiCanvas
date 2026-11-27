import {app,BrowserWindow} from 'electron'
import {readFile,writeFile} from 'node:fs/promises'
import {captureSmoke} from './capture-smoke.mjs'

const manifest=JSON.parse(await readFile(process.argv.at(-1),'utf8'))
const origin=new URL(manifest.url).origin
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw new Error('只允许专属本机合成服务')
app.setName('hiCanvas capture regression');app.setPath('userData',manifest.profile);app.setPath('sessionData',manifest.profile)
if(process.platform==='darwin')app.setActivationPolicy('prohibited')
app.on('window-all-closed',()=>{})
app.whenReady().then(async()=>{
  app.dock?.hide()
  const window=new BrowserWindow({show:false,width:1280,height:800,useContentSize:true,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'capture-'+process.pid}})
  const contents=window.webContents,errors=[],blocked=[],held=[],runtimeErrors=[]
  const mode=manifest.fontMode||'font',report={mode,errors,blocked,runtimeErrors}
  contents.setWindowOpenHandler(()=>({action:'deny'}));contents.session.setPermissionRequestHandler((_web,_permission,callback)=>callback(false))
  // Reserved test origin is fulfilled entirely in process; no remote request.
  contents.session.protocol.handle('https',request=>{
    if(request.url==='https://hicanvas-fonts-test.invalid/font.css')return new Response(`@font-face{font-family:CaptureFixture;src:url(data:font/woff2;base64,${manifest.captureFont})}`,{headers:{'content-type':'text/css'}})
    return new Response('',{status:404})
  })
  contents.session.webRequest.onBeforeRequest((details,callback)=>{
    const url=new URL(details.url)
    if(mode==='timeout'&&url.href==='https://hicanvas-fonts-test.invalid/stalled.woff2'){held.push(callback);return}
    const fixture=mode==='cross-origin'&&url.href==='https://hicanvas-fonts-test.invalid/font.css'
    const allowed=fixture||['data:','blob:','about:'].includes(url.protocol)||url.origin===origin||/^[a-f0-9]{48}\.localhost$/.test(url.hostname)&&Number(url.port)===manifest.contentPort
    if(!allowed)blocked.push(details.url)
    callback({cancel:!allowed})
  })
  contents.on('console-message',detail=>{if(detail.level==='error')errors.push(detail.message)})
  contents.on('frame-created',(_event,{frame})=>frame.on('dom-ready',()=>{
    frame.executeJavaScript(`(()=>{window.__captureRuntimeErrors=[];addEventListener('error',event=>window.__captureRuntimeErrors.push(event.message));addEventListener('unhandledrejection',event=>window.__captureRuntimeErrors.push(String(event.reason)));return true})()`).catch(()=>{})
  }))
  contents.on('render-process-gone',(_event,detail)=>runtimeErrors.push('renderer gone '+detail.reason))
  try{
    report.capture=await captureSmoke(window,manifest)
    for(const frame of [contents.mainFrame,...contents.mainFrame.frames])runtimeErrors.push(...await frame.executeJavaScript('window.__captureRuntimeErrors||[]'))
    const unexpected=errors.filter(message=>!(mode==='failed'&&/Failed to decode downloaded font|OTS parsing error/.test(message)))
    if(blocked.length||runtimeErrors.length||unexpected.length)throw new Error(JSON.stringify({blocked,runtimeErrors,unexpected}))
    report.pass=true
  }catch(error){report.pass=false;report.error=error.stack;console.error(error)}
  finally{
    for(const callback of held)callback({cancel:true})
    await writeFile(manifest.result,JSON.stringify(report,null,2)+'\n')
    window.destroy();app.exit(report.pass?0:1)
  }
})
