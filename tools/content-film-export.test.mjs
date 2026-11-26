import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {bindContentChannel} from '../content-channel/index.js'

const flush=()=>new Promise(resolve=>setImmediate(resolve))
function peer(t,{respond,host=new EventTarget()}={}){
  const iframe=new EventTarget(),requests=[],ports=[]
  Object.assign(host,{MessageChannel});iframe.ownerDocument={defaultView:host}
  let wire,initializing
  const reply=value=>{const {options,...base}=wire.data;wire.port.postMessage({...base,...value.type==='film-audio-result'?{videoSources:0}:{},...value})}
  iframe.contentWindow={postMessage(data,_origin,passed){
    wire={data,port:passed[0]};ports.push(wire.port)
    wire.port.onmessage=event=>{
      if(initializing&&event.data.type==='request'&&event.data.command==='film-audio'){reply({type:'film-audio-result',id:event.data.id,videoSources:initializing.sources,value:pcm(8000,1,80000)});return}
      requests.push(event.data);respond?.(event.data,reply)
    }
    wire.port.start();reply({type:'ready'})
  }}
  const instanceId='b'.repeat(48),channel=bindContentChannel(iframe,{instanceId,url:'http://'+instanceId+'.localhost:12345/document.html'})
  t.after(()=>{channel.dispose();for(const port of ports)port.close()})
  return{channel,iframe,host,requests,reply,async initialize({sources=0,taskTimeout=15000}={}){initializing={sources};try{return await channel.request('film-audio',{duration:10,taskTimeout})}finally{initializing=null}}}
}
async function next(remote,index=0){while(remote.requests.filter(value=>value.type==='request').length<=index)await flush();return remote.requests.filter(value=>value.type==='request')[index]}
const pixels=()=>({width:2,height:2,pixels:Uint8Array.from({length:16},()=>79).buffer})
const frameOptions=index=>({index,width:2,height:2,pixelRatio:1})

test('影片帧回执同时绑定请求编号与帧号，复用截图像素预算',{timeout:5000},async t=>{
  const remote=peer(t,{respond(message,reply){if(message.type==='request')reply({type:'film-frame-result',id:message.id,frame:message.value.index,value:pixels()})}})
  await remote.initialize()
  const result=await remote.channel.request('film-frame',frameOptions(7))
  assert.equal(result.frame,7);assert.equal(result.width,2);assert.equal(result.pixels.byteLength,16)
  assert.deepEqual([...new Uint8Array(result.pixels)],Array(16).fill(79))
})

const pcm=(rate=48000,channels=2,length=rate)=>({sampleRate:rate,numberOfChannels:channels,length,channels:Array.from({length:channels},()=>new Float32Array(length).fill(.25).buffer)})
test('音轨携有界PCM元数据和采样，只有白名单采样率与声道可通过',{timeout:5000},async t=>{
  let value=pcm()
  const remote=peer(t,{respond(message,reply){if(message.type==='request')reply({type:'film-audio-result',id:message.id,value})}})
  const audio=await remote.channel.request('film-audio',{duration:1})
  assert.equal(audio.sampleRate,48000);assert.equal(audio.numberOfChannels,2);assert.equal(audio.length,48000)
  assert.equal(new Float32Array(audio.channels[1])[47999],.25)
  for(const invalid of [pcm(96000),pcm(48000,3),{...pcm(),length:5760001},{...pcm(),channels:[new ArrayBuffer(3),new ArrayBuffer(3)]},pcm(48000,2,24000),{...pcm(),execute:true}]){
    const bad=peer(t,{respond(message,reply){if(message.type==='request')reply({type:'film-audio-result',id:message.id,value:invalid})}})
    await assert.rejects(bad.channel.request('film-audio',{duration:1}),/音轨/)
  }
  for(const nan of [true,false]){
    const invalid=pcm();if(nan)new Float32Array(invalid.channels[0])[100]=NaN;else invalid.channels[1]=invalid.channels[0]
    const bad=peer(t,{respond(message,reply){if(message.type==='request')reply({type:'film-audio-result',id:message.id,value:invalid})}})
    await assert.rejects(bad.channel.request('film-audio',{duration:1}),/音轨/)
  }
})

