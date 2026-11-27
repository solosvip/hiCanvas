// Shared loading interface for generated content. Storage URLs and HTML stay unchanged.
import {bindContentChannel,isolatedContentSandbox} from '../content-channel/index.js'
const startupByFetcher=new WeakMap()
function readStartup(fetcher){
  if(!startupByFetcher.has(fetcher))startupByFetcher.set(fetcher,(async()=>{
    // A mount's cancellation must not cancel other mounts' page-wide startup.
    const health=await fetcher('/api/health',{credentials:'same-origin',mode:'same-origin',redirect:'error',signal:AbortSignal.timeout(15000)})
    if(!health.ok)throw new Error('无法读取内容宿主启动信息。')
    const startup=await health.json()
    if(!Number.isInteger(startup.contentHost?.port)||startup.contentHost.port<1||startup.contentHost.port>65535)throw new Error('内容宿主尚未就绪，无法加载生成网页。')
    return startup
  })())
  return startupByFetcher.get(fetcher)
}
export async function loadGeneratedFrame(html,{sourceUrl,conversationId,directUrl,originalHtml,signal,fetcher=globalThis.fetch}={}) {
  const startup=await readStartup(fetcher)
  signal?.throwIfAborted()
  if(originalHtml!==undefined)html=originalHtml
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
  let sandbox
  try{sandbox=isolatedContentSandbox(instance.url,{port:startup.contentHost.port,parentOrigin:globalThis.location?.origin})}catch(error){await release();throw error}
  timer=setInterval(()=>{void request('PUT',{id:instance.id,revokeToken:instance.revokeToken}).catch(release)},Math.max(1000,instance.leaseMs/2))
  globalThis.addEventListener?.('pagehide',release,{once:true})
  if(signal?.aborted){release();signal.throwIfAborted()}
  return {attributes:{src:instance.url,sandbox},dispose:release,
    get disposed(){return disposed},
    bind(iframe,options={}){
      if(disposed)throw new Error('内容实例已失效。')
      if(boundIframe!==iframe){channel?.dispose();boundIframe=iframe;channel=bindContentChannel(iframe,{url:instance.url,instanceId:instance.id,...options})}
      return channel
    },
  }
}
