import {renderHtmlDraftDocument} from './capture-render.js'
import {createCaptureRealm} from './capture-realm.js'
import {captureSize} from './capture-protocol.js'

// This module is loaded again only inside the child-owned, same-origin neutral
// iframe via a fixed module src. No generated script, eval or parent capability.
if(globalThis.document?.documentElement?.hasAttribute('data-hicanvas-capture-realm')){
  Object.defineProperty(globalThis,'__hicanvasCaptureRender',{value:renderHtmlDraftDocument,configurable:true})
}

export async function captureDocument(host,options,signal,{film=false,videoFrames}={}){
  if(!captureSize(options))throw new Error('截图尺寸超过4096边长或1600万像素上限。')
  const doc=host.document,cleanups=[]
  const aborted=()=>signal.throwIfAborted()
  const wait=promise=>new Promise((resolve,reject)=>{
    const cancel=()=>{cleanup();reject(signal.reason||new DOMException('已取消。','AbortError'))}
    const cleanup=()=>signal.removeEventListener('abort',cancel)
    signal.addEventListener('abort',cancel,{once:true})
    Promise.resolve(promise).then(value=>{cleanup();resolve(value)},error=>{cleanup();reject(error)})
    if(signal.aborted)cancel()
  })
  let canvas,realm
  try{
    aborted()
    if(!film){
      const assets=[doc.fonts?.ready]
      for(const image of Array.from(doc.images||[])){
        if(image.complete){assets.push(image.decode?.().catch(()=>{}));continue}
        assets.push(new Promise(resolve=>{
          const finish=()=>{cleanup();resolve()}
          const cleanup=()=>{image.removeEventListener('load',finish);image.removeEventListener('error',finish)}
          cleanups.push(cleanup)
          image.addEventListener('load',finish,{once:true});image.addEventListener('error',finish,{once:true})
        }))
      }
      // Preserve the old 2s settling period, but wait for assets within the bounded
      // capture deadline instead of returning a partially loaded image silently.
      const settled=new Promise(resolve=>{const timer=setTimeout(resolve,2000);cleanups.push(()=>clearTimeout(timer))})
      await wait(Promise.all(assets))
      realm=await createCaptureRealm(doc,import.meta.url,signal)
      await wait(settled)
      await wait(new Promise(resolve=>{
        if(!host.requestAnimationFrame){const timer=setTimeout(resolve,34);cleanups.push(()=>clearTimeout(timer));return}
        let frame=host.requestAnimationFrame(()=>{frame=host.requestAnimationFrame(resolve)})
        cleanups.push(()=>host.cancelAnimationFrame(frame))
      }))
    }else{
      // Old export waits in seekFilmFrame (seek, one export paint, fonts/images)
      // then decodes embedded video. Add no 2s screenshot settling or extra RAF.
      realm=await createCaptureRealm(doc,import.meta.url,signal)
    }
    aborted()
    // html2canvas cannot stop its clone/render pass. Retain the single capture
    // slot until it finishes, then discard pixels on cancel without transferring.
    canvas=await realm.render(doc,{...options,freezeAtCurrentFrame:film,videoFrames})
    aborted()
    const result={width:canvas.width,height:canvas.height,pixels:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.buffer}
    return result
  }finally{
    for(const cleanup of cleanups)cleanup()
    if(canvas){canvas.width=0;canvas.height=0}
    realm?.dispose()
  }
}
