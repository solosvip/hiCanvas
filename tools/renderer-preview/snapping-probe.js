import { createCanvasSnapshot, createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'

const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const guide = () => ({kind:'snap-guides',bounds:{x:0,y:0,w:0,h:0},lines:[{start:{x:10,y:20},end:{x:10,y:300},points:[{x:10,y:20},{x:10,y:300}],ticks:[{x:10,y:160}],gap:true}]})

// Separate read-only renderer contract probe on its own synthetic Store. It
// uses the public mount/setOverlays boundary, never an internal validator.
export async function snappingOverlayProbe() {
  const store=createCanvasStore(),snapshot=createCanvasSnapshot()
  store.loadStoreSnapshot(snapshot)
  const beforeSnapshot=JSON.stringify(store.getStoreSnapshot())
  const host=document.createElement('div')
  host.style.cssText='position:fixed;inset:var(--spacing-none);pointer-events:none'
  document.body.append(host)
  const view=mountCanvasRenderer(host,{store})
  const check=(ok,message)=>{if(!ok)throw new Error(message)}
  const line=()=>host.querySelector('[data-snap-guide]')
  try {
    const input=guide();view.setOverlays([input]);await settle()
    const before=line().style.transform
    input.lines[0].start.x=900;input.lines[0].ticks.push({x:1,y:1})
    view.setCamera({x:0,y:0,z:2});await settle()
    check(line().style.transform.includes('10px')&&!line().style.transform.includes('900px'),'覆盖层保留宿主坐标引用')
    check(host.querySelectorAll('[data-snap-tick]').length===1,'覆盖层保留宿主刻度数组引用')
    for(const patch of [null,{start:{x:NaN,y:0}},{end:{x:Infinity,y:0}},{points:null},{ticks:{}},{gap:'yes'},{start:{x:-Number.MAX_VALUE,y:0},end:{x:Number.MAX_VALUE,y:0}}]){
      const invalid=guide();invalid.lines[0]=patch===null?null:{...invalid.lines[0],...patch}
      let rejected=false
      try{view.setOverlays([invalid])}catch{rejected=true}
      check(rejected,'渲染公开边界接受非法提示线')
    }
    view.setCamera({x:0,y:0,z:1});await settle()
    check(line().style.transform===before,'拒绝非法描述时破坏了现有覆盖层')
    check(JSON.stringify(store.getStoreSnapshot())===beforeSnapshot,'提示线写入了画板')
    view.setOverlays([]);await settle();check(!line(),'清理覆盖层后线段仍在')
    return {copiedHostInput:true,rejectedInvalidAndOverflowingGuides:true,invalidUpdateAtomic:true,documentUnchanged:true}
  } finally {view.unmount();host.remove();store.dispose()}
}
