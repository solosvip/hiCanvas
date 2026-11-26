import {createRateLimit,MAX_REPLY_MESSAGES_PER_SECOND,messageSize} from './protocol.js'
import {createSlideGate,installSlideNavigation} from './slides.js'
import {contentSandbox} from './content-policy.js'

function valid(message,generation){
  if(messageSize(message)>4096||message?.version!==1||message.generation!==generation||Object.keys(message).some(key=>!['version','generation','type','value'].includes(key)))return false
  return message.type==='ready'&&message.value===undefined||message.type==='slide-nav'&&['next','previous'].includes(message.value)
}
function installChild(host){
  let current,stop=()=>{}
  const allowConnect=createRateLimit()
  const connect=event=>{
    const data=event.data
    if(event.source!==host.parent||event.origin!=='null'||!allowConnect()||messageSize(data)>4096||data?.type!=='hicanvas-slides-connect'||data.version!==1||!/^[a-f0-9]{32}$/.test(data.generation)||Object.keys(data).length!==3||event.ports.length!==1)return
    stop();current?.close();current=event.ports[0]
    const port=current,base={version:1,generation:data.generation},allow=createRateLimit()
    stop=installSlideNavigation(host,value=>{if(current===port&&allow())port.postMessage({...base,type:'slide-nav',value})},'offline')
    port.start();port.postMessage({...base,type:'ready'})
  }
  host.addEventListener('message',connect)
  host.addEventListener('pagehide',()=>{stop();current?.close();current=null;host.removeEventListener('message',connect)},{once:true})
}
function player(host,{pages}){
  const document=host.document,frame=document.getElementById('slide'),count=document.getElementById('count'),prev=document.getElementById('prev'),next=document.getElementById('next')
  let index=-1,session
  frame.setAttribute('sandbox',contentSandbox())
  const go=direction=>show(index+(direction==='previous'?-1:1))
  function show(value){
    value=Math.max(0,Math.min(pages.length-1,value))
    if(value===index)return false
    session?.port.close();session=null;index=value
    frame.src=pages[index];count.textContent=(index+1)+' / '+pages.length;prev.disabled=index===0;next.disabled=index===pages.length-1
    return true
  }
  frame.addEventListener('load',()=>{
    session?.port.close()
    const channel=new host.MessageChannel(),generation=host.crypto.randomUUID().replaceAll('-',''),active={port:channel.port1,ready:false}
    session=active
    const allow=createRateLimit(MAX_REPLY_MESSAGES_PER_SECOND),accept=createSlideGate(go)
    active.port.onmessage=event=>{
      if(session!==active||!allow()||!valid(event.data,generation))return
      if(event.data.type==='ready'){active.ready=true;return}
      if(active.ready)accept(event.data.value)
    }
    active.port.start()
    // An opaque file child has no targetable origin. Source is the exact frame;
    // this fresh Port is the only parent ingress, retired before every reload.
    frame.contentWindow.postMessage({type:'hicanvas-slides-connect',version:1,generation},'*',[channel.port2])
  })
  const key=event=>{if(event.key==='ArrowLeft'){event.preventDefault();go('previous')}else if(event.key==='ArrowRight'||event.key===' '){event.preventDefault();go('next')}}
  document.getElementById('stage').addEventListener('click',()=>go('next'))
  document.getElementById('controls').addEventListener('click',event=>event.stopPropagation())
  prev.onclick=()=>go('previous');next.onclick=()=>go('next');host.addEventListener('keydown',key)
  host.addEventListener('pagehide',()=>{session?.port.close();session=null},{once:true})
  show(0)
}
if(globalThis.parent!==globalThis)installChild(globalThis)
else globalThis.hiCanvasOfflineSlides=options=>player(globalThis,options)
