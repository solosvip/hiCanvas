import {createCanvasStore} from '../../model/index.js'
import {mountCanvasRenderer,loadGeneratedFrame} from '../../renderer/index.js'
import {createEmbedGallery} from '../renderer-preview/embed-gallery.js'

const until=async predicate=>{const deadline=Date.now()+8000;while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20))}throw new Error('内容安全门禁等待超时')}
export async function runContentSecurity({enabled,scriptUrl}){
  const checks=[],check=(name,value)=>{checks.push({name,pass:!!value});if(!value)throw new Error(name)}
  window.__contentHostSecret='synthetic-parent'
  localStorage.setItem('content-host-secret','synthetic-storage')
  const fixture=createEmbedGallery(),ids=['shape:embed-web','shape:embed-film','shape:embed-slide','shape:embed-slides']
  for(const [id,record] of Object.entries(fixture.snapshot.store))if(record.typeName==='shape'&&!ids.includes(id))delete fixture.snapshot.store[id]
  const childScript=`
    window.addEventListener('message',async event=>{
      if(event.source!==parent||event.origin!==${JSON.stringify(location.origin)}||event.data!=='security-probe')return;
      const attempt=fn=>{try{return {blocked:false,value:fn()}}catch(error){return {blocked:true,error:error.name}}};
      const result={type:'security-result',kind:document.title,
        window:attempt(()=>parent.__contentHostSecret),storage:attempt(()=>parent.localStorage.getItem('content-host-secret')),
        sibling:attempt(()=>{const target=parent.frames[0]===window?parent.frames[1]:parent.frames[0];return target.document.body.textContent}),
        domain:attempt(()=>{document.domain='localhost';return document.domain}),thirdParty:window.__thirdPartyLoaded===true,requests:[]};
      if(${JSON.stringify(enabled)})for(const options of [{method:'POST',body:'{}'},{method:'POST',mode:'no-cors',body:'{}'},{method:'POST',headers:{'x-hicanvas-client':'1','content-type':'application/json'},body:'{"title":"forbidden"}'}]){
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
  host.style.height='800px';host.style.width='1200px'
  const loaded=new Map(),reports=new Map()
  const receive=event=>{
    const frames=[...host.querySelectorAll('iframe[data-embed-content]')],frame=frames.find(value=>value.contentWindow===event.source)
    if(!frame||event.origin!==(enabled?new URL(frame.src).origin:location.origin))return
    if(event.data?.type==='content-loaded')loaded.set(event.data.kind,true)
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
    if(enabled){
      check('每实例来源互不相同且不同于父页',new Set(urls.map(url=>new URL(url).origin)).size===3&&urls.every(url=>new URL(url).origin!==location.origin))
      check('开启时全部使用实际内容URL',frames.every(frame=>!frame.hasAttribute('srcdoc')))
    }else check('默认关闭保持原srcdoc及HTML',frames.every(frame=>frame.hasAttribute('srcdoc')))
    const independentHost=document.createElement('div');document.body.append(independentHost)
    let startupRequests=0
    const originalFetch=globalThis.fetch
    globalThis.fetch=(url,options)=>{if(url==='/api/health')startupRequests++;return originalFetch(url,options)}
    const independent=mountCanvasRenderer(independentHost,{store:raw,pageId:fixture.viewState.currentPageId})
    try{
      await until(()=>independentHost.querySelectorAll('iframe[srcdoc]').length===3)
      check('独立宿主不传加载能力仍可展示内联内容且不探测HTTP',startupRequests===0)
    }finally{independent.unmount();independentHost.remove();globalThis.fetch=originalFetch}
    for(const frame of frames)frame.contentWindow.postMessage('security-probe',enabled?new URL(frame.src).origin:location.origin)
    await until(()=>reports.size===3)
    for(const result of reports.values()){
      check(result.kind+'：第三来源经典脚本可运行',result.thirdParty)
      if(enabled){for(const name of ['window','storage','sibling','domain'])check(result.kind+'：'+name+'读取／放宽被拒绝',result[name].blocked)}
      else check(result.kind+'：反例确实能读取父身份',result.window.value==='synthetic-parent'&&result.storage.value==='synthetic-storage')
    }
    // Exercise the same loading interface used by the legacy editor's data-URL slide branch.
    const directUrl='data:text/html,<h1>legacy</h1>',legacy=await loadGeneratedFrame(null,{directUrl})
    check('旧加载入口的dataURL开关语义',enabled?!!legacy.attributes.src&&!legacy.attributes.src.startsWith('data:'):legacy.attributes.src===directUrl)
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
    renderer.unmount()
    await Promise.all(revocations)
    document.querySelector('#result').textContent=JSON.stringify({checks,reports:[...reports.values()]},null,2)
    return {checks,reports:[...reports.values()],urls,enabled}
  }finally{
    renderer.unmount();removeEventListener('message',receive);host.remove()
    localStorage.removeItem('content-host-secret');delete window.__contentHostSecret
  }
}
