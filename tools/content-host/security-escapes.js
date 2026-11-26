import {loadGeneratedFrame} from '../../renderer/index.js'

// Deliberate attacks, outside the product graph. Parent DOM reads here are
// negative assertions. A successful navigation must still leave an opaque
// blocked document; simply failing to load an attack is not a passing result.
export async function runContentEscapes({scriptUrl}){
  const checks=[],observations=[],instances=[],frames=[]
  const check=(name,value)=>{checks.push({name,pass:!!value});if(!value)throw new Error(name)}
  const until=async predicate=>{const end=Date.now()+12000;while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20))}throw new Error('内容逃逸反例未完成预期导航')}
  const blocked=frame=>{try{return frame.contentDocument===null&&(()=>{try{void frame.contentWindow.document;return false}catch(error){return error.name==='SecurityError'}})()}catch{return false}}
  const attacks=new Map()
  const receive=event=>{
    const attack=[...attacks.values()].find(value=>value.frame.contentWindow===event.source)
    if(attack&&event.origin===attack.origin&&event.data?.type==='escape-started'&&event.data.kind===attack.kind)attack.started=true
  }
  addEventListener('message',receive)
  function mount(src,sandbox){
    const frame=document.createElement('iframe'),state={frame,loads:0}
    frame.title='synthetic security attack'
    if(sandbox)frame.setAttribute('sandbox',sandbox)
    frame.addEventListener('load',()=>state.loads++)
    frame.src=src;document.body.append(frame);frames.push(frame)
    return state
  }
  try{
    // Same-origin embedding has no cross-site request filter to save it. The
    // response's frame-ancestors policy must reject both entry spellings.
    for(const path of ['/','/index.html']){
      const state=mount(location.origin+path)
      await until(()=>state.loads>0)
      check('画板同源父页也不能嵌入 '+path,blocked(state.frame))
      observations.push({kind:'embedded-board',path,loads:state.loads,blocked:true})
      state.frame.remove()
    }
    const redirect=new URL('/redirect',scriptUrl);redirect.searchParams.set('target',location.origin+'/')
    const redirected=mount(redirect.href)
    await until(()=>redirected.loads>0)
    check('HTTP重定向不能把画板放进内容框',blocked(redirected.frame))
    observations.push({kind:'http-redirect',loads:redirected.loads,blocked:true});redirected.frame.remove()
    const resource=mount(location.origin+'/assets/redirect.html')
    Object.assign(resource,{kind:'resource-redirect',origin:'null',started:false});attacks.set('resource-redirect',resource)
    await until(()=>resource.started&&resource.loads>=2)
    check('直接资源执行脚本后跳回画板仍被阻止',blocked(resource.frame))
    observations.push({kind:'resource-redirect',loads:resource.loads,started:true,blocked:true});resource.frame.remove()
    for(const path of ['/','/assets/redirect.html']){
      const kind=path==='/'?'instance-to-board':'instance-via-resource'
      const html=`<!doctype html><script>parent.postMessage({type:'escape-started',kind:${JSON.stringify(kind)}},${JSON.stringify(location.origin)});setTimeout(()=>location.assign(${JSON.stringify(location.origin+path)}),100);<\/script>`
      const publication=await loadGeneratedFrame(html);instances.push(publication)
      const state=mount(publication.attributes.src,publication.attributes.sandbox)
      Object.assign(state,{kind,origin:new URL(publication.attributes.src).origin,started:false});attacks.set(kind,state)
      await until(()=>state.started&&state.loads>=2)
      check('随机实例导航后仍取不到画板身份 '+path,blocked(state.frame))
      observations.push({kind,loads:state.loads,started:state.started,blocked:true})
      state.frame.remove();await publication.dispose()
    }
    return {checks,observations}
  }finally{
    removeEventListener('message',receive)
    for(const frame of frames)frame.remove()
    await Promise.all(instances.map(instance=>instance.dispose()))
  }
}
