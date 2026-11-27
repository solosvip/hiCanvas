import {createCanvasStore} from '../../model/index.js'
import {mountCanvasRenderer,loadGeneratedFrame} from '../../renderer/index.js'
import {getContentChannel} from '../../content-channel/index.js'
import {createEmbedGallery} from '../renderer-preview/embed-gallery.js'
import {runContentEscapes} from './security-escapes.js'

const until=async predicate=>{const deadline=Date.now()+8000;while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20))}throw new Error('内容安全门禁等待超时')}
export async function runContentSecurity({scriptUrl,desktop=false}){
  const checks=[],check=(name,value)=>{checks.push({name,pass:!!value});if(!value)throw new Error(name)}
  if(desktop)check('实际桌面主框架加载了生产preload',typeof hiCanvasDesktop?.skillStatus==='function')
  window.__contentHostSecret='synthetic-parent'
  localStorage.setItem('content-host-secret','synthetic-storage')
  const fixture=createEmbedGallery(),ids=['shape:embed-web','shape:embed-film','shape:embed-slide','shape:embed-slides']
  for(const [id,record] of Object.entries(fixture.snapshot.store))if(record.typeName==='shape'&&!ids.includes(id))delete fixture.snapshot.store[id]
  const childScript=`
    let captureHeld=false;const nativeRAF=window.requestAnimationFrame;
    window.addEventListener('message',async event=>{
      if(event.source!==parent||event.origin!==${JSON.stringify(location.origin)})return;
      if(event.data==='capture-hold'){captureHeld=true;window.requestAnimationFrame=()=>1;return}
      if(event.data==='capture-release'){captureHeld=false;window.requestAnimationFrame=nativeRAF;return}
      if(!['security-probe','capture-security-probe'].includes(event.data))return;
      const attempt=fn=>{try{return {blocked:false,value:fn()}}catch(error){return {blocked:true,error:error.name}}};
      const result={type:event.data==='security-probe'?'security-result':'capture-security-result',kind:document.title,
        captureHeld,captureFrame:!!document.querySelector('iframe[data-hicanvas-capture-realm]'),
        captureSibling:attempt(()=>parent.frames[0].frames[0].document.body.textContent),
        window:attempt(()=>parent.__contentHostSecret),storage:attempt(()=>parent.localStorage.getItem('content-host-secret')),
        sibling:attempt(()=>{const target=parent.frames[0]===window?parent.frames[1]:parent.frames[0];return target.document.body.textContent}),
        domain:attempt(()=>{document.domain='localhost';return document.domain}),nodeDisabled:typeof require==='undefined'&&typeof process==='undefined',bridge:typeof hiCanvasDesktop,thirdParty:window.__thirdPartyLoaded===true,requests:[]};
      if(event.data==='security-probe')for(const options of [{method:'POST',body:'{}'},{method:'POST',mode:'no-cors',body:'{}'},{method:'POST',headers:{'x-hicanvas-client':'1','content-type':'application/json'},body:'{"title":"forbidden"}'}]){
        try{const response=await fetch(${JSON.stringify(location.origin)}+'/api/conversations/open',options);result.requests.push(response.status)}catch(error){result.requests.push(error.name)}
      }
      parent.postMessage(result,${JSON.stringify(location.origin)});
    });
    window.CowartFilm={duration:1,seek(){},play(){},pause(){},setMuted(){}};
    parent.postMessage({type:'content-loaded',kind:document.title},${JSON.stringify(location.origin)});
  `
  for(const id of ids){const record=fixture.snapshot.store[id];if(record.type==='embed')record.props.url='data:text/html,'+encodeURIComponent(`<!doctype html><title>${id}</title><h1>${id}</h1><script src="${scriptUrl}"></script><script>${childScript}<\/script>`)}
  const raw=createCanvasStore();raw.loadStoreSnapshot(fixture.snapshot)
  const before=JSON.stringify(raw.getStoreSnapshot()),host=document.createElement('div');document.body.append(host)
  host.style.cssText='position:fixed;inset:0;width:1200px;height:800px;z-index:2147483646'
  const loaded=new Map(),reports=new Map(),captureReports=new Map()
  const receive=event=>{
    const frames=[...host.querySelectorAll('iframe[data-embed-content]')],frame=frames.find(value=>value.contentWindow===event.source)
    if(!frame||event.origin!==new URL(frame.src).origin)return
    if(event.data?.type==='content-loaded')loaded.set(event.data.kind,true)
    if(event.data?.type==='capture-security-result')captureReports.set(event.data.kind,event.data)
    if(event.data?.type==='security-result')reports.set(event.data.kind,event.data)
  }
  addEventListener('message',receive)
  const revocations=[]
  const loadFrame=async(...args)=>{
    const frame=await loadGeneratedFrame(...args)
    return {...frame,dispose(){const pending=frame.dispose();revocations.push(pending);return pending}}
  }
  const renderer=mountCanvasRenderer(host,{store:raw,pageId:fixture.viewState.currentPageId,camera:{x:0,y:0,z:.4},loadGeneratedFrame:loadFrame})
  let urls=[]
  try{
    await until(()=>loaded.size===3)
    const frames=[...host.querySelectorAll('iframe[data-embed-content]')]
    urls=frames.map(frame=>frame.src)
    check('网页、影片及Slides三类已执行脚本并显示',frames.length===3)
    check('三类内容在可见画布区域内拥有非零显示区域',frames.every(frame=>{const rect=frame.getBoundingClientRect();return rect.width>0&&rect.height>0&&rect.top<800&&rect.left<1200}))
    check('显示不改写保存记录',JSON.stringify(raw.getStoreSnapshot())===before)
    check('每实例来源互不相同且不同于父页',new Set(urls.map(url=>new URL(url).origin)).size===3&&urls.every(url=>new URL(url).origin!==location.origin))
    check('全部使用实际内容URL',frames.every(frame=>!frame.hasAttribute('srcdoc')))
    const independentHost=document.createElement('div');document.body.append(independentHost)
    let startupRequests=0
    const originalFetch=globalThis.fetch
    globalThis.fetch=(url,options)=>{if(url==='/api/health')startupRequests++;return originalFetch(url,options)}
    const independent=mountCanvasRenderer(independentHost,{store:raw,pageId:fixture.viewState.currentPageId})
    try{
      await until(()=>independentHost.querySelectorAll('iframe[src]').length===3&&[...independentHost.querySelectorAll('iframe')].every(frame=>getContentChannel(frame)))
      check('独立挂载未传加载器也只经宿主，每页启动信息共用一次',startupRequests===1&&[...independentHost.querySelectorAll('iframe')].every(frame=>!frame.hasAttribute('srcdoc')&&/^[a-f0-9]{48}\.localhost$/.test(new URL(frame.src).hostname)))
    }finally{independent.unmount();independentHost.remove();globalThis.fetch=originalFetch}
    for(const frame of frames)frame.contentWindow.postMessage('security-probe',new URL(frame.src).origin)
    await until(()=>reports.size===3)
    for(const result of reports.values()){
      check(result.kind+'：第三来源经典脚本可运行',result.thirdParty)
      check(result.kind+'：内容页没有Node运行权限',result.nodeDisabled)
      if(desktop)check(result.kind+'：内容页没有桌面IPC桥',result.bridge==='undefined')
      for(const name of ['window','storage','sibling','domain'])check(result.kind+'：'+name+'读取／放宽被拒绝',result[name].blocked)
    }
    {
      await until(()=>frames.every(frame=>!!getContentChannel(frame)))
      frames[0].contentWindow.postMessage('capture-hold',new URL(frames[0].src).origin)
      const abort=new AbortController(),capture=getContentChannel(frames[0]).request('capture',{width:320,height:180,pixelRatio:1},{signal:abort.signal})
      capture.catch(()=>{})
      const ask=()=>{for(const frame of frames)frame.contentWindow.postMessage('capture-security-probe',new URL(frame.src).origin)}
      let poll=setInterval(ask,50)
      try{
        await until(()=>captureReports.size===3&&[...captureReports.values()].some(result=>result.captureFrame))
        check('截图停在受控等待点，未释放RAF不能自然完成',[...captureReports.values()].some(result=>result.captureFrame&&result.captureHeld))
        let blocked=false
        try{void frames[0].contentWindow.frames[0].document}catch(error){blocked=error.name==='SecurityError'}
        check('实际截图中性iframe存在时父页仍不可访问',blocked)
        const peers=[...captureReports.values()].filter(result=>!result.captureFrame)
        check('其他实例不可访问截图中性iframe',peers.length===2&&peers.every(result=>result.captureSibling.error==='SecurityError'))
      }finally{clearInterval(poll);abort.abort();await capture.then(()=>check('取消请求必须拒绝',false),error=>check('取消请求明确AbortError',error.name==='AbortError'))}
      captureReports.clear();poll=setInterval(ask,50)
      try{
        await until(()=>captureReports.size===3&&[...captureReports.values()].every(result=>!result.captureFrame))
        check('取消截图后中性iframe已全部移除',true)
      }finally{clearInterval(poll);frames[0].contentWindow.postMessage('capture-release',new URL(frames[0].src).origin)}
    }
    // Exercise the same loading interface used by the legacy editor's data-URL slide branch.
    const directUrl='data:text/html,<h1>legacy</h1>',legacy=await loadGeneratedFrame(null,{directUrl})
    check('dataURL先登记实例，绝不直接导航',!!legacy.attributes.src&&!legacy.attributes.src.startsWith('data:'))
    await legacy.dispose()
    for(const extension of ['html','svg']){
      const direct=document.createElement('iframe')
      let result
      const receiveDirect=event=>{if(event.source===direct.contentWindow&&event.origin==='null'&&event.data?.type==='direct-security')result=event.data}
      addEventListener('message',receiveDirect)
      try{
        // No iframe sandbox attribute: the resource response must enforce isolation itself.
        direct.src='/assets/direct.'+extension;host.append(direct)
        await until(()=>result)
        for(const name of ['window','storage','domain'])check('直接打开'+extension+'：'+name+'被响应沙箱拒绝',result[name])
      }finally{direct.remove();removeEventListener('message',receiveDirect)}
    }
    const escapes=await runContentEscapes({scriptUrl});checks.push(...escapes.checks)
    renderer.unmount()
    await Promise.all(revocations)
    const output=document.querySelector('#result')
    if(output)output.textContent=JSON.stringify({checks,reports:[...reports.values()]},null,2)
    return {checks,reports:[...reports.values()],urls,escapes:escapes.observations}
  }finally{
    renderer.unmount();removeEventListener('message',receive);host.remove()
    localStorage.removeItem('content-host-secret');delete window.__contentHostSecret
  }
}