test('300帧经父页转换后每个结果都脱离像素缓冲，PCM重建也释放传输缓冲',{timeout:10000},async t=>{
  const {renderContentFilmFrame,renderContentFilmAudio}=await import('../content-channel/index.js')
  t.mock.timers.enable({apis:['Date']})
  const remote=peer(t,{respond(message,reply){if(message.type!=='request')return;reply(message.command==='film-audio'?{type:'film-audio-result',id:message.id,value:pcm(48000,2,480000)}:{type:'film-frame-result',id:message.id,frame:message.value.index,value:pixels()})}})
  const results=[],buffers=[],request=remote.channel.request
  remote.channel.request=async(...args)=>{const value=await request(...args);results.push(value);buffers.push(...value.channels||[value.pixels]);return value}
  remote.host.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height})}}
  remote.host.AudioBuffer=class{constructor(options){Object.assign(this,options);this.data=Array.from({length:options.numberOfChannels},()=>new Float32Array(options.length))}copyToChannel(values,index){this.data[index].set(values)}}
  remote.iframe.ownerDocument.createElement=()=>({getContext:()=>({putImageData(image){assert.equal(image.data[0],79)}})})
  const audio=await renderContentFilmAudio(remote.iframe,{duration:10})
  for(let index=0;index<300;index++){
    const frame=await renderContentFilmFrame(remote.iframe,frameOptions(index))
    assert.equal(frame.width,2);assert.equal(frame.height,2)
    assert.equal(results.at(-1).pixels,null)
    t.mock.timers.tick(34)
  }
  assert.equal(audio.data[0][123],.25);assert.equal(audio.data[1][47999],.25)
  assert.equal(results.length,301);assert.ok(buffers.every(buffer=>buffer.byteLength===0))
  assert.equal(results[0].channels,null)
})

test('迟到的旧帧、错误帧号和重载不能让当前编码帧通过',{timeout:5000},async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const remote=peer(t)
  await remote.initialize({taskTimeout:10})
  const old=remote.channel.request('film-frame',frameOptions(0),{timeout:10})
  const a=await next(remote);t.mock.timers.tick(40);await assert.rejects(old,/超时|时限/)
  remote.reply({type:'capture-end',id:a.id});await flush();await flush()
  const current=remote.channel.request('film-frame',frameOptions(1)),b=await next(remote,1)
  let settled=false;current.then(()=>{settled=true},()=>{settled=true})
  remote.reply({type:'film-frame-result',id:a.id,frame:0,value:pixels()});await flush();await flush();assert.equal(settled,false)
  remote.reply({type:'film-frame-result',id:b.id,frame:0,value:pixels()});await assert.rejects(current,/像素/)
  const loading=remote.channel.request('film-frame',frameOptions(2));await next(remote,2)
  remote.iframe.dispatchEvent(new Event('load'));await assert.rejects(loading,/失效/)
})
test('音轨与帧共用实例1和页面2额度，取消后必须等实际结束回执',{timeout:5000},async t=>{
  const host=new EventTarget(),one=peer(t,{host}),two=peer(t,{host}),three=peer(t,{host}),abort=new AbortController()
  await two.initialize()
  const audio=one.channel.request('film-audio',{duration:1},{signal:abort.signal}),a=await next(one)
  await assert.rejects(one.channel.request('film-audio',{duration:1}),{code:'CHANNEL_BUSY'})
  const frame=two.channel.request('film-frame',frameOptions(0)),b=await next(two)
  abort.abort();await assert.rejects(audio,{name:'AbortError'})
  await assert.rejects(three.channel.request('film-audio',{duration:1}),{code:'CHANNEL_BUSY'})
  one.reply({type:'capture-end',id:a.id});await flush();await flush()
  const third=three.channel.request('film-audio',{duration:1}),c=await next(three)
  three.reply({type:'film-audio-result',id:c.id,value:pcm()});await third
  two.reply({type:'film-frame-result',id:b.id,frame:0,value:pixels()});await frame
})

test('首帧完成后出现的视频使用当前帧信号，取消立即中止新媒体等待',{timeout:5000},async t=>{
  const {createFilmVideoFrames}=await import('../content-channel/index.js')
  const first=new AbortController(),second=new AbortController(),decoder=createFilmVideoFrames({signal:first.signal})
  t.after(()=>{decoder.dispose();first.abort()})
  assert.equal((await decoder.render({querySelectorAll:()=>[]})).size,0)
  let fetching,aborted=false
  t.mock.method(globalThis,'fetch',(_url,{signal})=>new Promise((resolve,reject)=>{
    fetching=signal;signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason)},{once:true})
  }))
  const doc={querySelectorAll:()=>[{src:'data:video/mp4,synthetic'}],defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})}}
  const rendering=decoder.render(doc,{signal:second.signal});rendering.catch(()=>{})
  while(!fetching)await flush()
  assert.equal(fetching,second.signal)
  second.abort();await assert.rejects(rendering,{name:'AbortError'});assert.equal(aborted,true)
})

