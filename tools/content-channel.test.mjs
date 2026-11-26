import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {bindContentChannel,installContentChild} from '../content-channel/index.js'

const flush=()=>new Promise(resolve=>setImmediate(resolve))
function fixture(t,{deliverHandshake=true,film=true,legacy=false}={}){
  const parent=new EventTarget(),child=new EventTarget(),iframe=new EventTarget(),statuses=[]
  Object.assign(parent,{MessageChannel,location:{origin:'http://127.0.0.1:43396'}})
  Object.assign(child,{parent,performance,requestAnimationFrame:fn=>setTimeout(()=>fn(performance.now()),16),cancelAnimationFrame:clearTimeout,setTimeout,clearTimeout,location:{origin:'http://'+ 'a'.repeat(48)+'.localhost:12345'}})
  const api={duration:3,currentTime:0,playing:false,muted:false,seek(value){this.currentTime=value},play(){this.playing=true},pause(){this.playing=false},setMuted(value){this.muted=value}}
  child.CowartFilm=api
  child.MessageEvent=class extends Event{constructor(type,init){super(type);Object.assign(this,init)}}
  const emitLegacy=(data,{source=child,origin=child.location.origin}={})=>{const event=new Event('message');Object.assign(event,{data,source,origin});parent.dispatchEvent(event)}
  if(legacy){
    delete child.CowartFilm
    child.document={querySelectorAll:()=>[],getAnimations:()=>[]}
    child.addEventListener('message',event=>{
      if(event.source!==child.parent||event.data?.channel!=='cowart-film'||event.data.type!=='command')return
      const {command,value}=event.data
      if(command==='play')api.play()
      if(command==='pause')api.pause()
      if(command==='seek')api.seek(value)
      if(command==='mute')api.setMuted(value)
      emitLegacy({channel:'cowart-film',type:'status',duration:api.duration,currentTime:api.currentTime,playing:api.playing,muted:api.muted})
    })
  }
  iframe.ownerDocument={defaultView:parent};iframe.contentWindow=child
  const deliver=(data,{source=parent,origin=parent.location.origin,ports=[]}={})=>{
    const event=new Event('message');Object.assign(event,{data,source,origin,ports});child.dispatchEvent(event)
  }
  const connections=[]
  child.postMessage=(data,origin,ports)=>{assert.equal(origin,child.location.origin);connections.push({data,ports});if(deliverHandshake)deliver(data,{ports})}
  const instanceId='a'.repeat(48),url=child.location.origin+'/document.html'
  const receiver=installContentChild(child,{instanceId,parentOrigin:parent.location.origin})
  const channel=bindContentChannel(iframe,{instanceId,url,film})
  t.after(()=>{channel.dispose();receiver.dispose()})
  channel.subscribe(status=>statuses.push(status))
  return {parent,child,iframe,api,channel,deliver,statuses,instanceId,connections,emitLegacy}
}
test('实例MessagePort控制影片播放、暂停、定位与静音，状态不包含内容对象',async t=>{
  const {channel,api,statuses}=fixture(t)
  assert.equal(await channel.request('seek',.051),true)
  assert.equal(api.currentTime,2/30)
  await channel.request('play')
  assert.equal(api.playing,true)
  await channel.request('pause')
  assert.equal(api.playing,false)
  const mutedStatus=new Promise(resolve=>{const off=channel.subscribe(status=>{if(status.muted&&status.ready){off();resolve(status)}})})
  await channel.request('mute',true)
  await mutedStatus
  assert.equal(api.muted,true)
  assert.equal(statuses.at(-1).ready,true)
  assert.equal(statuses.at(-1).muted,true)
  assert.deepEqual(Object.keys(statuses.at(-1)).sort(),['currentTime','duration','muted','playing','ready'])
})
test('错误窗口、错误来源、版本和旧实例不能完成握手，正确实例随后仍能控制',async t=>{
  const {connections,deliver,channel,api,parent}=fixture(t,{deliverHandshake:false})
  const {data,ports}=connections[0]
  api.currentTime=1
  deliver(data,{ports,source:{}})
  deliver(data,{ports,origin:'http://wrong.localhost:12345'})
  deliver({...data,protocol:2},{ports})
  deliver({...data,instance:'b'.repeat(48)},{ports})
  deliver({...data,options:{...data.options,execute:'parent.fetch()'}},{ports})
  await flush()
  assert.equal(api.currentTime,1)
  deliver(data,{ports,source:parent})
  assert.equal(await channel.request('seek',.5),true)
  assert.equal(api.currentTime,.5)
})
test('普通网页建立通道不暂停媒体；只允许影片的四个有界命令和纯值参数',async t=>{
  const {channel,api}=fixture(t,{film:false})
  api.playing=true
  await assert.rejects(channel.request('play'),/尚未就绪/)
  assert.equal(api.playing,true)
  for(const [name,value] of [['eval','x'],['fetch','/api/canvas'],['play',()=>{}],['seek',Infinity],['seek',-1],['seek',{}],['mute','yes']])await assert.rejects(channel.request(name,value),/参数无效/)
})
function peer(t){
  const host=new EventTarget(),iframe=new EventTarget(),messages=[]
  Object.assign(host,{MessageChannel,location:{origin:'http://127.0.0.1:43396'}})
  let connection
  iframe.ownerDocument={defaultView:host}
  iframe.contentWindow={postMessage(data,origin,ports){connection={data,port:ports[0]};connection.port.onmessage=event=>messages.push(event.data);connection.port.start()}}
  const instanceId='c'.repeat(48)
  const channel=bindContentChannel(iframe,{url:'http://'+instanceId+'.localhost:12345/document.html',instanceId,film:true})
  // Remove the handshake-only options rather than sending an unknown field.
  const reply=message=>{const {options,...base}=connection.data;connection.port.postMessage({...base,...message})}
  t.after(()=>{channel.dispose();connection.port.close()})
  return {channel,iframe,host,messages,reply,get connection(){return connection}}
}
test('错误版本、旧实例和未知请求号的回复全部丢弃，合法回复只结算一次',async t=>{
  const remote=peer(t)
  remote.reply({type:'ready'})
  let settled=false
  const result=remote.channel.request('play').then(value=>{settled=true;return value})
  while(!remote.messages.length)await flush()
  const id=remote.messages[0].id
  for(const extra of [{protocol:9},{instance:'old'},{generation:'old'},{id:'unknown'},{value:{nodeType:1}},{execute:'function(){}'}])remote.reply({type:'response',id,ok:true,value:true,...extra})
  await flush();await flush()
  assert.equal(settled,false)
  remote.reply({type:'response',id,ok:true,value:true})
  assert.equal(await result,true)
  remote.reply({type:'response',id,ok:true,value:true})
})
test('请求支持取消和有界超时，旧请求在重载和卸载时全部拒绝',async t=>{
  const remote=peer(t)
  remote.reply({type:'ready'})
  const abort=new AbortController(),cancelled=remote.channel.request('seek',1,{signal:abort.signal})
  while(!remote.messages.length)await flush()
  abort.abort()
  await assert.rejects(cancelled,{name:'AbortError'})
  while(!remote.messages.some(message=>message.type==='cancel'))await flush()
  t.mock.timers.enable({apis:['setTimeout']})
  const timed=remote.channel.request('pause')
  await flush()
  t.mock.timers.tick(3000)
  await assert.rejects(timed,/超时/)
  const reloaded=remote.channel.request('play')
  await flush()
  const old=remote.connection
  remote.iframe.dispatchEvent(new Event('load'))
  await assert.rejects(reloaded,/失效/)
  assert.notEqual(remote.connection.port,old.port)
  old.port.close()
  remote.reply({type:'ready'})
  const removed=remote.channel.request('mute',true)
  await flush()
  remote.channel.dispose()
  await assert.rejects(removed,/失效/)
  await assert.rejects(remote.channel.request('play'),/失效/)
})
test('握手等待也可立即取消，子页导航关闭会拒绝全部在途请求',async t=>{
  const remote=peer(t),abort=new AbortController()
  const waiting=remote.channel.request('play',undefined,{signal:abort.signal})
  abort.abort()
  await assert.rejects(waiting,{name:'AbortError'})
  remote.reply({type:'ready'})
  const inFlight=remote.channel.request('play')
  while(!remote.messages.some(message=>message.type==='request'))await flush()
  remote.reply({type:'close'})
  await assert.rejects(inFlight,/失效/)
})
test('消息大小、频率和并发请求有上限，过大的状态不能进入父界面',async t=>{
  const remote=peer(t),statuses=[]
  remote.channel.subscribe(status=>statuses.push(status))
  remote.reply({type:'ready'})
  remote.reply({type:'status',value:{duration:3,currentTime:1,playing:false,muted:false,ready:true,error:'x'.repeat(5000)}})
  await flush();await flush()
  assert.equal(statuses.length,0)
  const tasks=Array.from({length:33},()=>remote.channel.request('pause'))
  const collected=Promise.allSettled(tasks)
  while(remote.messages.filter(message=>message.type==='request').length<32)await flush()
  remote.channel.dispose()
  const results=await collected
  assert.equal(results.filter(result=>/过于频繁/.test(result.reason?.message)).length,1)
  assert.ok(results.every(result=>result.status==='rejected'))
})
test('子页对白名单命令同样限流，旧代消息和有额外对象的参数丢弃',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000})
  const {connections,api,deliver}=fixture(t)
  const {data,ports}=connections[0],{options,...base}=data
  const raw=new MessageChannel(),port=raw.port1
  t.after(()=>port.close())
  deliver(data,{ports:[raw.port2]})
  for(let i=0;i<61;i++)port.postMessage({...base,type:'request',id:'raw'+i,command:'seek',value:i/30})
  // Two task turns let the real MessagePort drain without sleeping wall time.
  await flush();await flush();await flush()
  assert.equal(api.currentTime,59/30)
  t.mock.timers.tick(1000)
  port.postMessage({...base,type:'request',id:'old',generation:'old',command:'seek',value:2.5})
  port.postMessage({...base,type:'request',id:'object',command:'seek',value:{toJSON:'code'}})
  port.postMessage({...base,type:'request',id:'valid',command:'seek',value:2.4})
  await flush();await flush()
  assert.equal(api.currentTime,2.4)
})
test('六十条合法定位的回复不会被握手与状态抢占，释放控制器暂停且后续命令无效',async t=>{
  const {channel,api}=fixture(t)
  await Promise.all(Array.from({length:32},()=>channel.request('seek',.1)))
  await Promise.all(Array.from({length:28},()=>channel.request('seek',.2)))
  const remote=fixture(t),controller=remote.channel.attachFilmController()
  await remote.channel.request('play')
  assert.equal(remote.api.playing,true)
  controller.dispose()
  for(let i=0;i<10&&remote.api.playing;i++)await flush()
  assert.equal(remote.api.playing,false)
  assert.equal(controller.command('play'),false)
  assert.equal(api.currentTime,.2)
})
test('子端耗尽命令额度后，销毁消息仍暂停影片并关闭旧会话',async t=>{
  const {connections,api,deliver}=fixture(t),{data}=connections[0],{options,...base}=data
  const raw=new MessageChannel();t.after(()=>raw.port1.close())
  deliver(data,{ports:[raw.port2]})
  for(let i=0;i<60;i++)raw.port1.postMessage({...base,type:'request',id:'full'+i,command:'play'})
  await flush();await flush()
  assert.equal(api.playing,true)
  raw.port1.postMessage({...base,type:'close'})
  await flush();await flush()
  assert.equal(api.playing,false)
})
test('耗尽普通请求额度后释放控制器仍暂停',async t=>{
  const {channel,api}=fixture(t),controller=channel.attachFilmController()
  await channel.request('play')
  for(let i=0;i<59;i++)await channel.request('seek',.2)
  controller.dispose()
  for(let i=0;i<20&&api.playing;i++)await flush()
  assert.equal(api.playing,false)
})
test('旧消息初始化不占业务额度，六十条合法请求全部有回复',async t=>{
  const old=fixture(t,{legacy:true})
  for(let i=0;i<100&&!old.statuses.at(-1)?.ready;i++)await new Promise(resolve=>setTimeout(resolve,2))
  assert.equal(old.statuses.at(-1)?.ready,true)
  for(let i=0;i<60;i++)assert.equal(await old.channel.request('pause'),true)
})
test('重载清除尚未发送的时间轴定位，不把旧手势送给新页面',async t=>{
  const remote=peer(t)
  remote.reply({type:'ready'})
  const controller=remote.channel.attachFilmController()
  controller.command('seek',.1)
  while(!remote.messages.some(message=>message.type==='request'))await flush()
  const first=remote.messages.find(message=>message.type==='request')
  remote.reply({type:'response',id:first.id,ok:true,value:true})
  t.mock.timers.enable({apis:['setTimeout']})
  controller.command('seek',2)
  const old=remote.connection.port
  remote.iframe.dispatchEvent(new Event('load'))
  remote.reply({type:'ready'})
  await flush();await flush()
  const count=remote.messages.filter(message=>message.type==='request').length
  t.mock.timers.tick(50)
  await flush();await flush()
  assert.equal(remote.messages.filter(message=>message.type==='request').length,count)
  controller.dispose();old.close()
})
test('原cowart-film消息影片保留父窗口来源约定，经Port播放、定位、静音和状态',async t=>{
  const {channel,api,statuses}=fixture(t,{legacy:true})
  for(let i=0;i<100&&!statuses.at(-1)?.ready;i++)await new Promise(resolve=>setTimeout(resolve,2))
  assert.equal(statuses.at(-1)?.ready,true)
  await channel.request('play');assert.equal(api.playing,true)
  await channel.request('pause');assert.equal(api.playing,false)
  await channel.request('seek',.051);assert.equal(api.currentTime,2/30)
  await channel.request('mute',true);assert.equal(api.muted,true)
})
test('旧格式残留播放状态只能影响显示，不能让暂停的新影片跳到结尾',async t=>{
  const {child,api,statuses,emitLegacy}=fixture(t,{legacy:true})
  for(let i=0;i<100&&!statuses.at(-1)?.ready;i++)await new Promise(resolve=>setTimeout(resolve,2))
  assert.equal(statuses.at(-1)?.ready,true)
  let clock=1000
  child.performance={now:()=>clock}
  emitLegacy({channel:'cowart-film',type:'status',duration:3,currentTime:2.99,playing:true,muted:false})
  for(let i=0;i<4;i++)await flush()
  clock+=1000
  await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(api.currentTime,0)
  assert.equal(api.playing,false)
})
function legacyWindow(remote,data,{source=remote.iframe.contentWindow,origin='http://'+'c'.repeat(48)+'.localhost:12345'}={}){
  const event=new Event('message');Object.assign(event,{data,source,origin});remote.host.dispatchEvent(event)
}
test('同一窗口重载开始到新Port握手完成之间，旧格式状态一律丢弃',async t=>{
  const remote=peer(t),status={channel:'cowart-film',type:'status',duration:3,currentTime:1,playing:false,muted:false}
  remote.reply({type:'ready',legacy:true})
  while(!remote.messages.some(message=>message.type==='legacy-poll'))await flush()
  const old=remote.connection.port,proxy=remote.iframe.contentWindow
  remote.reply({type:'close'})
  await flush();await flush()
  legacyWindow(remote,status)
  remote.iframe.dispatchEvent(new Event('load'))
  assert.equal(remote.iframe.contentWindow,proxy)
  legacyWindow(remote,status)
  await flush();await flush()
  assert.equal(remote.messages.filter(message=>message.type==='legacy-status').length,0)
  remote.reply({type:'ready',legacy:true})
  await flush();await flush()
  legacyWindow(remote,status)
  await flush();await flush()
  assert.equal(remote.messages.filter(message=>message.type==='legacy-status').length,1)
  old.close()
})
test('旧消息状态入口拒绝错误窗口/来源/旧实例/超大消息/未知字段，且不接命令',async t=>{
  const remote=peer(t),status={channel:'cowart-film',type:'status',duration:3,currentTime:1,playing:false,muted:false}
  remote.reply({type:'ready',legacy:true})
  while(!remote.messages.some(message=>message.type==='legacy-poll'))await flush()
  legacyWindow(remote,status,{source:{}})
  legacyWindow(remote,status,{origin:'http://'+'d'.repeat(48)+'.localhost:12345'})
  legacyWindow(remote,{...status,extra:'unknown'})
  legacyWindow(remote,{...status,currentTime:'x'.repeat(5000)})
  legacyWindow(remote,{...status,type:'command',command:'play'})
  await flush();await flush()
  assert.equal(remote.messages.filter(message=>message.type==='legacy-status').length,0)
  legacyWindow(remote,status)
  while(!remote.messages.some(message=>message.type==='legacy-status'))await flush()
  assert.deepEqual(remote.messages.find(message=>message.type==='legacy-status').value,status)
  const oldWindow=remote.iframe.contentWindow,oldPort=remote.connection.port
  remote.iframe.contentWindow={postMessage:oldWindow.postMessage}
  remote.iframe.dispatchEvent(new Event('load'))
  remote.reply({type:'ready',legacy:true})
  await flush();await flush()
  const count=remote.messages.filter(message=>message.type==='legacy-status').length
  legacyWindow(remote,status,{source:oldWindow})
  await flush();await flush()
  assert.equal(remote.messages.filter(message=>message.type==='legacy-status').length,count)
  oldPort.close()
})
test('旧消息状态入口每秒额度独立有界，销毁后不再转发窗口消息',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000})
  const remote=peer(t),status={channel:'cowart-film',type:'status',duration:3,currentTime:1,playing:false,muted:false}
  remote.reply({type:'ready',legacy:true})
  while(!remote.messages.some(message=>message.type==='legacy-poll'))await flush()
  for(let i=0;i<61;i++)legacyWindow(remote,status)
  await flush();await flush()
  assert.equal(remote.messages.filter(message=>message.type==='legacy-status').length,60)
  t.mock.timers.tick(1000);legacyWindow(remote,status)
  await flush();await flush()
  assert.equal(remote.messages.filter(message=>message.type==='legacy-status').length,61)
  remote.channel.dispose();legacyWindow(remote,status)
  await flush();await flush()
  assert.equal(remote.messages.filter(message=>message.type==='legacy-status').length,61)
})
