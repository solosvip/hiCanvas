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
