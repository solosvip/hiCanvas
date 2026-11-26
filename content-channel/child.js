import {installSlideNavigation} from './slides.js'
import {releaseBinary,filmAudioStepBudget} from './film-export-protocol.js'
import {CAPTURE_TIMEOUT} from './capture-protocol.js'
import {editCommand,largeResultCommand,releaseEditSnapshot} from './edit-protocol.js'
import {attachCowartFilmController} from './film-controller.js'
import {PROTOCOL_VERSION,MAX_MESSAGE_BYTES,messageSize,validMessage,createRateLimit} from './protocol.js'

// This code runs in the content realm. It never receives a parent object or a
// callable capability over the wire; CowartFilm and DOM stay in this realm.
export function installContentChild(host,{instanceId,parentOrigin}){
  let current=null,disposed=false,capturing=false
  const allowConnect=createRateLimit()
  function disconnect(){
    const session=current
    if(!session)return
    current=null;clearTimeout(session.statusTimer);clearTimeout(session.editTimer);clearInterval(session.legacyTimer)
    session.stopSlides?.();session.editAbort.abort();session.editController?.dispose()
    for(const task of session.pending.values())task.abort?.abort()
    session.pending.clear();session.controller?.dispose();session.filmExport?.disposeFilmExport(host)
    try{session.port.postMessage({...session.base,type:'close'})}catch{/* Port already detached. */}
    if(!session.captures)session.port.close()
  }
  function connect(event){
    const data=event.data
    if(disposed||event.source!==host.parent||event.origin!==parentOrigin||!allowConnect()||messageSize(data)>MAX_MESSAGE_BYTES||!validMessage(data,instanceId)||data.type!=='connect'||event.ports?.length!==1)return
    disconnect()
    const port=event.ports[0],base={protocol:PROTOCOL_VERSION,instance:instanceId,generation:data.generation}
    const session={port,base,pending:new Map(),statusTimer:null,editTimer:null,editAbort:new AbortController(),legacyTimer:null,lastStatusAt:-Infinity,controller:null,status:null,legacy:false,receiveLegacy:null,captures:0}
    current=session
    const allow=createRateLimit(),allowLegacy=createRateLimit(),allowPoll=createRateLimit(1)
    const post=message=>{if(current===session)port.postMessage({...base,...message})}
    const publish=status=>{
      if(current!==session)return
      const duration=Math.min(86400,status.duration)
      session.status={duration,currentTime:Math.min(duration,status.currentTime),playing:status.playing,muted:status.muted,ready:status.ready,...status.error?{error:String(status.error).slice(0,256)}:{}}
      if(session.statusTimer!==null)return
      session.statusTimer=setTimeout(()=>{
        session.statusTimer=null;session.lastStatusAt=Date.now()
        post({type:'status',value:session.status})
      },Math.max(0,100-(Date.now()-session.lastStatusAt)))
    }
    const publishEdit=state=>{
      session.editState=state
      if(current!==session||session.editTimer!==null)return
      session.editTimer=setTimeout(()=>{session.editTimer=null;post({type:'edit-status',value:session.editState})},100)
    }
    async function editing(command,value){
      if(!session.editController){
        if(command!=='edit-start'&&!session.editStarting)throw new Error('网页编辑尚未开始。')
        session.editStarting ||= import('./edit.js').then(module=>module.createContentEditController(host,{instanceId,parentOrigin,onChange:publishEdit,onRequestExit:()=>post({type:'edit-exit'}),signal:session.editAbort.signal})).then(controller=>{
          if(current!==session){controller.dispose();throw new Error('内容实例已失效。')}
          return session.editController=controller
        }).catch(error=>{session.editStarting=null;throw error})
        await session.editStarting
      }
      if(current!==session)throw new Error('内容实例已失效。')
      return session.editController.command(command,value)
    }
    port.onmessage=event=>{
      const message=event.data
      if(current!==session||messageSize(message)>MAX_MESSAGE_BYTES||!validMessage(message,instanceId,data.generation))return
      if(message.type==='close'){disconnect();return}
      if(message.type==='cancel'){session.pending.get(message.id)?.abort?.abort();session.pending.delete(message.id);return}
      if(message.type==='pause'){session.controller?.command('pause');return}
      if(message.type==='legacy-status'){if(session.legacy&&allowLegacy())session.receiveLegacy?.(message.value);return}
      if(message.type==='legacy-poll'){if(session.legacy&&allowPoll())messageTransport.post('status');return}
      if(!allow())return
      if(message.type!=='request'||session.pending.has(message.id))return
      if(largeResultCommand(message.command)){
        if(capturing){post({type:'response',id:message.id,ok:false,error:'截图忙，请稍后重试。'});post({type:'capture-end',id:message.id});return}
        capturing=true;session.captures++
        const task={abort:new AbortController()};session.pending.set(message.id,task)
        let timer,stopStep=()=>{}
        const expire=()=>{
          if(!task.abort.signal.aborted){post({type:'response',id:message.id,ok:false,error:'内容导出步骤超时。'});task.abort.abort()}
        }
        const reportStage=(stage,media)=>{
          clearTimeout(timer);stopStep()
          const audio=message.command==='film-audio',timeout=session.exportTimeout||15000
          stopStep=session.filmExport.armDeadline(expire,audio?filmAudioStepBudget(stage,timeout):timeout)
          post(audio?{type:'film-audio-stage',id:message.id,stage}:{type:'film-stage',id:message.id,frame:message.value.index,stage,...media===undefined?{}:{media}})
        }
        if(message.command==='capture'||message.command==='edit-snapshot')timer=setTimeout(expire,message.command==='capture'?CAPTURE_TIMEOUT:3000)
        if(message.command==='film-audio'){
          session.exportTimeout=message.value.taskTimeout||15000
          timer=setTimeout(expire,session.exportTimeout)
        }
        const rendering=message.command==='edit-snapshot'?editing(message.command,message.value):message.command==='capture'?import('./capture.js').then(({captureDocument})=>captureDocument(host,message.value,task.abort.signal)):
          import('./film-export.js').then(module=>{session.filmExport=module;task.abort.signal.throwIfAborted();return module.renderFilmExport(host,message.command,message.value,task.abort.signal,reportStage)})
        rendering.then(value=>{
          if(current!==session||task.abort.signal.aborted||session.pending.get(message.id)!==task){releaseBinary(value);releaseEditSnapshot(value);return}
          if(message.command==='edit-snapshot'){post({type:'edit-snapshot-result',id:message.id,value});return}
          const audio=message.command==='film-audio'
          const videoSources=value.videoSources
          if(audio)delete value.videoSources
          const type=audio?'film-audio-result':message.command==='film-frame'?'film-frame-result':'capture-result'
          try{port.postMessage({...base,type,id:message.id,...type==='film-frame-result'?{frame:message.value.index}:audio?{videoSources}:{},value},audio?value.channels:[value.pixels])}catch{disconnect()}
        },error=>{
          if(current===session&&!task.abort.signal.aborted&&session.pending.get(message.id)===task)post({type:'response',id:message.id,ok:false,error:String(error.message||error).slice(0,256)})
        }).finally(()=>{
          clearTimeout(timer);stopStep();if(session.pending.get(message.id)===task)session.pending.delete(message.id)
          capturing=false;session.captures--
          // Retired sessions send only this receipt. No old pixels or status can
          // cross back after close; the parent keeps its memory lease until here.
          try{port.postMessage({...base,type:'capture-end',id:message.id})}catch{/* Detached. */}
          if(current!==session&&!session.captures)port.close()
        })
        return
      }
      // The list is validated by protocol.js before any film code is called.
      const task={};session.pending.set(message.id,task)
      Promise.resolve().then(()=>{
        if(current!==session||session.pending.get(message.id)!==task)return
        return editCommand(message.command)?editing(message.command,message.value):session.controller?.command(message.command,message.value)
      }).then(result=>{
        if(current!==session||session.pending.get(message.id)!==task)return
        session.pending.delete(message.id)
        post(editCommand(message.command)?{type:'edit-state-result',id:message.id,value:result}:result===true?{type:'response',id:message.id,ok:true,value:true}:{type:'response',id:message.id,ok:false,error:'影片尚未就绪或命令失败。'})
      },error=>{
        if(current!==session||session.pending.get(message.id)!==task)return
        session.pending.delete(message.id);post({type:'response',id:message.id,ok:false,error:String(error.message||error).slice(0,256)})
      })
    }
    port.onmessageerror=()=>{if(current===session)disconnect()}
    port.start()
    if(data.options.slides)session.stopSlides=installSlideNavigation(host,value=>{if(allow())post({type:'slide-nav',value})})
    // Only old cowart-film message films use this compatibility entry. New
    // content uses Port. #118 must review this sole remaining window ingress.
    const messageTransport={
      post(command,value){
        if(!session.legacy){
          session.legacy=true
          // Always refresh paused films too: a delayed old status may say they
          // are playing. Status alone never drives playback or end-of-film seek.
          session.legacyTimer=setInterval(()=>messageTransport.post('status'),100)
        }
        host.dispatchEvent(new host.MessageEvent('message',{source:host.parent,origin:parentOrigin,data:{channel:'cowart-film',type:'command',command,...value!==undefined?{value}:{}}}))
      },
      subscribe(listener){session.receiveLegacy=listener;return ()=>{session.receiveLegacy=null}},
    }
    if(data.options.film)session.controller=attachCowartFilmController({contentWindow:host,contentDocument:host.document,ownerDocument:{defaultView:host}},{...data.options,onStatus:publish,messageTransport})
    post({type:'ready',legacy:session.legacy})
  }
  const unload=()=>disconnect()
  host.addEventListener('message',connect)
  host.addEventListener('pagehide',unload)
  return {dispose(){if(disposed)return;disposed=true;disconnect();host.removeEventListener('message',connect);host.removeEventListener('pagehide',unload)}}
}
