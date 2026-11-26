import {CAPTURE_TIMEOUT,captureSize} from './capture-protocol.js'
import {PROTOCOL_VERSION,MAX_MESSAGE_BYTES,MAX_PENDING_REQUESTS,MAX_REPLY_MESSAGES_PER_SECOND,REQUEST_TIMEOUT,messageSize,validMessage,validCommand,validLegacyStatus,createRateLimit} from './protocol.js'

const channels=new WeakMap(),pageCaptures=new WeakMap()
export const getContentChannel=iframe=>channels.get(iframe)||null

export function bindContentChannel(iframe,{url,instanceId,duration=15,muted=false,film=false}){
  const host=iframe.ownerDocument.defaultView,target=new URL(url),origin=target.origin
  if(!/^[a-f0-9]{48}$/.test(instanceId)||target.protocol!=='http:'||target.username||target.password||target.hostname!==instanceId+'.localhost'||!target.port)throw new Error('内容实例来源无效。')
  const subscribers=new Set(),pending=new Map(),captureJobs=new Map(),retired=new Map(),invalidators=new Set()
  let session=null,disposed=false,sequence=0,lastStatus=null
  const notify=status=>{lastStatus={...status};for(const subscriber of subscribers)subscriber({...status})}
  const offline=error=>notify({duration,currentTime:0,playing:false,muted,ready:false,error:error.message})
  function closeRetired(active){
    if(active===session||[...captureJobs.values()].includes(active))return
    retired.get(active)?.();retired.delete(active);active.port.close()
  }
  function releaseCapture(id){
    const active=captureJobs.get(id)
    if(!active)return
    captureJobs.delete(id);pageCaptures.set(host,pageCaptures.get(host)-1);closeRetired(active)
  }
  function retire(active){
    if(![...captureJobs.values()].includes(active)){active.port.close();return}
    // Disposing a channel need not remove its iframe. Keep only an end-receipt
    // ingress until the uninterruptible render finishes. A new document load or
    // actual DOM removal also proves the old browsing context has gone away.
    const unloaded=()=>{for(const [id,owner] of captureJobs)if(owner===active)releaseCapture(id)}
    const observer=host.MutationObserver&&host.document?.documentElement?new host.MutationObserver(()=>{if(iframe.isConnected===false)unloaded()}):null
    iframe.addEventListener('load',unloaded,{once:true})
    observer?.observe(host.document.documentElement,{childList:true,subtree:true})
    retired.set(active,()=>{iframe.removeEventListener('load',unloaded);observer?.disconnect()})
    if(iframe.isConnected===false)unloaded()
  }
  function invalidate(error=new Error('内容实例已失效。')){
    const previous=session;session=null
    for(const reset of invalidators)reset()
    if(previous){clearTimeout(previous.timer);previous.reject(error);try{previous.port.postMessage({...previous.base,type:'close'})}catch{/* Detached. */}retire(previous)}
    for(const task of [...pending.values()])task.finish(error,undefined,false)
    if(previous&&!disposed)offline(error)
  }
  function start(){
    if(disposed)return
    invalidate()
    const channel=new (host.MessageChannel||globalThis.MessageChannel)()
    const generation=globalThis.crypto.randomUUID().replaceAll('-','')
    const base={protocol:PROTOCOL_VERSION,instance:instanceId,generation}
    let resolve,reject
    const ready=new Promise((yes,no)=>{resolve=yes;reject=no})
    // A frame may load before a playback consumer subscribes.
    ready.catch(()=>{})
    // Replies also carry status and handshake messages; they need their own
    // allowance so all admitted commands can complete within the request quota.
    const active={port:channel.port1,base,ready,resolve,reject,timer:null,frame:iframe.contentWindow,legacy:false,allowLegacy:createRateLimit(),allowIncoming:createRateLimit(MAX_REPLY_MESSAGES_PER_SECOND),allowOutgoing:createRateLimit()};session=active
    active.timer=setTimeout(()=>{if(session===active)invalidate(new Error('内容通道握手超时。'))},REQUEST_TIMEOUT)
    active.port.onmessage=event=>{
      const data=event.data
      if(!active.allowIncoming())return
      if(session!==active){
        if(data?.type==='capture-end'&&messageSize(data)<=MAX_MESSAGE_BYTES&&validMessage(data,instanceId,generation)&&captureJobs.get(data.id)===active)releaseCapture(data.id)
        else if(data?.value?.pixels instanceof ArrayBuffer)data.value.pixels.transfer?.(0)
        return
      }
      // Binary pixels have a separate strict budget; every other message keeps
      // the 4 KiB ceiling. An invalid matching reply fails explicitly.
      if(data?.type==='capture-result'){
        const task=pending.get(data.id)
        const discard=()=>{if(data.value?.pixels instanceof ArrayBuffer)data.value.pixels.transfer?.(0)}
        if(!task||task.command!=='capture'||data.instance!==instanceId||data.generation!==generation){discard();return}
        if(!validMessage(data,instanceId,generation)||data.value.width!==task.size.width||data.value.height!==task.size.height){discard();task.finish(new Error('截图像素数据无效或超过上限。'));return}
        task.finish(null,data.value);return
      }
      if(messageSize(data)>MAX_MESSAGE_BYTES||!validMessage(data,instanceId,generation))return
      if(data.type==='ready'){clearTimeout(active.timer);active.resolve();if(data.legacy&&!active.legacy){active.legacy=true;active.port.postMessage({...base,type:'legacy-poll'})}return}
      if(data.type==='capture-end'){releaseCapture(data.id);return}
      if(data.type==='close'){invalidate();return}
      if(data.type==='status'){notify(data.value);return}
      if(data.type==='response'){const task=pending.get(data.id);if(task&&(!data.ok||task.command!=='capture'))task.finish(data.ok?null:new Error(data.error),data.value,task.command!=='capture')}
    }
    active.port.onmessageerror=()=>{if(session===active)invalidate()}
    active.port.start()
    try{iframe.contentWindow.postMessage({...base,type:'connect',options:{duration,muted,film}},origin,[channel.port2])}
    catch(error){channel.port2.close();invalidate(error)}
  }
  async function request(command,value,{signal,timeout=command==='capture'?CAPTURE_TIMEOUT:REQUEST_TIMEOUT}={}){
    if(!validCommand(command,value))throw new Error(command==='capture'?'截图参数无效：边长不得超过4096，像素不得超过1600万。':'内容命令或参数无效。')
    signal?.throwIfAborted()
    const active=session
    if(disposed||!active)throw new Error('内容实例已失效。')
    await new Promise((resolve,reject)=>{
      const aborted=()=>{cleanup();reject(signal.reason||new DOMException('已取消。','AbortError'))}
      const cleanup=()=>signal?.removeEventListener('abort',aborted)
      signal?.addEventListener('abort',aborted,{once:true})
      active.ready.then(()=>{cleanup();resolve()},error=>{cleanup();reject(error)})
    })
    signal?.throwIfAborted()
    if(session!==active)throw new Error('内容实例已失效。')
    const capturing=command==='capture'
    if(capturing&&(captureJobs.size>0||(pageCaptures.get(host)||0)>=2)){const error=new Error('截图忙，请稍后重试。');error.code='CHANNEL_BUSY';throw error}
    if(pending.size>=MAX_PENDING_REQUESTS||!active.allowOutgoing()){const error=new Error('内容请求过于频繁。');error.code='CHANNEL_BUSY';throw error}
    if(!Number.isFinite(timeout)||timeout<=0||timeout>(capturing?CAPTURE_TIMEOUT:REQUEST_TIMEOUT))throw new Error('内容请求超时设置无效。')
    const id='p'+(++sequence),message={...active.base,type:'request',id,command,...value!==undefined?{value}:{}}
    if(capturing){captureJobs.set(id,active);pageCaptures.set(host,(pageCaptures.get(host)||0)+1)}
    return new Promise((resolve,reject)=>{
      let timer
      const cancel=()=>{try{active.port.postMessage({...active.base,type:'cancel',id})}catch{/* Detached. */}}
      const abort=()=>{cancel();finish(signal.reason||new DOMException('已取消。','AbortError'),undefined,false)}
      function finish(error,result,ended=true){if(!pending.delete(id))return;if(capturing&&ended)releaseCapture(id);clearTimeout(timer);signal?.removeEventListener('abort',abort);if(!error&&command==='mute')muted=value;error?reject(error):resolve(result)}
      pending.set(id,{finish,command,size:capturing?captureSize(value):null})
      signal?.addEventListener('abort',abort,{once:true})
      timer=setTimeout(()=>{cancel();finish(new Error('内容请求超时。'),undefined,false)},timeout)
      try{active.port.postMessage(message)}catch(error){finish(error)}
    })
  }
  const loaded=()=>{
    // A real load proves all previous document contexts were destroyed, even
    // when navigation was initiated inside the child without a src mutation.
    const previous=[...captureJobs.keys()]
    start()
    for(const id of previous)releaseCapture(id)
  }
  const pagehide=()=>invalidate()
  // Compatibility only: accept old cowart-film status, never window commands.
  // The UI still consumes only validated Port status. Revisit this at #118.
  // Reload closes this ingress until the new Port handshake. WindowProxy stays
  // identical across same-origin reloads, however: old status queued until AFTER
  // that handshake has no generation field and may briefly affect the display.
  // Port traffic itself always carries the fresh generation and rejects old data.
  const legacyStatus=event=>{
    const active=session
    if(!active?.legacy||event.source!==active.frame||event.origin!==origin||!active.allowLegacy()||messageSize(event.data)>MAX_MESSAGE_BYTES||!validLegacyStatus(event.data))return
    active.port.postMessage({...active.base,type:'legacy-status',value:event.data})
  }
  iframe.addEventListener('load',loaded)
  host.addEventListener('pagehide',pagehide)
  host.addEventListener('message',legacyStatus)
  const observer=host.MutationObserver?new host.MutationObserver(()=>invalidate()):null
  observer?.observe(iframe,{attributes:true,attributeFilter:['src','srcdoc']})
  start()
  const api={request,subscribe(listener){subscribers.add(listener);if(lastStatus)listener({...lastStatus});return ()=>subscribers.delete(listener)},
    attachFilmController({onStatus=()=>{}}={}){
      const unsubscribe=this.subscribe(onStatus)
      let stopped=false,seekTimer=null,queuedSeek,lastSeekAt=-Infinity
      const resetSeek=()=>{clearTimeout(seekTimer);seekTimer=null;queuedSeek=undefined;lastSeekAt=-Infinity}
      invalidators.add(resetSeek)
      const send=(name,value)=>void request(name,value).catch(error=>{
        if(stopped||disposed)return
        if(error.code==='CHANNEL_BUSY'){if(lastStatus)notify({...lastStatus,error:error.message});return}
        offline(error)
      })
      const flushSeek=()=>{clearTimeout(seekTimer);seekTimer=null;if(stopped||queuedSeek===undefined)return;const value=queuedSeek;queuedSeek=undefined;lastSeekAt=Date.now();send('seek',value)}
      return {command(name,value){
        if(stopped||name==='capture'||!validCommand(name,value)||disposed)return false
        if(name==='seek'){
          queuedSeek=value
          if(seekTimer===null){const delay=Math.max(0,50-(Date.now()-lastSeekAt));if(delay)seekTimer=setTimeout(flushSeek,delay);else flushSeek()}
        }else{flushSeek();send(name,value)}
        return true
      },dispose(){
        if(stopped)return
        stopped=true;resetSeek();invalidators.delete(resetSeek);unsubscribe()
        // Idempotent playback cleanup, like close/cancel, must survive a full
        // business quota. It carries no arbitrary command or payload.
        if(!disposed&&session)try{session.port.postMessage({...session.base,type:'pause'})}catch{/* Detached. */}
      }}
    },
    dispose(){if(disposed)return;disposed=true;if(channels.get(iframe)===api)channels.delete(iframe);iframe.removeEventListener('load',loaded);host.removeEventListener('pagehide',pagehide);host.removeEventListener('message',legacyStatus);observer?.disconnect();invalidate();subscribers.clear()},
  }
  channels.set(iframe,api)
  return api
}
