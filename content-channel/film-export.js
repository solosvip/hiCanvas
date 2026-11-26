import {waitForFilmAPI,seekFilmFrame,prepareFilmAssets} from './film-frame-ready.js'
export {armDeadline} from './film-deadline.js'
import {createFilmVideoFrames} from './film-video-frames.js'
import {captureDocument} from './capture.js'
import {COWART_FILM_FPS} from './film-time.js'
import {validPcm,PCM_RATES,MAX_PCM_BYTES} from './film-export-protocol.js'

const sessions=new WeakMap()
export function disposeFilmExport(host){
  const session=sessions.get(host)
  if(!session)return
  sessions.delete(host);session.disposed=true;session.videos?.dispose()
  try{Promise.resolve(session.film?.pause()).catch(()=>{})}catch{/* Unloaded film. */}
  host.__cowartDisposeExport?.()
}
export async function renderFilmExport(host,command,value,signal,reportStage){
  const options={signal,timeout:sessions.get(host)?.taskTimeout||value.taskTimeout||15000,onStage:reportStage}
  let session=sessions.get(host)
  const check=()=>{signal.throwIfAborted();if(session?.disposed)throw new Error('影片导出实例已失效。')}
  if(command==='film-audio'){
    if(session)throw new Error('影片导出音轨已初始化，请重新开始导出。')
    session={disposed:false,nextFrame:0,duration:value.duration,taskTimeout:options.timeout};sessions.set(host,session)
    reportStage?.('assets')
    await prepareFilmAssets(host.document,options)
    reportStage?.('api')
    const film=await waitForFilmAPI(host,options);session.film=film;check()
    if(!Number.isFinite(film.duration)||Math.abs(film.duration-value.duration)>.000001||typeof host.__cowartSetExportTime!=='function')throw new Error('影片导出接口或时长无效。')
    session.videoSources=Array.from(host.document.querySelectorAll('video'))
    // The old exporter had no source-count cap. Bound the declared set at 64,
    // once per export; later inserted, undeclared videos fail explicitly.
    if(session.videoSources.length>64)throw new Error('影片视频源超过64个上限。')
    reportStage?.('pause')
    await film.pause();check();host.__cowartSetExportTime(0)
    // These renderers cannot be aborted. The child keeps its shared large-result
    // lease until the actual promise settles, then discards on cancellation.
    reportStage?.('render-audio')
    const audio=await (typeof film.renderAudio==='function'?film.renderAudio({sampleRate:48000,numberOfChannels:2}):host.__cowartRenderLegacyAudio(film))
    check()
    if(!audio?.getChannelData||!PCM_RATES.includes(audio.sampleRate)||![1,2].includes(audio.numberOfChannels)||!Number.isInteger(audio.length)||audio.length<=0||audio.length>120*audio.sampleRate||audio.length*audio.numberOfChannels*4>MAX_PCM_BYTES||Math.abs(audio.duration-value.duration)>.05)throw new Error('影片音轨无效或超过PCM上限。')
    reportStage?.('pause-after');await film.pause();check()
    reportStage?.('mute');await film.setMuted(true);check()
    const result={sampleRate:audio.sampleRate,numberOfChannels:audio.numberOfChannels,length:audio.length,channels:Array.from({length:audio.numberOfChannels},(_,index)=>new Float32Array(audio.getChannelData(index)).buffer)}
    if(!validPcm(result))throw new Error('影片音轨包含无效采样。')
    session.ready=true
    return{...result,videoSources:session.videoSources.length}
  }
  check()
  if(!session?.ready||value.index!==session.nextFrame||value.index>=Math.ceil(session.duration*COWART_FILM_FPS))throw new Error('影片帧号无效或顺序不一致。')
  await seekFilmFrame({contentWindow:host,contentDocument:host.document},session.film,value.index/COWART_FILM_FPS,options)
  check()
  session.videos ||= createFilmVideoFrames({...options,pixelRatio:value.pixelRatio})
  const videoFrames=await session.videos.render(host.document,{...options,mediaIndex(video){
    const index=session.videoSources.indexOf(video)
    if(index<0)throw new Error('影片出现未报定的视频源，请重新导出。')
    return index
  }})
  try{
    check()
    const {index,...size}=value
    reportStage?.('capture')
    const result=await captureDocument(host,size,signal,{film:true,videoFrames})
    check();session.nextFrame++
    return result
  }finally{for(const canvas of videoFrames.values())canvas.width=canvas.height=0}
}
