import {COWART_FILM_FPS} from './film-time.js'
import {captureSize} from './capture-protocol.js'
const exact=(value,keys)=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))
export function filmFrameSize(value){
  if(!exact(value,['index','width','height','pixelRatio'])||!Number.isInteger(value.index)||value.index<0||value.index>=120*COWART_FILM_FPS)return null
  return captureSize({width:value.width,height:value.height,pixelRatio:value.pixelRatio})
}
export const binaryCommand=command=>['capture','film-frame','film-audio'].includes(command)
// Existing export duration (120s), 48kHz maximum and stereo Float32 PCM.
export const MAX_PCM_BYTES=120*48000*2*4
export const PCM_RATES=Object.freeze([8000,11025,16000,22050,24000,32000,44100,48000])
export const validFilmAudio=value=>(exact(value,['duration'])||exact(value,['duration','taskTimeout']))&&(value.taskTimeout===undefined||validFilmTimeout(value.taskTimeout))&&Number.isFinite(value.duration)&&value.duration>0&&value.duration<=120
export function validPcm(value){
  if(!exact(value,['sampleRate','numberOfChannels','length','channels'])||!PCM_RATES.includes(value.sampleRate)||![1,2].includes(value.numberOfChannels)||!Number.isInteger(value.length)||value.length<=0||value.length>120*value.sampleRate||value.length*value.numberOfChannels*4>MAX_PCM_BYTES||!Array.isArray(value.channels)||value.channels.length!==value.numberOfChannels||new Set(value.channels).size!==value.numberOfChannels)return false
  if(!value.channels.every(buffer=>buffer instanceof ArrayBuffer&&buffer.byteLength===value.length*4))return false
  return value.channels.every(buffer=>new Float32Array(buffer).every(Number.isFinite))
}
export function releaseBinary(value){
  const buffers=[value?.pixels,...Array.isArray(value?.channels)?value.channels:[]]
  for(const buffer of new Set(buffers))if(buffer instanceof ArrayBuffer)buffer.transfer?.(0)
}
export const MAX_FILM_TASK_TIMEOUT=2147483647
export const validFilmTimeout=value=>Number.isFinite(value)&&value>0&&value<=MAX_FILM_TASK_TIMEOUT
export const validVideoSources=value=>Number.isInteger(value)&&value>=0&&value<=64
export function filmStageOrder(value,sources){
  if(!exact(value,value.media===undefined?['stage']:['stage','media']))return -1
  if(['seek','paint','assets'].includes(value.stage)&&value.media===undefined)return ['seek','paint','assets'].indexOf(value.stage)
  if(value.stage==='capture'&&value.media===undefined)return 3+2*sources
  if(['video-source','video-decode'].includes(value.stage)&&Number.isInteger(value.media)&&value.media>=0&&value.media<sources)return 3+2*value.media+(value.stage==='video-decode'?1:0)
  return -1
}
// Old seek/paint/assets/capture each have their own timeout, and each video
// separately prepares its source and decodes a frame. A source count is declared
// once (max 64 because the old renderer had no count cap). Progress never moves
// this absolute deadline: (4 + 2 * sources) * taskTimeout.
export const filmFrameBudget=(sources,timeout)=>(4+2*sources)*timeout
export const FILM_AUDIO_STAGES=Object.freeze(['assets','api','pause','render-audio','pause-after','mute'])
export const filmAudioStageOrder=stage=>FILM_AUDIO_STAGES.indexOf(stage)
// API discovery and film.ready each have one old timeout; the other five
// stages have one apiece. Legal progress cannot extend this fixed 7T deadline.
export const filmAudioBudget=timeout=>7*timeout
export const filmAudioStepBudget=(stage,timeout)=>(stage==='api'?2:1)*timeout
