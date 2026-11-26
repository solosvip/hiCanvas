import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {bindContentChannel} from '../content-channel/index.js'

const flush=()=>new Promise(resolve=>setImmediate(resolve))
function peer(t,{respond=true,host=new EventTarget()}={}){
  const iframe=new EventTarget(),requests=[],portsSeen=[]
  Object.assign(host,{MessageChannel})
  iframe.ownerDocument={defaultView:host}
  let wire
  const reply=value=>{const {options,...base}=wire.data;wire.port.postMessage({...base,...value})}
  iframe.contentWindow={postMessage(data,_origin,ports){
    wire={data,port:ports[0]};portsSeen.push(wire.port)
    wire.port.onmessage=event=>{
      requests.push(event.data)
      if(!respond||event.data.type!=='request')return
      const value={width:2,height:2,pixels:Uint8Array.from([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]).buffer}
      reply(event.data.command==='capture'?{type:'capture-result',id:event.data.id,value}:{type:'response',id:event.data.id,ok:true,value:true})
    }
    wire.port.start();reply({type:'ready'})
  }}
  const instanceId='a'.repeat(48),channel=bindContentChannel(iframe,{instanceId,url:'http://'+instanceId+'.localhost:12345/document.html'})
  t.after(()=>{channel.dispose();for(const port of portsSeen)port.close()})
  return {channel,iframe,requests,reply}
}
test('实例截图通过Port回传完整RGBA像素，普通播放回复保持布尔值',{timeout:5000},async t=>{
  const {channel}=peer(t)
  const result=await channel.request('capture',{width:2,height:2,pixelRatio:1})
  assert.equal(result.width,2);assert.equal(result.height,2)
  assert.deepEqual([...new Uint8Array(result.pixels)],[255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255])
  assert.equal(await channel.request('play'),true)
})
async function nextRequest(remote,index=0){
  while(remote.requests.filter(value=>value.type==='request').length<=index)await flush()
  return remote.requests.filter(value=>value.type==='request')[index]
}
const pixels=(width=2,height=2,byteLength=width*height*4)=>({width,height,pixels:new ArrayBuffer(byteLength)})
test('截图超时后新请求成功，迟到旧像素不能结算新请求',{timeout:5000},async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const remote=peer(t,{respond:false})
  const first=remote.channel.request('capture',{width:2,height:2,pixelRatio:1},{timeout:10})
  const old=await nextRequest(remote)
  t.mock.timers.tick(10);await assert.rejects(first,/超时/)
  remote.reply({type:'capture-end',id:old.id});await flush();await flush()
  const second=remote.channel.request('capture',{width:2,height:2,pixelRatio:1})
  const fresh=await nextRequest(remote,1)
  let settled=false;second.then(()=>{settled=true})
  remote.reply({type:'capture-result',id:old.id,value:pixels()})
  await flush();await flush();assert.equal(settled,false)
  const wanted=pixels();new Uint8Array(wanted.pixels).fill(79)
  remote.reply({type:'capture-result',id:fresh.id,value:wanted})
  assert.equal(new Uint8Array((await second).pixels)[0],79)
})
test('像素长度、整数尺寸和导出上限严格验证，不能把二进制塞进普通回复',{timeout:5000},async t=>{
  const remote=peer(t,{respond:false})
  for(const [index,value] of [pixels(2,2,15),pixels(4097,1),pixels(4096,4096,0),pixels(1.5,2,12),pixels(1,2)].entries()){
    const task=remote.channel.request('capture',{width:2,height:2,pixelRatio:1})
    const request=await nextRequest(remote,index)
    remote.reply({type:'capture-result',id:request.id,value})
    await assert.rejects(task,/像素/)
  }
  for(const value of [{width:4097,height:1,pixelRatio:1},{width:4001,height:4000,pixelRatio:1},{width:2,height:2,pixelRatio:Infinity},{width:2,height:2,pixelRatio:1,execute:true}])await assert.rejects(remote.channel.request('capture',value),/参数/)
  const play=remote.channel.request('play'),request=await nextRequest(remote,5)
  remote.reply({type:'capture-result',id:request.id,value:pixels()})
  remote.reply({type:'response',id:request.id,ok:true,value:pixels()})
  remote.reply({type:'response',id:request.id,ok:true,value:true})
  assert.equal(await play,true)
})
test('每实例一张、整页两张截图，超额立即忙且取消释放额度',{timeout:5000},async t=>{
  const host=new EventTarget(),first=peer(t,{respond:false,host}),second=peer(t,{respond:false,host}),third=peer(t,{respond:false,host})
  const abort=new AbortController(),one=first.channel.request('capture',{width:2,height:2,pixelRatio:1},{signal:abort.signal})
  await nextRequest(first)
  await assert.rejects(first.channel.request('capture',{width:2,height:2,pixelRatio:1}),{code:'CHANNEL_BUSY'})
  const two=second.channel.request('capture',{width:2,height:2,pixelRatio:1})
  const other=await nextRequest(second)
  await assert.rejects(third.channel.request('capture',{width:2,height:2,pixelRatio:1}),{code:'CHANNEL_BUSY'})
  second.reply({type:'capture-result',id:other.id,value:pixels()});await two
  abort.abort();await assert.rejects(one,{name:'AbortError'})
  while(!first.requests.some(value=>value.type==='cancel'))await flush()
  const old=first.requests.find(value=>value.type==='request')
  first.reply({type:'capture-end',id:old.id});await flush();await flush()
  const again=first.channel.request('capture',{width:2,height:2,pixelRatio:1}),request=await nextRequest(first,1)
  first.reply({type:'capture-result',id:request.id,value:pixels()});await again
})
test('子页取消素材等待后不回传像素，并发超限直接报忙',{timeout:5000},async t=>{
  const {installContentChild}=await import('../content-channel/index.js')
  const host=new EventTarget(),parent={},images=[new EventTarget()]
  let renders=0,waiting=0,cleaned=0
  const add=images[0].addEventListener.bind(images[0]),remove=images[0].removeEventListener.bind(images[0])
  images[0].addEventListener=(...args)=>{waiting++;return add(...args)}
  images[0].removeEventListener=(...args)=>{cleaned++;return remove(...args)}
  host.parent=parent
  host.document={fonts:{ready:new Promise(()=>{})},images,documentElement:{get ownerDocument(){renders++;throw new Error('取消后不得开始渲染')}}}
  const receiver=installContentChild(host,{instanceId:'a'.repeat(48),parentOrigin:'http://127.0.0.1:43396'})
  const {port1,port2}=new MessageChannel(),messages=[]
  const base={protocol:1,instance:'a'.repeat(48),generation:'fresh'}
  port1.onmessage=event=>messages.push(event.data);port1.start()
  t.after(()=>{receiver.dispose();port1.close()})
  const event=new Event('message');Object.assign(event,{source:parent,origin:'http://127.0.0.1:43396',ports:[port2],data:{...base,type:'connect',options:{film:false,duration:15,muted:false}}});host.dispatchEvent(event)
  while(!messages.some(value=>value.type==='ready'))await flush()
  port1.postMessage({...base,type:'request',id:'first',command:'capture',value:{width:2,height:2,pixelRatio:1}})
  port1.postMessage({...base,type:'request',id:'second',command:'capture',value:{width:2,height:2,pixelRatio:1}})
  while(!messages.some(value=>value.id==='second'))await flush()
  assert.match(messages.find(value=>value.id==='second').error,/忙/)
  while(waiting<2)await flush()
  port1.postMessage({...base,type:'cancel',id:'first'})
  while(cleaned<2||!messages.some(value=>value.type==='capture-end'&&value.id==='first'))await flush()
  assert.equal(renders,0)
  assert.equal(messages.some(value=>value.id==='first'&&value.type!=='capture-end'),false)
  // Re-admission after abort proves the child released its capture slot.
  port1.postMessage({...base,type:'request',id:'third',command:'capture',value:{width:2,height:2,pixelRatio:1}})
  while(waiting<4)await flush()
  assert.equal(messages.some(value=>value.id==='third'),false)
  port1.postMessage({...base,type:'cancel',id:'third'})
  while(cleaned<4||!messages.some(value=>value.type==='capture-end'&&value.id==='third'))await flush()
  port1.postMessage({...base,type:'request',id:'fourth',command:'capture',value:{width:2,height:2,pixelRatio:1}})
  while(waiting<6)await flush()
  port1.postMessage({...base,type:'close'})
  while(!messages.some(value=>value.type==='capture-end'&&value.id==='fourth'))await flush()
  assert.equal(cleaned,6)
  assert.equal(messages.some(value=>value.id==='fourth'&&value.type!=='capture-end'),false)
})
test('取消不提前释放整页内存额度，等子页确认渲染停止才接下一张',{timeout:5000},async t=>{
  const host=new EventTarget(),one=peer(t,{respond:false,host}),two=peer(t,{respond:false,host}),three=peer(t,{respond:false,host})
  const abort=new AbortController()
  const first=one.channel.request('capture',{width:2,height:2,pixelRatio:1},{signal:abort.signal})
  const old=await nextRequest(one)
  const second=two.channel.request('capture',{width:2,height:2,pixelRatio:1})
  second.catch(()=>{})
  const other=await nextRequest(two)
  abort.abort();await assert.rejects(first,{name:'AbortError'})
  await assert.rejects(three.channel.request('capture',{width:2,height:2,pixelRatio:1},{timeout:20}),{code:'CHANNEL_BUSY'})
  one.reply({type:'capture-end',id:old.id});await flush();await flush()
  const third=three.channel.request('capture',{width:2,height:2,pixelRatio:1}),fresh=await nextRequest(three)
  two.reply({type:'capture-result',id:other.id,value:pixels()});await second
  three.reply({type:'capture-result',id:fresh.id,value:pixels()});await third
})
test('dispose但iframe仍存活时保留内存额度和结束回执', {timeout:5000}, async t=>{
  const host=new EventTarget(),one=peer(t,{respond:false,host}),two=peer(t,{respond:false,host}),three=peer(t,{respond:false,host})
  const first=one.channel.request('capture',{width:2,height:2,pixelRatio:1})
  const old=await nextRequest(one)
  const second=two.channel.request('capture',{width:2,height:2,pixelRatio:1});second.catch(()=>{})
  const other=await nextRequest(two)
  one.channel.dispose();await assert.rejects(first,/失效/)
  await assert.rejects(three.channel.request('capture',{width:2,height:2,pixelRatio:1},{timeout:20}),{code:'CHANNEL_BUSY'})
  one.reply({type:'capture-end',id:old.id});await flush();await flush()
  const third=three.channel.request('capture',{width:2,height:2,pixelRatio:1}),fresh=await nextRequest(three)
  two.reply({type:'capture-result',id:other.id,value:pixels()});await second
  three.reply({type:'capture-result',id:fresh.id,value:pixels()});await third
})

