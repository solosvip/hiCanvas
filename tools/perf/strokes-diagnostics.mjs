import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {scratchPath} from './config.mjs'
import {startPhaseTrace} from './trace.mjs'

export function strokeTraceLabel(fixture,phase){
  return [fixture.stage,fixture.renderer,fixture.count,fixture.repeat,phase].join('-')
}

// Diagnostic runs are separate from acceptance: CPU sampling and timeline
// tracing perturb both opening and frame timings.
export async function startStrokeDiagnosis({contents,...options}){
  const debug=contents.debugger,attachedHere=!debug.isAttached()
  if(attachedHere)debug.attach('1.3')
  let stopTrace,profiling=false
  const stopProfile=async()=>{
    if(!profiling)return
    profiling=false
    const {profile}=await debug.sendCommand('Profiler.stop')
    const path=await scratchPath(join(options.outputDir,options.label+'.cpuprofile'))
    await writeFile(path,JSON.stringify(profile))
    return path
  }
  try{
    await debug.sendCommand('Profiler.enable')
    await debug.sendCommand('Profiler.setSamplingInterval',{interval:1000})
    await debug.sendCommand('Profiler.start');profiling=true
    stopTrace=await startPhaseTrace({contents,...options})
  }catch(error){await stopProfile().catch(()=>{});if(attachedHere&&debug.isAttached())debug.detach();throw error}
  let stopped
  return ()=>stopped||=(async()=>{
    try{return {...await stopTrace(),cpuProfile:await stopProfile()}}
    finally{await stopProfile().catch(()=>{});if(attachedHere&&debug.isAttached())debug.detach()}
  })()
}
export function strokeDomStats(){
  const root=document.querySelector('.tl-canvas')||document.querySelector('#canvas')
  if(!root)throw new Error('笔迹诊断没有画布。')
  const paths=[...root.querySelectorAll('path')],data=paths.map(path=>path.getAttribute('d')||'')
  return {nodes:root.querySelectorAll('*').length,svg:root.querySelectorAll('svg').length,paths:paths.length,pathCharacters:data.reduce((n,d)=>n+d.length,0),pathCommands:data.reduce((n,d)=>n+(d.match(/[MmLlHhVvCcSsQqTtAaZz]/g)||[]).length,0),longestPath:Math.max(0,...data.map(d=>d.length))}
}

// Visual ablation only: remove group transparency in the disposable preview,
// then restore it. Geometry, path data, records and DOM topology stay intact.
export function setStrokeOpacity(mode){
  if(mode==='opaque'){
    if(window.__strokeOriginalOpacity)throw new Error('透明度诊断未恢复。')
    window.__strokeOriginalOpacity=[...document.querySelectorAll('#canvas svg[data-stroke-layer] g[opacity]')].map(node=>[node,node.getAttribute('opacity')])
    if(!window.__strokeOriginalOpacity.length)throw new Error('没有合成笔迹图层。')
    for(const [node] of window.__strokeOriginalOpacity)node.setAttribute('opacity','1')
  }else if(mode==='restore'){
    for(const [node,value] of window.__strokeOriginalOpacity||[])node.setAttribute('opacity',value)
    delete window.__strokeOriginalOpacity
  }else throw new Error('未知透明度诊断。')
}
export function strokeOpacityStats(){
  const groups=[...document.querySelectorAll('#canvas svg[data-stroke-layer] g[opacity]')]
  return {groups:groups.length,transparent:groups.filter(node=>Number(node.getAttribute('opacity'))!==1).length}
}