test('子页音轨初始化拒绝非有限影片时长，不能把NaN推进虚拟钟',{timeout:5000},async t=>{
  const {installContentChild}=await import('../content-channel/index.js')
  for(const duration of [NaN,undefined,Infinity]){
    const host=new EventTarget(),parent={},messages=[],wire=new MessageChannel(),base={protocol:1,instance:'c'.repeat(48),generation:'duration'}
    let rendered=0,clocked=0
    Object.assign(host,{parent,document:{images:[],querySelectorAll:()=>[],documentElement:{getBoundingClientRect(){}}},CowartFilm:{duration,pause(){},play(){},seek(){},setMuted(){},renderAudio(){rendered++;const result=pcm();return{...result,duration:1,getChannelData:index=>new Float32Array(result.channels[index])}}},__cowartSetExportTime(){clocked++}})
    const receiver=installContentChild(host,{instanceId:base.instance,parentOrigin:'http://127.0.0.1:43397'})
    t.after(()=>{receiver.dispose();wire.port1.close()})
    wire.port1.onmessage=event=>messages.push(event.data);wire.port1.start()
    const event=new Event('message');Object.assign(event,{source:parent,origin:'http://127.0.0.1:43397',ports:[wire.port2],data:{...base,type:'connect',options:{film:false,duration:1,muted:true}}});host.dispatchEvent(event)
    while(!messages.some(value=>value.type==='ready'))await flush()
    wire.port1.postMessage({...base,type:'request',id:'audio',command:'film-audio',value:{duration:1}})
    while(!messages.some(value=>value.type==='capture-end'))await flush()
    assert.match(messages.find(value=>value.type==='response')?.error||'',/时长/)
    assert.equal(rendered,0);assert.equal(clocked,0)
    receiver.dispose();wire.port1.close()
  }
})

async function stage(remote,request,name,media){remote.reply({type:'film-stage',id:request.id,frame:request.value.index,stage:name,...media===undefined?{}:{media}});await flush();await flush()}
test('素材10秒加视频6秒仍能成功，按每个旧步骤计时而非整帧15秒',{timeout:5000},async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout']})
  const remote=peer(t);await remote.initialize({sources:1})
  const pending=remote.channel.request('film-frame',frameOptions(0)),request=await next(remote)
  await stage(remote,request,'seek');await stage(remote,request,'paint');await stage(remote,request,'assets')
  t.mock.timers.tick(10000);await stage(remote,request,'video-source',0)
  t.mock.timers.tick(6000);await stage(remote,request,'video-decode',0);await stage(remote,request,'capture')
  remote.reply({type:'film-frame-result',id:request.id,frame:0,value:pixels()})
  assert.equal((await pending).frame,0)
})
for(const [name,phases] of [
  ['重复',[['seek'],['seek']]],['倒退',[['seek'],['paint'],['seek']]],
  ['媒体越界',[['assets'],['video-source',1]]],['未知阶段',[['execute']]],
])test('影片阶段'+name+'必须失败，不能当心跳续命',{timeout:5000},async t=>{
  const remote=peer(t);await remote.initialize({sources:1})
  const pending=remote.channel.request('film-frame',frameOptions(0)),request=await next(remote)
  const rejected=assert.rejects(pending,/阶段/)
  for(const [name,media] of phases)await stage(remote,request,name,media)
  await rejected
})
test('阶段回报伪造帧号也立即失败',{timeout:5000},async t=>{
  const remote=peer(t);await remote.initialize()
  const pending=remote.channel.request('film-frame',frameOptions(0)),request=await next(remote),rejected=assert.rejects(pending,/阶段/)
  remote.reply({type:'film-stage',id:request.id,frame:1,stage:'seek'});await rejected
})
test('持续合法阶段仍不能延后固定步骤总上限',{timeout:5000},async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout']})
  const remote=peer(t);await remote.initialize({sources:1,taskTimeout:10000})
  const pending=remote.channel.request('film-frame',frameOptions(0)),request=await next(remote),rejected=assert.rejects(pending,/总时限/)
  await stage(remote,request,'seek')
  for(const [name,media] of [['paint'],['assets'],['video-source',0],['video-decode',0],['capture']]){t.mock.timers.tick(10500);await stage(remote,request,name,media)}
  // (seek + paint + assets + capture + source + decode) * 10s = 60s.
  t.mock.timers.tick(7500);await rejected
})
test('最大taskTimeout的总上限不溢出，取消仍立即生效',{timeout:5000},async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout']})
  const remote=peer(t);await remote.initialize({sources:64,taskTimeout:2147483647})
  const abort=new AbortController(),pending=remote.channel.request('film-frame',frameOptions(0),{signal:abort.signal}),request=await next(remote)
  let settled=false;pending.then(()=>{settled=true},()=>{settled=true})
  await stage(remote,request,'seek');t.mock.timers.tick(2147483646);await flush();assert.equal(settled,false)
  abort.abort();await assert.rejects(pending,{name:'AbortError'})
})

