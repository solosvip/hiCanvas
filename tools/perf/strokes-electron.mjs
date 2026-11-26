import {app,BrowserWindow,contentTracing} from 'electron'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {performance} from 'node:perf_hooks'
import os from 'node:os'
import {benchmarkViewport,isolatedDirectories,scratchPath} from './config.mjs'
import {cameraReaderScript} from './observers.mjs'
import {startPhaseTrace} from './trace.mjs'
import {measureStrokePhase,selected} from './strokes-phase.mjs'
import * as probe from './strokes-probe.mjs'
import {strokeSummary} from './strokes-report.mjs'
import {startStrokeDiagnosis,strokeDomStats,setStrokeOpacity,strokeTraceLabel,strokeOpacityStats} from './strokes-diagnostics.mjs'

const directories=await isolatedDirectories(),manifest=JSON.parse(await readFile(await scratchPath(process.argv.at(-1)),'utf8'))
await scratchPath(manifest.outputDir);await scratchPath(manifest.resultPath)
for(const origin of manifest.origins){const url=new URL(origin);if(url.origin!==`http://127.0.0.1:${url.port}`||!url.port||[43218,43219].includes(Number(url.port)))throw new Error('笔迹测量只允许专用loopback服务。')}
for(const item of [...manifest.cases,...manifest.retests])if(!manifest.origins.includes(new URL(item.url).origin))throw new Error('未登记的笔迹测量来源。')
app.setName('hiCanvas stroke benchmark')
app.setPath('userData',directories.HICANVAS_DESKTOP_CONFIG_DIR);app.setPath('sessionData',directories.HICANVAS_DESKTOP_CONFIG_DIR)
if(process.platform==='darwin')app.setActivationPolicy('prohibited')
for(const flag of ['disable-background-timer-throttling','disable-renderer-backgrounding','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag)
app.on('window-all-closed',()=>{})
let window,activeTrace
const samples=[],warmups=[],blockedHosts=new Set(),consoleErrors=[]
const evaluate=(fn,arg)=>window.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`)
const record=()=>writeFile(manifest.resultPath,JSON.stringify({samples,warmups,runtime:process.versions,gpu:app.getGPUFeatureStatus(),blockedHosts:[...blockedHosts],consoleErrors},null,2))
async function sample(fixture,serial){
  const startedAt=new Date().toISOString(),loadBefore=os.loadavg(),paints=[]
  window=new BrowserWindow({show:false,...benchmarkViewport,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true,nodeIntegration:false,partition:`stroke-${process.pid}-${serial}`}})
  window.webContents.setFrameRate(60);window.webContents.on('paint',()=>paints.push(performance.now()))
  const session=window.webContents.session,origin=new URL(fixture.url).origin
  session.setPermissionRequestHandler((_c,_p,callback)=>callback(false));session.setPermissionCheckHandler(()=>false)
  session.webRequest.onBeforeRequest((details,callback)=>{const url=new URL(details.url),allowed=url.origin===origin||['data:','blob:'].includes(url.protocol)||url.protocol==='ws:'&&url.host===new URL(origin).host;if(!allowed)blockedHosts.add(url.host);callback({cancel:!allowed})})
  window.webContents.on('console-message',detail=>{if(detail.level==='error')consoleErrors.push(detail.message.slice(0,500))})
  window.webContents.on('render-process-gone',(_event,detail)=>consoleErrors.push(`renderer gone: ${detail.reason}`))
  const diagnose=manifest.diagnostic&&fixture.stage!=='warmup'
  if(diagnose){await window.loadURL('data:text/html,<html></html>');activeTrace=await startStrokeDiagnosis({tracing:contentTracing,contents:window.webContents,outputDir:manifest.outputDir,label:strokeTraceLabel(fixture,'open')})}
  const start=performance.now()
  await window.loadURL(fixture.url)
  const ready=await evaluate(probe.waitUntilReady,fixture)
  if(['x','y','z'].some(key=>Math.abs(ready.camera[key]-fixture.camera[key])>1e-6))throw new Error('两版起始视角与合成输入不一致，拒绝性能比较。')
  for(const type of ['mouseMove','mouseDown','mouseUp'])window.webContents.sendInputEvent({type,x:Math.round(ready.point.x),y:Math.round(ready.point.y),button:'left',clickCount:1})
  await selected(evaluate,fixture)
  const openMs=performance.now()-start
  let openingTrace,dom
  if(diagnose){openingTrace=await activeTrace();activeTrace=undefined;dom=await evaluate(strokeDomStats)}
  await window.webContents.executeJavaScript(cameraReaderScript(probe))
  console.log(`${fixture.stage} ${fixture.renderer} ${fixture.count} r${fixture.repeat}: open ${Math.round(openMs)}ms`)
  if(fixture.stage!=='warmup'&&fixture.repeat===1)await writeFile(join(manifest.outputDir,`${fixture.stage}-${fixture.renderer}-${fixture.count}.png`),(await window.webContents.capturePage()).toPNG())
  const phases={}
  for(const name of ['pan','zoom','drag'])phases[name]=await measureStrokePhase({name,fixture:{...fixture,camera:ready.camera},contents:window.webContents,paints,evaluate,durationMs:fixture.stage==='warmup'?500:manifest.durationMs,startTrace:manifest.tracing&&fixture.stage!=='warmup'?async()=>{
    activeTrace=await (diagnose?startStrokeDiagnosis:startPhaseTrace)({tracing:contentTracing,contents:window.webContents,outputDir:manifest.outputDir,label:strokeTraceLabel(fixture,name)})
    return async()=>{const stop=activeTrace;activeTrace=undefined;return stop()}
  }:undefined})
  const ablation=[]
  if(diagnose&&manifest.ablation&&fixture.renderer==='preview'&&fixture.count===5000){
    try{
      for(const variant of ['original-before','opaque','original-after']){
        if(variant==='opaque')await evaluate(setStrokeOpacity,'opaque')
        if(variant==='original-after')await evaluate(setStrokeOpacity,'restore')
        const census=await evaluate(strokeDomStats),opacity=await evaluate(strokeOpacityStats)
        if(variant==='opaque'&&opacity.transparent!==0||variant!=='opaque'&&opacity.transparent===0)throw new Error('消融透明度未应用。')
        if(JSON.stringify(census)!==JSON.stringify(dom))throw new Error('消融改变了DOM或路径数据。')
        const phase=await measureStrokePhase({name:'pan',fixture,contents:window.webContents,paints,evaluate,durationMs:manifest.durationMs,startTrace:async()=>{
          activeTrace=await startStrokeDiagnosis({tracing:contentTracing,contents:window.webContents,outputDir:manifest.outputDir,label:strokeTraceLabel(fixture,`ablation-${variant}`)})
          return async()=>{const stop=activeTrace;activeTrace=undefined;return stop()}
        }})
        if(JSON.stringify(await evaluate(strokeOpacityStats))!==JSON.stringify(opacity))throw new Error('消融透明度在测量中改变。')
        ablation.push({variant,phase,dom:census,opacity})
      }
    }finally{await evaluate(setStrokeOpacity,'restore')}
  }
  const result={...fixture,url:undefined,camera:undefined,targetPoint:undefined,openMs,ready,phases,openingTrace,dom,ablation,startedAt,finishedAt:new Date().toISOString(),loadBefore,loadAfter:os.loadavg()}
  window.destroy();window=undefined
  return result
}
async function run(){
  app.dock?.hide()
  try{
    let serial=0
    for(const fixture of manifest.cases){
      const result=await sample(fixture,serial++)
      if(fixture.stage==='warmup')warmups.push(result);else samples.push(result)
      await record()
    }
    const first=strokeSummary(samples,manifest.options),failed=new Set(first.comparisons.filter(item=>!item.pass).map(item=>item.count))
    for(const fixture of manifest.retests.filter(item=>!manifest.tracing&&failed.has(item.count))){samples.push(await sample(fixture,serial++));await record()}
    if(blockedHosts.size||consoleErrors.length)throw new Error('浏览器存在错误或外部请求，拒绝正式性能结论。')
    await record();app.exit(0)
  }catch(error){
    await activeTrace?.().catch(()=>{});activeTrace=undefined
    if(window&&!window.isDestroyed())await writeFile(join(manifest.outputDir,'failure.png'),(await window.webContents.capturePage()).toPNG())
    await writeFile(manifest.resultPath,JSON.stringify({error:error.stack,samples,warmups,blockedHosts:[...blockedHosts],consoleErrors},null,2))
    window?.destroy();app.exit(1)
  }
}
app.whenReady().then(run).catch(error=>{console.error(error);app.exit(1)})
