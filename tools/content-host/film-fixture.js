import {BufferTarget,CanvasSource,Mp4OutputFormat,Output} from 'mediabunny'

const dataUrl=blob=>new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)})
export async function filmFixture(font){
  const canvas=document.createElement('canvas');canvas.width=48;canvas.height=32
  const ctx=canvas.getContext('2d'),output=new Output({format:new Mp4OutputFormat(),target:new BufferTarget()})
  const source=new CanvasSource(canvas,{codec:'avc',bitrate:500000})
  output.addVideoTrack(source,{frameRate:30});await output.start()
  for(let index=0;index<30;index++){
    ctx.fillStyle='#21946b';ctx.fillRect(0,0,48,32);ctx.fillStyle='#ffbf37';ctx.fillRect(index,4,12,24)
    await source.add(index/30,1/30)
  }
  source.close();await output.finalize()
  const video=await dataUrl(new Blob([output.target.buffer],{type:'video/mp4'}))
  return `<!doctype html><meta charset="utf-8"><style>
  @font-face{font-family:FilmFixture;src:url(data:font/woff2;base64,${font})}
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#263b54}
  body{background:linear-gradient(30deg,#18253b,#497ca0)}
  body::before{content:'★';position:absolute;left:12px;top:7px;color:#ffc765;font:22px system-ui}
  h1{position:absolute;left:39px;top:10px;margin:0;color:white;font:700 16px FilmFixture,serif}
  p{position:absolute;left:12px;top:47px;margin:0;color:#f4d8a5;font:12px system-ui}
  video{position:absolute;right:12px;bottom:8px;width:48px;height:32px;object-fit:contain}
  #dot{position:absolute;left:12px;bottom:10px;width:12px;height:12px;background:#ef6548;animation:move 1s linear both paused}
  @keyframes move{to{transform:translateX(60px)}}
  </style><h1>Frame 0</h1><p>BGM + SFX · Aa012</p><div id="dot"></div><video muted playsinline preload="auto" src="${video}"></video>
  <script>
  const video=document.querySelector('video');let time=0;
  function syntheticScore(ctx){const bgm=ctx.createOscillator(),gain=ctx.createGain(),left=ctx.createStereoPanner();bgm.frequency.value=220;gain.gain.value=.15;left.pan.value=-.25;bgm.connect(gain).connect(left).connect(ctx.destination);bgm.start();bgm.stop(1);const sfx=ctx.createOscillator(),pulse=ctx.createGain(),right=ctx.createStereoPanner();sfx.frequency.value=880;pulse.gain.value=.25;right.pan.value=.25;sfx.connect(pulse).connect(right).connect(ctx.destination);sfx.start(.5);sfx.stop(.65)}
  window.CowartFilm={duration:1,ready:video.readyState>=1?Promise.resolve():new Promise((resolve,reject)=>{video.addEventListener('loadedmetadata',resolve,{once:true});video.addEventListener('error',()=>reject(Error('合成视频无法读取')),{once:true})}),play(){},pause(){video.pause()},setMuted(value){video.muted=value},
    seek(seconds){time=seconds;document.querySelector('h1').textContent='Frame '+Math.round(seconds*30);for(const animation of document.getAnimations())animation.currentTime=seconds*1000;video.currentTime=seconds},
    async renderAudio(){const ctx=new OfflineAudioContext(2,48000,48000);syntheticScore(ctx);return ctx.startRendering()}
  };
  <\/script>`
}

export const legacyAudioFilm=html=>html+`<script>delete CowartFilm.renderAudio;CowartFilm.play=()=>syntheticScore(new AudioContext());<\/script>`

export function delayedFilm(html){
  return html+`<script>
  const slowReady=document.fonts.ready,slowSeek=CowartFilm.seek;let slowSeeking=false,slowAssets=true,slowVideo=true;
  CowartFilm.seek=function(time){slowSeeking=true;return slowSeek.call(this,time)};
  Object.defineProperty(document.fonts,'ready',{get(){if(slowSeeking&&slowAssets){slowAssets=false;return new Promise(resolve=>setTimeout(()=>resolve(slowReady),10000))}return slowReady}});
  const slowFetch=window.fetch;window.fetch=async function(url,options){if(slowVideo&&String(url).startsWith('data:video/mp4')){slowVideo=false;await new Promise(resolve=>setTimeout(resolve,6000))}return slowFetch.call(this,url,options)};
  <\/script>`
}

export function delayedAudioFilm(html){
  return html+`<script>
  const ready=document.fonts.ready,render=CowartFilm.renderAudio;let initial=true;
  Object.defineProperty(document.fonts,'ready',{get(){if(initial){initial=false;return new Promise(resolve=>setTimeout(()=>resolve(ready),6000))}return ready}});
  CowartFilm.ready={then(resolve){setTimeout(resolve,6000)}};
  CowartFilm.renderAudio=async function(options){await new Promise(resolve=>setTimeout(resolve,6000));return render.call(this,options)};
  <\/script>`
}

// A hostile synthetic instance tests the production parent's failure path,
// including a real encoder already started and one valid frame consumed.
export function faultFilm(kind){
  return `<!doctype html><meta charset="utf-8"><script>
  addEventListener('message',event=>{
    if(event.data?.type!=='connect'||event.source!==parent)return;
    event.stopImmediatePropagation();const port=event.ports[0],{options,...base}=event.data;
    const post=value=>port.postMessage({...base,...value});post({type:'ready'});
    port.onmessage=({data:m})=>{if(m.type!=='request')return;
      if(m.command==='film-audio'){
        if(${JSON.stringify(kind)}==='audio-hard'){for(const [stage,delay]of [['assets',0],['api',1000],['pause',3000],['render-audio',4000],['pause-after',5000],['mute',6000]])setTimeout(()=>post({type:'film-audio-stage',id:m.id,stage}),delay);return}
        const a=new Float32Array(48000);for(let i=0;i<a.length;i++)a[i]=.2*Math.sin(i/48000*220*Math.PI*2);post({type:'film-audio-result',id:m.id,videoSources:0,value:{sampleRate:48000,numberOfChannels:1,length:48000,channels:[a.buffer]}});return}
      if(m.command!=='film-frame')return;
      if(m.value.index>0&&${JSON.stringify(kind)}!=='invalid-pixels')return;
      const width=m.value.width*m.value.pixelRatio,height=m.value.height*m.value.pixelRatio,pixels=new Uint8Array(width*height*4).fill(180);
      post({type:'film-frame-result',id:m.id,frame:m.value.index,value:{width:m.value.index>0?width+1:width,height,pixels:pixels.buffer}})
    };port.start();
  },true)
  <\/script>`
}