for(const sources of [0,64])test('合法阶段独立有界，不挤掉'+(sources?'64视频一帧':'30fps快速帧流')+'的像素和结束回执',{timeout:5000},async t=>{
  t.mock.timers.enable({apis:['Date']})
  const remote=peer(t);await remote.initialize({sources})
  for(let index=0;index<(sources?1:30);index++){
    let state='pending'
    const pending=remote.channel.request('film-frame',frameOptions(index))
    pending.then(()=>{state='success'},()=>{state='failed'})
    const request=await next(remote,index)
    for(const name of ['seek','paint','assets'])await stage(remote,request,name)
    for(let media=0;media<sources;media++){await stage(remote,request,'video-source',media);await stage(remote,request,'video-decode',media)}
    await stage(remote,request,'capture')
    remote.reply({type:'film-frame-result',id:request.id,frame:index,value:pixels()})
    remote.reply({type:'capture-end',id:request.id});await flush();await flush()
    assert.equal(state,'success','合法阶段不能吃掉像素回复额度：第'+index+'帧')
    await pending;t.mock.timers.tick(34)
  }
})

test('已声明视频换DOM顺序仍按声明序号处理，新插入的隐藏视频也拒绝',{timeout:5000},async t=>{
  const {createFilmVideoFrames}=await import('../content-channel/index.js')
  const declared=[{src:'data:video/mp4,A'},{src:'data:video/mp4,B'}],abort=new AbortController(),decoder=createFilmVideoFrames()
  t.after(()=>{abort.abort();decoder.dispose()})
  let fetched
  t.mock.method(globalThis,'fetch',(url,{signal})=>{fetched=url;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))})
  const doc={querySelectorAll:()=>[declared[1],declared[0]],defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})}}
  const mediaIndex=video=>{const index=declared.indexOf(video);if(index<0)throw new Error('未声明视频');return index}
  const rendering=decoder.render(doc,{signal:abort.signal,mediaIndex});rendering.catch(()=>{})
  while(!fetched)await flush()
  assert.equal(fetched,declared[0].src,'处理序号不应随DOM叠放顺序倒退')
  abort.abort();await assert.rejects(rendering,{name:'AbortError'})
  doc.querySelectorAll=()=>[{src:'data:video/mp4,new'}];doc.defaultView.getComputedStyle=()=>({display:'none'})
  await assert.rejects(decoder.render(doc,{mediaIndex}),/未声明/)
})

test('音轨各步骤独立计时，API允许旧发现与ready两个时限',{timeout:5000},async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout']})
  const remote=peer(t),pending=remote.channel.request('film-audio',{duration:1,taskTimeout:10000}),request=await next(remote)
  const progress=async name=>{remote.reply({type:'film-audio-stage',id:request.id,stage:name});await flush();await flush()}
  await progress('assets');t.mock.timers.tick(6000);await progress('api');t.mock.timers.tick(16000)
  await progress('pause');await progress('render-audio');t.mock.timers.tick(6000);await progress('pause-after');await progress('mute')
  remote.reply({type:'film-audio-result',id:request.id,value:pcm()})
  assert.equal((await pending).length,48000)
})
test('音轨固定7T硬上限不会被持续合法进展延长',{timeout:5000},async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout']})
  const remote=peer(t),pending=remote.channel.request('film-audio',{duration:1,taskTimeout:1000}),request=await next(remote),rejected=assert.rejects(pending,/总时限/)
  for(const [name,delay]of [['assets',0],['api',1900],['pause',2900],['render-audio',1900]]){
    t.mock.timers.tick(delay);remote.reply({type:'film-audio-stage',id:request.id,stage:name});await flush();await flush()
  }
  t.mock.timers.tick(300);await rejected
})
test('几百条未匹配阶段受普通额度限制，在途结果和取消结束回执仍可达',{timeout:5000},async t=>{
  const remote=peer(t);await remote.initialize()
  const observed=[];remote.channel.subscribe(value=>observed.push(value))
  const pending=remote.channel.request('film-frame',frameOptions(0)),request=await next(remote)
  for(let index=0;index<300;index++)remote.reply({type:'film-stage',id:'unknown'+index,frame:0,stage:'seek'})
  remote.reply({type:'status',value:{duration:10,currentTime:0,ready:true,playing:false,muted:true}})
  await stage(remote,request,'seek');remote.reply({type:'film-frame-result',id:request.id,frame:0,value:pixels()})
  assert.equal((await pending).frame,0);assert.equal(observed.length,0,'未知阶段耗尽普通桶，后来的状态也应限流')
  const abort=new AbortController(),canceled=remote.channel.request('film-frame',frameOptions(1),{signal:abort.signal}),nextRequest=await next(remote,1)
  abort.abort();await assert.rejects(canceled,{name:'AbortError'})
  remote.reply({type:'capture-end',id:nextRequest.id});await flush();await flush()
  const fresh=remote.channel.request('film-frame',frameOptions(2)),last=await next(remote,2)
  remote.reply({type:'film-frame-result',id:last.id,frame:2,value:pixels()});assert.equal((await fresh).frame,2)
})

