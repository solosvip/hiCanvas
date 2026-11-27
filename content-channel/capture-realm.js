// html2canvas measures fonts using its realm's global document. Keep those
// helper nodes outside generated CSS, just like the old parent-side capture.
export async function createCaptureRealm(doc,assetUrl,signal){
  const iframe=doc.createElement('iframe')
  iframe.setAttribute('data-hicanvas-capture-realm','')
  iframe.setAttribute('data-html2canvas-ignore','true')
  iframe.setAttribute('aria-hidden','true')
  iframe.style.cssText='all:initial!important;position:fixed!important;left:-10000px!important;top:0!important;width:1px!important;height:1px!important;border:0!important;visibility:hidden!important;pointer-events:none!important'
  let removeAbort=()=>{}
  try{
    signal.throwIfAborted()
    doc.body.append(iframe)
    const neutral=iframe.contentDocument
    neutral.documentElement.setAttribute('data-hicanvas-capture-realm','')
    await new Promise((resolve,reject)=>{
      const script=neutral.createElement('script')
      const cancel=()=>reject(signal.reason||new DOMException('已取消。','AbortError'))
      removeAbort=()=>signal.removeEventListener('abort',cancel)
      signal.addEventListener('abort',cancel,{once:true})
      script.type='module';script.src=assetUrl
      script.onload=()=>resolve()
      script.onerror=()=>reject(new Error('中性截图模块加载失败。'))
      neutral.head.append(script)
    })
    signal.throwIfAborted()
    const render=iframe.contentWindow.__hicanvasCaptureRender
    if(typeof render!=='function')throw new Error('中性截图模块尚未就绪。')
    return{render,dispose:()=>iframe.remove()}
  }catch(error){iframe.remove();throw error}
  finally{removeAbort()}
}

const FONT_WAIT_MS=2000
export function waitForCaptureFonts(doc,signal){
  return boundedFonts(doc.fonts?.ready,signal)
}
function boundedFonts(promise,signal){
  return new Promise((resolve,reject)=>{
    const finish=value=>{cleanup();resolve(value)}
    const cancel=()=>{cleanup();reject(signal.reason||new DOMException('已取消。','AbortError'))}
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel)}
    const timer=setTimeout(()=>finish(false),FONT_WAIT_MS)
    signal.addEventListener('abort',cancel,{once:true})
    Promise.resolve(promise).then(()=>finish(true),()=>finish(true))
    if(signal.aborted)cancel()
  })
}

// Canvas text resolves fonts in its owner document. Keeping it in the source
// document preserves even CSS-connected fonts from unreadable CDN stylesheets.
// Metrics need those same fonts, but generated CSS must not style their helper
// elements: use a shadow tree, with the pinned library's measurement unchanged.
export function captureFontEnvironment(doc,neutral){
  if(!Array.from(doc.fonts||[]).some(face=>face.status==='loaded'))return {document:neutral,dispose(){}}
  const host=doc.createElement('div')
  host.setAttribute('data-html2canvas-ignore','true')
  host.setAttribute('data-hicanvas-capture-realm','')
  host.style.cssText='all:initial!important;position:fixed!important;left:-10000px!important;top:0!important;display:block!important;visibility:hidden!important;pointer-events:none!important'
  const shadow=host.attachShadow({mode:'closed'})
  let canvas
  try{canvas=doc.createElement('canvas');doc.body.append(host)}catch(error){host.remove();throw error}
  return {canvas,document:{body:shadow,createElement:doc.createElement.bind(doc),createTextNode:doc.createTextNode.bind(doc)},dispose:()=>host.remove()}
}

// Font requests can also delay the clone iframe's load event, before the pinned
// cloner reaches fonts.ready. Bound both waits without rewriting generated CSS.
// The iframe setup and scroll restoration follow html2canvas 1.4.1's MIT cloner;
// its license and copyright are preserved in capture-clip-fix.js and LICENSE.
export async function createFontCaptureClone(cloner,doc,bounds,signal){
  const frame=doc.createElement('iframe'),owner=doc.defaultView
  const scrollX=owner.pageXOffset,scrollY=owner.pageYOffset
  frame.className='html2canvas-container'
  Object.assign(frame.style,{visibility:'hidden',position:'fixed',left:'-10000px',top:'0px',border:'0'})
  frame.width=String(bounds.width);frame.height=String(bounds.height);frame.scrolling='no'
  frame.setAttribute('data-html2canvas-ignore','true')
  frame.setAttribute('data-hicanvas-capture-realm','')
  doc.body.appendChild(frame)
  const cloned=frame.contentDocument,view=frame.contentWindow
  let removeLoad=()=>{}
  try{
    signal.throwIfAborted()
    const loaded=new Promise(resolve=>{
      const finish=()=>resolve()
      frame.addEventListener('load',finish)
      removeLoad=()=>frame.removeEventListener('load',finish)
    })
    cloned.open()
    cloned.write((doc.doctype?new owner.XMLSerializer().serializeToString(doc.doctype):'')+'<html></html>')
    cloned.replaceChild(cloned.adoptNode(cloner.documentElement),cloned.documentElement)
    cloned.close()
    for(const face of Array.from(doc.fonts||[]))if(face.status==='loaded'){
      try{cloned.fonts.add(face)}catch{/* CSS-connected faces load from unchanged stylesheets. */}
    }
    if(owner.pageXOffset!==scrollX||owner.pageYOffset!==scrollY)owner.scrollTo(scrollX,scrollY)
    if(!await boundedFonts(loaded,signal))view.stop()
    if(!await waitForCaptureFonts(cloned,signal))view.stop()
    await waitForCaptureImages(cloned,signal)
    for(const [element,left,top]of cloner.scrolledElements){element.scrollLeft=left;element.scrollTop=top}
    view.scrollTo(bounds.left,bounds.top)
    if(!cloner.clonedReferenceElement)throw new Error('截图克隆目标丢失。')
    await cloner.options.onclone?.(cloned,cloner.clonedReferenceElement)
    signal.throwIfAborted()
    return frame
  }catch(error){frame.remove();throw error}
  finally{removeLoad()}
}

function waitForCaptureImages(doc,signal){
  return Promise.all(Array.from(doc.images||[]).map(image=>{
    if(image.complete||!image.src)return
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{image.removeEventListener('load',finish);image.removeEventListener('error',finish);signal.removeEventListener('abort',cancel)}
      const finish=()=>{cleanup();resolve()}
      const cancel=()=>{cleanup();reject(signal.reason||new DOMException('已取消。','AbortError'))}
      image.addEventListener('load',finish,{once:true});image.addEventListener('error',finish,{once:true})
      signal.addEventListener('abort',cancel,{once:true})
      if(signal.aborted)cancel()
    })
  }))
}
