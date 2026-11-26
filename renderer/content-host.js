// Shared loading interface for generated content. Storage URLs and HTML stay unchanged.
import {bindContentChannel} from '../content-channel/index.js'
const startupByFetcher=new WeakMap()
function readStartup(fetcher){
  if(!startupByFetcher.has(fetcher))startupByFetcher.set(fetcher,(async()=>{
    // A mount's cancellation must not cancel other mounts' page-wide startup.
    const health=await fetcher('/api/health',{credentials:'same-origin',mode:'same-origin',redirect:'error',signal:AbortSignal.timeout(15000)})
    if([404,405].includes(health.status))return {}
    if(!health.ok)throw new Error('无法读取内容宿主启动信息。')
    return health.json()
  })())
  return startupByFetcher.get(fetcher)
}
export async function loadGeneratedFrame(html,{sourceUrl,conversationId,directUrl,signal,fetcher=globalThis.fetch}={}) {
  const legacy={attributes:directUrl?{src:directUrl}:{srcDoc:html},dispose(){}}
  const startup=await readStartup(fetcher)
  signal?.throwIfAborted()
  // Read-only galleries and older hosts have no feature descriptor.
  if(startup.contentHost?.enabled!==true)return legacy
  if(directUrl){
    if(!/^data:text\/html(?:;[^,]*)?,/i.test(directUrl))throw new Error('内联网页来源无效。')
    html=await(await fetcher(directUrl,{signal})).text()
  }
  const sourcePath=sourceUrl&&new URL(sourceUrl,'http://cowart.local').pathname
  conversationId ||= sourcePath?.match(/^\/c\/([^/]+)\//)?.[1] || (sourcePath?'legacy':new URLSearchParams(globalThis.location?.search).get('conversation')) || 'legacy'
  const endpoint='/api/content-host/instances'
  async function request(method,body,keepalive=false){
    const response=await fetcher(endpoint,{method,credentials:'same-origin',mode:'same-origin',redirect:'error',headers:{'content-type':'application/json','x-hicanvas-client':'1'},body:JSON.stringify(body),keepalive,signal:keepalive?undefined:AbortSignal.timeout(15000)})
    if(!response.ok)throw new Error(`内容实例请求失败：${response.status}`)
    return response.json()
  }
  // Complete registration even if the mount is cancelled, so its capability can be revoked.
  const instance=await request('POST',{html,sourceUrl,conversationId})
  let disposed=false,disposal
  let timer,channel,boundIframe
  const release=()=>{
    if(disposed)return disposal
    disposed=true;clearInterval(timer)
    channel?.dispose()
    globalThis.removeEventListener?.('pagehide',release)
    return disposal=request('DELETE',{id:instance.id,revokeToken:instance.revokeToken},true).catch(()=>{})
  }
  let origin
  try{origin=new URL(instance.url)}catch{await release();throw new Error('内容宿主来源无效。')}
  if(origin.protocol!=='http:'||origin.username||origin.password||!/^([a-f0-9]{48})\.localhost$/.test(origin.hostname)||Number(origin.port)!==startup.contentHost.port){await release();throw new Error('内容宿主来源无效。')}
  timer=setInterval(()=>{void request('PUT',{id:instance.id,revokeToken:instance.revokeToken}).catch(release)},Math.max(1000,instance.leaseMs/2))
  globalThis.addEventListener?.('pagehide',release,{once:true})
  if(signal?.aborted){release();signal.throwIfAborted()}
  return {attributes:{src:instance.url},dispose:release,
    bind(iframe,options={}){
      if(disposed)throw new Error('内容实例已失效。')
      if(boundIframe!==iframe){channel?.dispose();boundIframe=iframe;channel=bindContentChannel(iframe,{url:instance.url,instanceId:instance.id,...options})}
      return channel
    },
  }
}