test('旧iframe真正完成新文档加载后释放已退休截图额度', {timeout:5000}, async t=>{
  const host=new EventTarget(),one=peer(t,{respond:false,host}),two=peer(t,{respond:false,host}),three=peer(t,{respond:false,host})
  const first=one.channel.request('capture',{width:2,height:2,pixelRatio:1})
  await nextRequest(one)
  const second=two.channel.request('capture',{width:2,height:2,pixelRatio:1});second.catch(()=>{})
  const other=await nextRequest(two)
  one.channel.dispose();await assert.rejects(first,/失效/)
  one.iframe.dispatchEvent(new Event('load'))
  const third=three.channel.request('capture',{width:2,height:2,pixelRatio:1}),fresh=await nextRequest(three)
  two.reply({type:'capture-result',id:other.id,value:pixels()});await second
  three.reply({type:'capture-result',id:fresh.id,value:pixels()});await third
})
test('活动iframe直接重载也回收旧文档额度，不等第二次load或旧回执', {timeout:5000}, async t=>{
  const host=new EventTarget(),one=peer(t,{respond:false,host}),two=peer(t,{respond:false,host}),three=peer(t,{respond:false,host})
  const first=one.channel.request('capture',{width:2,height:2,pixelRatio:1})
  await nextRequest(one)
  const second=two.channel.request('capture',{width:2,height:2,pixelRatio:1});second.catch(()=>{})
  const other=await nextRequest(two)
  one.iframe.dispatchEvent(new Event('load'));await assert.rejects(first,/失效/)
  const third=three.channel.request('capture',{width:2,height:2,pixelRatio:1},{timeout:20})
  third.catch(()=>{})
  // A busy rejection is the pre-fix failure, rather than waiting for a missing
  // Port message forever when no third request was admitted.
  await flush();await flush()
  if(!three.requests.some(value=>value.type==='request'))await third
  const fresh=await nextRequest(three)
  three.reply({type:'capture-result',id:fresh.id,value:pixels()});await third
  two.reply({type:'capture-result',id:other.id,value:pixels()});await second
})
test('父页恢复canvas后立即脱离像素缓冲，绘制失败也释放且移除能力登记', {timeout:5000}, async t=>{
  const {renderContentCapture,getContentChannel}=await import('../content-channel/index.js')
  const remote=peer(t),host=remote.iframe.ownerDocument.defaultView
  let view,drawn,fail=false
  const received=[],request=remote.channel.request
  remote.channel.request=async(...args)=>{const result=await request(...args);received.push(result.pixels);return result}
  host.ImageData=class{constructor(data,width,height){view=data;Object.assign(this,{data,width,height})}}
  const canvas={getContext:()=>fail?null:{putImageData(image){drawn=[...image.data]}}}
  remote.iframe.ownerDocument.createElement=()=>canvas
  assert.equal(getContentChannel(remote.iframe),remote.channel)
  assert.equal(await renderContentCapture(remote.iframe,{width:2,height:2,pixelRatio:1}),canvas)
  assert.equal(canvas.width,2);assert.equal(canvas.height,2)
  assert.equal(drawn.length,16);assert.equal(view.byteLength,0)
  fail=true
  await assert.rejects(renderContentCapture(remote.iframe,{width:2,height:2,pixelRatio:1}),/无法创建/)
  assert.equal(received.length,2);assert.ok(received.every(buffer=>buffer.byteLength===0))
  remote.channel.dispose();assert.equal(getContentChannel(remote.iframe),null)
})