for(const phase of ['seek','paint','assets','video-source','video-decode','capture'])for(const action of ['cancel','reload'])test(phase+'阶段'+action+'立即终止当前请求',{timeout:5000},async t=>{
  const remote=peer(t);await remote.initialize({sources:1})
  const abort=new AbortController(),pending=remote.channel.request('film-frame',frameOptions(0),{signal:abort.signal}),request=await next(remote)
  const rejected=assert.rejects(pending,action==='cancel'?{name:'AbortError'}:/失效/)
  await stage(remote,request,phase,phase.startsWith('video-')?0:undefined)
  if(action==='cancel'){abort.abort();remote.reply({type:'capture-end',id:request.id})}
  else remote.iframe.dispatchEvent(new Event('load'))
  await rejected
})

test('真实父子Port贯通音轨六阶段：每步8秒、总48秒仍沿用10秒独立时限',{timeout:5000},async t=>{
  const {installContentChild}=await import('../content-channel/index.js')
  t.mock.timers.enable({apis:['Date','setTimeout']})
  const host=new EventTarget(),child=new EventTarget(),iframe=new EventTarget(),stages=[],instanceId='e'.repeat(48)
  const delay=name=>new Promise(resolve=>{stages.push(name);setTimeout(resolve,8000)})
  const doc={images:[],querySelectorAll:()=>[],documentElement:{getBoundingClientRect(){}},fonts:Object.assign([],{ready:{then:resolve=>delay('assets').then(resolve)}})}
  let pauses=0,frozen=0
  Object.assign(child,{parent:host,document:doc,__cowartSetExportTime(){frozen++},CowartFilm:{duration:1,
    ready:{then:resolve=>delay('api').then(resolve)},pause:()=>delay(pauses++?'pause-after':'pause'),play(){},seek(){},setMuted:()=>delay('mute'),
    async renderAudio(){await delay('render-audio');return{sampleRate:48000,numberOfChannels:2,length:48000,duration:1,getChannelData:index=>new Float32Array(48000).fill(index?.3:.2)}},
  }})
  Object.assign(host,{MessageChannel});iframe.ownerDocument={defaultView:host};iframe.contentWindow=child
  child.postMessage=(data,_origin,ports)=>{const event=new Event('message');Object.assign(event,{source:host,origin:'http://127.0.0.1:43397',ports,data});child.dispatchEvent(event)}
  const receiver=installContentChild(child,{instanceId,parentOrigin:'http://127.0.0.1:43397'})
  const channel=bindContentChannel(iframe,{instanceId,url:'http://'+instanceId+'.localhost:12345/document.html'})
  t.after(()=>{channel.dispose();receiver.dispose()})
  const rendering=channel.request('film-audio',{duration:1,taskTimeout:10000});rendering.catch(()=>{})
  for(const phase of ['assets','api','pause','render-audio','pause-after','mute']){
    while(stages.at(-1)!==phase)await flush()
    await flush();await flush();t.mock.timers.tick(8000)
  }
  const result=await rendering
  assert.deepEqual(stages,['assets','api','pause','render-audio','pause-after','mute'])
  assert.equal(new Float32Array(result.channels[0])[0],Math.fround(.2));assert.equal(new Float32Array(result.channels[1])[0],Math.fround(.3));assert.equal(frozen,1)
})
