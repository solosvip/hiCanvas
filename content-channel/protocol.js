import {filmFrameSize,validFilmAudio,validPcm,validVideoSources,filmStageOrder,filmAudioStageOrder} from './film-export-protocol.js'
import {captureSize,validPixels} from './capture-protocol.js'
import {editRevision,validEditState,validEditSnapshot} from './edit-protocol.js'
export const PROTOCOL_VERSION=1
export const MAX_MESSAGE_BYTES=4096
export const MAX_MESSAGES_PER_SECOND=60
export const MAX_REPLY_MESSAGES_PER_SECOND=120
export const MAX_PENDING_REQUESTS=32
export const REQUEST_TIMEOUT=3000
export const CHILD_ASSETS=Object.freeze(['bootstrap.js','child.js','protocol.js','film-controller.js','film-time.js','capture-protocol.js','capture.js','film-export-protocol.js','film-export.js','edit-protocol.js','edit.js'])

const plain=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value))
const exact=(value,keys)=>plain(value)&&Object.keys(value).every(key=>keys.includes(key))
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value)
const finite=value=>typeof value==='number'&&Number.isFinite(value)
export function validCommand(command,value){
  if(['edit-start','edit-snapshot'].includes(command))return value===undefined
  if(command==='edit-stop')return value===undefined||value===false
  if(command==='edit-ack')return editRevision(value)
  if(['play','pause'].includes(command))return value===undefined
  if(command==='seek')return finite(value)&&value>=0&&value<=86400
  if(command==='capture')return captureSize(value)!==null
  if(command==='film-frame')return filmFrameSize(value)!==null
  if(command==='film-audio')return validFilmAudio(value)
  if(command==='mute')return typeof value==='boolean'
  return false
}
export function validStatus(value){
  return exact(value,['duration','currentTime','playing','muted','ready','error'])&&finite(value.duration)&&value.duration>0&&value.duration<=86400&&finite(value.currentTime)&&value.currentTime>=0&&value.currentTime<=value.duration&&['playing','muted','ready'].every(key=>typeof value[key]==='boolean')&&(value.error===undefined||typeof value.error==='string'&&value.error.length<=256)
}
export function validLegacyStatus(value){
  return exact(value,['channel','type','duration','currentTime','playing','muted'])&&value.channel==='cowart-film'&&value.type==='status'&&finite(value.duration)&&value.duration>0&&value.duration<=86400&&finite(value.currentTime)&&value.currentTime>=0&&value.currentTime<=value.duration&&typeof value.playing==='boolean'&&typeof value.muted==='boolean'
}
export function validMessage(value,instance,generation){
  if(!exact(value,['protocol','instance','generation','type','id','command','value','ok','error','options','legacy','frame','stage','media','videoSources']))return false
  if(value.protocol!==PROTOCOL_VERSION||value.instance!==instance||!identifier(value.generation)||generation!==undefined&&value.generation!==generation)return false
  const base=['protocol','instance','generation','type']
  if(value.type==='ready')return exact(value,[...base,'legacy'])&&(value.legacy===undefined||typeof value.legacy==='boolean')
  if(['close','pause','legacy-poll','edit-exit'].includes(value.type))return exact(value,base)
  if(value.type==='legacy-status')return exact(value,[...base,'value'])&&validLegacyStatus(value.value)
  if(value.type==='connect')return exact(value,[...base,'options'])&&exact(value.options,['duration','muted','film'])&&finite(value.options.duration)&&value.options.duration>0&&value.options.duration<=86400&&typeof value.options.muted==='boolean'&&typeof value.options.film==='boolean'
  if(value.type==='request')return exact(value,[...base,'id','command','value'])&&identifier(value.id)&&validCommand(value.command,value.value)
  if(['cancel','capture-end'].includes(value.type))return exact(value,[...base,'id'])&&identifier(value.id)
  if(value.type==='status')return exact(value,[...base,'value'])&&validStatus(value.value)
  if(value.type==='edit-status')return exact(value,[...base,'value'])&&validEditState(value.value)
  if(value.type==='edit-state-result')return exact(value,[...base,'id','value'])&&identifier(value.id)&&validEditState(value.value)
  if(value.type==='edit-snapshot-result')return exact(value,[...base,'id','value'])&&identifier(value.id)&&validEditSnapshot(value.value,instance)
  if(value.type==='film-audio-result')return exact(value,[...base,'id','videoSources','value'])&&identifier(value.id)&&validVideoSources(value.videoSources)&&validPcm(value.value)
  if(value.type==='film-audio-stage')return exact(value,[...base,'id','stage'])&&identifier(value.id)&&filmAudioStageOrder(value.stage)>=0
  if(value.type==='film-stage')return exact(value,[...base,'id','frame','stage','media'])&&identifier(value.id)&&Number.isInteger(value.frame)&&value.frame>=0&&value.frame<3600&&filmStageOrder(value.media===undefined?{stage:value.stage}:{stage:value.stage,media:value.media},64)>=0
  if(value.type==='film-frame-result')return exact(value,[...base,'id','frame','value'])&&identifier(value.id)&&Number.isInteger(value.frame)&&value.frame>=0&&value.frame<3600&&validPixels(value.value)
  if(value.type==='capture-result')return exact(value,[...base,'id','value'])&&identifier(value.id)&&validPixels(value.value)
  if(value.type==='response')return exact(value,[...base,'id','ok','value','error'])&&identifier(value.id)&&typeof value.ok==='boolean'&&(value.ok?value.value===true&&value.error===undefined:typeof value.error==='string'&&value.error.length<=256&&value.value===undefined)
  return false
}
export function messageSize(value){
  // No serialization hooks, functions, DOM objects or unbounded nested payloads.
  let remaining=64
  const visit=(item,depth)=>{
    if(--remaining<0||depth>3)return false
    if(item===undefined||typeof item==='boolean'||typeof item==='string'&&item.length<=MAX_MESSAGE_BYTES||finite(item))return true
    return plain(item)&&Object.keys(item).length<=12&&Object.getOwnPropertyDescriptors(item)&&Object.values(Object.getOwnPropertyDescriptors(item)).every(descriptor=>'value'in descriptor&&visit(descriptor.value,depth+1))
  }
  if(!visit(value,0))return Infinity
  try{return new TextEncoder().encode(JSON.stringify(value)).length}catch{return Infinity}
}
export function createRateLimit(limit=MAX_MESSAGES_PER_SECOND,now=()=>Date.now()){
  let start=now(),count=0
  return ()=>{const time=now();if(time-start>=1000){start=time;count=0}return ++count<=limit}
}
