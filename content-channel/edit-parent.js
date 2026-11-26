import {getContentChannel} from './parent.js'

export async function createContentEditorSession(iframe,{onSave,onState=()=>{},onRequestExit=()=>{},onError=error=>console.error(error)}){
  const channel=getContentChannel(iframe)
  if(!channel)throw new Error('网页编辑通道尚未就绪，请稍后重试。')
  let stopped=false,flight=null,finishing=null,terminalError=null,exiting=false
  const unsubscribe=channel.subscribeEditing(event=>{
    if(event.error){terminalError=event.error;unsubscribe()}
    if(typeof event.dirty==='boolean')onState(event)
    if(event.exitRequested&&!exiting&&!stopped){exiting=true;Promise.resolve().then(()=>onRequestExit()).catch(onError).finally(()=>{exiting=false})}
  })
  try{onState(await channel.request('edit-start'))}catch(error){unsubscribe();void channel.request('edit-stop',false).catch(()=>{});throw error}
  const guard=()=>{if(terminalError)throw terminalError;if(stopped)throw new Error('网页编辑已结束。')}
  function flush(){
    if(flight)return flight
    flight=(async()=>{
      guard()
      let result=null
      while(true){
        const snapshot=await channel.request('edit-snapshot')
        onState({revision:snapshot.revision,savedRevision:snapshot.savedRevision,dirty:snapshot.revision>snapshot.savedRevision})
        if(snapshot.revision===snapshot.savedRevision)return result
        // No HTML parser/DOM insertion in the parent realm: even inert parsing
        // may initiate resource requests using that realm's authority.
        const html=snapshot.html
        snapshot.html=''
        result=await onSave(html)
        guard()
        const state=await channel.request('edit-ack',snapshot.revision)
        onState(state)
        if(!state.dirty)return result
      }
    })().finally(()=>{flight=null})
    return flight
  }
  function dispose({save=true}={}){
    if(finishing)return finishing
    if(stopped)return Promise.resolve(null)
    if(terminalError&&!save){stopped=true;unsubscribe();return Promise.resolve(null)}
    finishing=(async()=>{
      let result=null
      if(save){
        while(true){
          result=await flush()
          // Atomic stop refuses to remove listeners if input arrived between
          // the final acknowledgement and this request. Drain that version too.
          const state=await channel.request('edit-stop');onState(state)
          if(!state.dirty)break
        }
      }else await channel.request('edit-stop',false)
      stopped=true;unsubscribe();return result
    })().catch(error=>{finishing=null;throw error})
    return finishing
  }
  return {flush,finish:()=>dispose(),dispose}
}
