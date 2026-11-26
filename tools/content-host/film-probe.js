import {ALL_FORMATS,AudioBufferSource,BlobSource,Input,Output,VideoSampleSink} from 'mediabunny'
import {renderCowartFilmMp4} from '../../src/filmExport.js'
import {filmFixture,faultFilm,delayedFilm,delayedAudioFilm,legacyAudioFilm} from './film-fixture.js'

const asData=blob=>new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)})
function bytesBase64(values){let text='';const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength);for(let index=0;index<bytes.length;index+=4096)text+=String.fromCharCode(...bytes.subarray(index,index+4096));return btoa(text)}
window.startFilmPreview=async({font,enabled})=>{
  const checks=[],artifacts={},html=await filmFixture(font)
  const check=(name,value)=>{checks.push({name,pass:!!value});if(!value)throw new Error(name)}
  let pcm,cancels=0
  const add=AudioBufferSource.prototype.add,cancel=Output.prototype.cancel
  AudioBufferSource.prototype.add=function(buffer){pcm=Array.from({length:buffer.numberOfChannels},(_,index)=>bytesBase64(buffer.getChannelData(index)));return add.call(this,buffer)}
  Output.prototype.cancel=async function(){await cancel.call(this);check('失败的真实编码器进入canceled状态',this.state==='canceled');cancels++}
  const controls={
    async render(){
      const started=performance.now()
      const blob=await renderCowartFilmMp4({html,width:160,height:90,duration:1})
      artifacts.elapsed=performance.now()-started;artifacts.mp4=await asData(blob);artifacts.pcm=pcm
      check('真实编码返回MP4文件',blob.type==='video/mp4'&&blob.size>1000)
      const input=new Input({source:new BlobSource(blob),formats:ALL_FORMATS})
      try{
        const track=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack(),frames=[]
        check('MP4同时包含视频和音频轨道',!!track&&!!audio)
        for await(const sample of new VideoSampleSink(track).samples()){
          try{const canvas=document.createElement('canvas');canvas.width=sample.displayWidth;canvas.height=sample.displayHeight;sample.draw(canvas.getContext('2d'),0,0,canvas.width,canvas.height);frames.push({time:sample.timestamp,png:canvas.toDataURL()});canvas.width=canvas.height=0}finally{sample.close()}
        }
        check('MP4完整解码30帧',frames.length===30);artifacts.frames=frames
        check('输出尺寸沿用两倍像素比',track.displayWidth===320&&track.displayHeight===180)
        artifacts.audioDuration=await audio.computeDuration()
        check('音轨包含整段音乐与音效',artifacts.audioDuration>=.99&&artifacts.audioDuration<1.1&&pcm.length===2)
      }finally{input.dispose()}
      check('成功后导出iframe已经移除',document.querySelectorAll('iframe').length===0)
    },
    async failures(){
      if(!enabled)return
      artifacts.failures=[]
      for(const kind of ['cancel','timeout','reload','unload','invalid-pixels']){
        const abort=new AbortController(),before=cancels,progress=[];let returned,error
        try{returned=await renderCowartFilmMp4({html:faultFilm(kind),width:160,height:90,duration:1,signal:abort.signal,taskTimeout:1000,onProgress(value){
          progress.push(value);if(value<=0)return
          if(kind==='cancel')abort.abort()
          if(kind==='reload'){const iframe=document.querySelector('iframe');iframe.src=iframe.src}
          if(kind==='unload')document.querySelector('iframe').remove()
        }})}catch(value){error=value}
        check(kind+'：已经消费一帧后才触发失败',progress.some(value=>value>0))
        check(kind+'：没有返回半截MP4',!returned&&!!error)
        check(kind+'：实际释放编码器和导出iframe',cancels===before+1&&document.querySelectorAll('iframe').length===0)
        const patterns={cancel:/取消|abort/i,timeout:/超时|时限/,reload:/加载|失效/,unload:/卸载|失效/, 'invalid-pixels':/像素/}
        check(kind+'：保留明确失败原因',patterns[kind].test(error.message))
        artifacts.failures.push({kind,error:error.message,canceled:true})
      }
    },
    async slow(){
      const nativeFetch=window.fetch;let first=true
      // OFF decodes in the parent, ON in the child; delay the same public fetch
      // boundary in both realms, without replacing any product export step.
      window.fetch=async function(url,options){if(first&&String(url).startsWith('data:video/mp4')){first=false;await new Promise(resolve=>setTimeout(resolve,6000))}return nativeFetch.call(this,url,options)}
      try{
        const start=performance.now(),blob=await renderCowartFilmMp4({html:delayedFilm(html),width:160,height:90,duration:1})
        artifacts.slow={elapsed:performance.now()-start,bytes:blob.size}
        check('素材10秒加视频6秒的真实旧/新路径均成功',blob.size>1000&&artifacts.slow.elapsed>=16000)
      }finally{window.fetch=nativeFetch}
    },
    async customTimeout(){
      if(!enabled)return
      let error
      const timed=html+`<script>const seek=CowartFilm.seek;CowartFilm.seek=async function(t){await new Promise(resolve=>setTimeout(resolve,3000));return seek.call(this,t)};<\/script>`
      try{await renderCowartFilmMp4({html:timed,width:160,height:90,duration:1,taskTimeout:1000})}catch(value){error=value}
      check('自定义taskTimeout确实到达真实子页定位步骤',/内容导出步骤超时/.test(error?.message))
    },
    async audio(){
      const start=performance.now(),blob=await renderCowartFilmMp4({html:delayedAudioFilm(html),width:160,height:90,duration:1})
      artifacts.slowAudio={elapsed:performance.now()-start,bytes:blob.size}
      check('音轨各步骤6秒，总18秒的真实旧/新路径均成功',blob.size>1000&&artifacts.slowAudio.elapsed>=18000)
      if(enabled){
        let result,error;const before=cancels
        try{result=await renderCowartFilmMp4({html:faultFilm('audio-hard'),width:160,height:90,duration:1,taskTimeout:1000})}catch(value){error=value}
        artifacts.audioHardError=error?.message
        check('音轨持续合法进展也无法超过7T硬上限（'+error?.message+'）',!result&&/总时限/.test(error?.message))
        check('音轨初始化硬超时不创建编码器或遗留iframe',cancels===before&&document.querySelectorAll('iframe').length===0)
      }
    },
    async phaseFailures(){
      if(!enabled)return
      const descriptor=Object.getOwnPropertyDescriptor(MessagePort.prototype,'onmessage')
      let fault
      // Observe the documented platform message boundary. Product handlers and
      // child stages still execute; only the external user action is injected.
      Object.defineProperty(MessagePort.prototype,'onmessage',{...descriptor,set(handler){
        descriptor.set.call(this,handler&&function(event){
          const data=event.data
          if(fault&&!fault.observed&&data?.type==='film-stage'&&data.frame===1&&data.stage===fault.phase){
            fault.observed=true
            if(fault.mode==='cancel')fault.abort.abort();else document.querySelector('iframe').remove()
          }
          return handler.call(this,event)
        })
      }})
      artifacts.phaseFailures=[]
      try{
        for(const phase of ['seek','paint','assets','video-source','video-decode','capture'])for(const mode of ['cancel','unload']){
          const before=cancels;fault={phase,mode,abort:new AbortController(),observed:false};let result,error
          try{result=await renderCowartFilmMp4({html,width:160,height:90,duration:1,signal:fault.abort.signal})}catch(value){error=value}
          check(phase+' '+mode+'：真实阶段操作中止且不返回MP4',fault.observed&&!!error&&!result)
          check(phase+' '+mode+'：真实编码器中止并移除iframe',cancels===before+1&&document.querySelectorAll('iframe').length===0)
          artifacts.phaseFailures.push({phase,mode,error:error.message,canceled:true});fault=null
        }
      }finally{fault=null;Object.defineProperty(MessagePort.prototype,'onmessage',descriptor)}
    },
    async legacy(){
      const blob=await renderCowartFilmMp4({html:legacyAudioFilm(html),width:160,height:90,duration:1})
      check('没有renderAudio的旧Web Audio影片仍完整导出',blob.size>1000&&document.querySelectorAll('iframe').length===0)
      artifacts.legacy={bytes:blob.size,pcm}
    },
  }
  for(const [key,run]of Object.entries(controls)){
    const button=document.createElement('button');button.id=key;button.textContent=key
    button.onclick=async()=>{try{await run();window.__filmSmoke.completed.push(key)}catch(error){window.__filmSmoke.error=error.stack}}
    document.querySelector('#controls').append(button)
  }
  window.__filmSmoke={checks,artifacts,completed:[],error:null,dispose(){AudioBufferSource.prototype.add=add;Output.prototype.cancel=cancel}}
}
