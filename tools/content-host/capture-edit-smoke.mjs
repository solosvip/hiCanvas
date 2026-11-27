import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

export async function captureEditSmoke(window,manifest){
  const contents=window.webContents,frame=contents.mainFrame.frames[0]
  const parent=code=>contents.executeJavaScript(code)
  let helpers=0
  // Keep a legitimate caller-owned ignore node: filtering all ignored nodes
  // would lose saved page content and must fail this regression.
  await frame.executeJavaScript(`(()=>{const node=document.createElement('span');node.id='legitimate-ignore';node.setAttribute('data-html2canvas-ignore','true');node.textContent='必须保留';document.body.append(node);return true})()`)
  await parent('window.__captureSmoke.editCommand("edit-start")')
  const clean=await parent('window.__captureSmoke.editCommand("edit-snapshot")')
  await writeFile(join(manifest.output,manifest.sample+'-edit-before.html'),clean.html)
  await frame.executeJavaScript(`(()=>{
    window.__captureCloneHeld=false
    const observer=new MutationObserver(records=>{
      for(const record of records)for(const node of record.addedNodes){
        if(node.nodeName!=='IFRAME'||!node.classList.contains('html2canvas-container'))continue
        const pending=new Promise(resolve=>{window.__releaseCaptureClone=resolve})
        Object.defineProperty(node.contentDocument.fonts,'ready',{configurable:true,get:()=>pending})
        window.__captureCloneHeld=true;observer.disconnect()
      }
    });observer.observe(document.body,{childList:true});window.__captureEditObserver=observer;return true
  })()`)
  // The channel deliberately serializes large replies. Exercise its real edit
  // command while the same production captureDocument runs in the child, so
  // this serialization regression reaches the save seam instead of busy gating.
  await frame.executeJavaScript(`(()=>{window.__captureEditDone=false;window.__captureEditError=null;(async()=>{try{const instance=location.hostname.split('.')[0];const {captureDocument}=await import('/.hicanvas-channel/'+instance+'/capture.js');await captureDocument(window,{width:320,height:180,pixelRatio:2},new AbortController().signal);window.__captureEditDone=true}catch(error){window.__captureEditError=String(error)}})();return true})()`)

  try{
    const end=Date.now()+6000
    while(!await frame.executeJavaScript('window.__captureCloneHeld')){
      if(Date.now()>end)throw new Error('未实际进入有帮助节点的截图阶段')
      await delay(10)
    }
    helpers=await frame.executeJavaScript('document.querySelectorAll("[data-hicanvas-capture-realm]").length')
    const expected=manifest.fontMode==='plain'?2:3
    if(helpers!==expected)throw new Error('保存测试没有实际覆盖全部截图帮助节点 '+helpers)
    await frame.executeJavaScript(`(()=>{const heading=document.querySelector('h1');heading.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:60,clientY:50}));heading.textContent+=' 已保存';heading.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:' 已保存'}));return true})()`)
    const saved=await parent('window.__captureSmoke.editCommand("edit-snapshot")')
    if(saved.revision!==1||!saved.html.includes('已保存')||!saved.html.includes('legitimate-ignore')||/data-hicanvas-capture-realm|html2canvas-container|\.hicanvas-channel/.test(saved.html))throw new Error('截图中保存失败、丢失普通节点或包含帮助节点')
    await writeFile(join(manifest.output,manifest.sample+'-edit-during.html'),saved.html)
    await parent('window.__captureSmoke.editCommand("edit-ack",'+saved.revision+')')
  }finally{
    await frame.executeJavaScript('window.__captureEditObserver.disconnect();window.__releaseCaptureClone?.();true')
  }
  const end=Date.now()+6000
  while(!await frame.executeJavaScript('window.__captureEditDone')){
    const error=await frame.executeJavaScript('window.__captureEditError');if(error)throw new Error(error)
    if(Date.now()>end)throw new Error('保存后的截图没有结束')
    await delay(10)
  }
  await parent('window.__captureSmoke.editCommand("edit-stop",false)')
  const remaining=await frame.executeJavaScript('document.querySelectorAll("[data-hicanvas-capture-realm]").length')
  if(remaining)throw new Error('并发保存截图后残留帮助节点')
  return {helpersDuringSave:helpers,revision:1,keptOrdinaryIgnore:true,remaining}
}
