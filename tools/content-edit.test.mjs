import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {bindContentChannel,createContentEditorSession} from '../content-channel/index.js'

const turn=()=>new Promise(resolve=>setImmediate(resolve))
function peer(t){
  const host=new EventTarget(),iframe=new EventTarget(),messages=[]
  Object.assign(host,{MessageChannel})
  let connection
  iframe.ownerDocument={defaultView:host}
  iframe.contentWindow={postMessage(data,origin,ports){connection={data,port:ports[0]};connection.port.onmessage=event=>messages.push(event.data);connection.port.start()}}
  const instanceId='c'.repeat(48)
  const channel=bindContentChannel(iframe,{url:'http://'+instanceId+'.localhost:12345/document.html',instanceId})
  const reply=message=>{const {options,...base}=connection.data;connection.port.postMessage({...base,...message})}
  t.after(()=>{channel.dispose();connection.port.close()})
  reply({type:'ready'})
  return {channel,iframe,messages,reply,instanceId}
}
async function requestId(remote){
  for(let i=0;i<30;i++){const found=remote.messages.find(message=>message.type==='request');if(found)return found.id;await turn()}
  throw new Error('没有发出请求')
}
test('编辑快照超过普通4KiB仍可取回，垃圾回复不能占掉当前结果保留额度',async t=>{
  const remote=peer(t),html='<html><body>'+ '字'.repeat(3000)+'</body></html>'
  const result=remote.channel.request('edit-snapshot');result.catch(()=>{})
  const id=await requestId(remote)
  for(let i=0;i<125;i++)remote.reply({type:'invalid'})
  remote.reply({type:'edit-snapshot-result',id,value:{revision:7,savedRevision:4,html}})
  assert.deepEqual(await result,{revision:7,savedRevision:4,html})
})

const snapshot=(html,extra={})=>({revision:3,savedRevision:1,html,...extra})
const safe='<html><head></head><body><h1>草稿</h1></body></html>'
for(const [name,html] of [
  ['桥接脚本','<script src="/.hicanvas-channel/any/bootstrap.js"></script>'],
  ['实例编号','<p>'+ 'c'.repeat(48)+'</p>'],
  ['临时blob资源','<img src="blob:http://127.0.0.1:43385/temporary">'],
  ['内容宿主资源','<img src="http://'+ 'a'.repeat(48)+'.localhost:12345/c/test/assets/a.png">'],
  ['编辑标记','<p data-cowart-dom-editor-selected="true">字</p>'],
  ['截图运行层','<iframe data-hicanvas-capture-realm></iframe>'],
  ['UTF-8字节超限','<p>'+ '字'.repeat(Math.ceil(5*1024*1024/3))+'</p>'],
])test('拒绝保存残留或超限：'+name,async t=>{
  const remote=peer(t),result=remote.channel.request('edit-snapshot')
  result.catch(()=>{})
  const id=await requestId(remote)
  remote.reply({type:'edit-snapshot-result',id,value:snapshot(html)})
  await assert.rejects(result,/无效|上限|残留/)
})
test('错代、未知请求和重复大结果不进入保存，当前活跃请求最多接受一份',async t=>{
  const remote=peer(t),result=remote.channel.request('edit-snapshot')
  const id=await requestId(remote)
  remote.reply({type:'edit-snapshot-result',id,generation:'old',value:snapshot('<p>旧代</p>')})
  remote.reply({type:'edit-snapshot-result',id:'unknown',value:snapshot('<p>未知</p>')})
  remote.reply({type:'edit-snapshot-result',id,value:snapshot(safe)})
  remote.reply({type:'edit-snapshot-result',id,value:snapshot('<p>重复</p>')})
  assert.equal((await result).html,safe)
})
test('保存确认返回新版仍有修改的状态，并且不受普通垃圾回复挤占',async t=>{
  const remote=peer(t),result=remote.channel.request('edit-ack',3)
  const id=await requestId(remote)
  for(let i=0;i<125;i++)remote.reply({type:'invalid'})
  remote.reply({type:'edit-state-result',id,value:{revision:5,savedRevision:3,dirty:true}})
  assert.deepEqual(await result,{revision:5,savedRevision:3,dirty:true})
})
test('快照取消后等待结束回执才释放并发额度，重载拒绝在途结果',async t=>{
  const remote=peer(t),abort=new AbortController(),result=remote.channel.request('edit-snapshot',undefined,{signal:abort.signal})
  const id=await requestId(remote)
  abort.abort()
  await assert.rejects(result,{name:'AbortError'})
  await assert.rejects(remote.channel.request('edit-snapshot'),/忙/)
  remote.reply({type:'capture-end',id});await turn();await turn()
  const next=remote.channel.request('edit-snapshot');next.catch(()=>{})
  await turn();await turn()
  remote.iframe.dispatchEvent(new Event('load'))
  await assert.rejects(next,/失效/)
})

async function nextRequest(remote,offset=0){
  for(let i=0;i<100;i++){const requests=remote.messages.filter(message=>message.type==='request');if(requests[offset])return requests[offset];await turn()}
  throw new Error('缺少请求 '+offset)
}
const editState=(revision,savedRevision)=>({revision,savedRevision,dirty:revision>savedRevision})
async function editing(t,onSave,onState){
  const remote=peer(t),starting=createContentEditorSession(remote.iframe,{onSave,onState})
  const request=await nextRequest(remote)
  assert.equal(request.command,'edit-start')
  remote.reply({type:'edit-state-result',id:request.id,value:editState(0,0)})
  return {...remote,session:await starting}
}
test('保存途中继续输入，确认N版仍有修改后继续保存N+1；父页完全不解析HTML',async t=>{
  const saved=[]
  let release,entered
  const held=new Promise(resolve=>{entered=resolve})
  const remote=await editing(t,async html=>{saved.push(html);if(saved.length===1){entered();await new Promise(resolve=>{release=resolve})}})
  const saving=remote.session.flush()
  let request=await nextRequest(remote,1)
  remote.reply({type:'edit-snapshot-result',id:request.id,value:{revision:1,savedRevision:0,html:'<p>输入A</p>'}})
  await held
  // Child continues editing while the actual persistence boundary is held.
  release()
  request=await nextRequest(remote,2)
  assert.deepEqual([request.command,request.value],['edit-ack',1])
  remote.reply({type:'edit-state-result',id:request.id,value:editState(2,1)})
  request=await nextRequest(remote,3)
  remote.reply({type:'edit-snapshot-result',id:request.id,value:{revision:2,savedRevision:1,html:'<p>输入AB</p>'}})
  request=await nextRequest(remote,4)
  assert.deepEqual([request.command,request.value],['edit-ack',2])
  remote.reply({type:'edit-state-result',id:request.id,value:editState(2,2)})
  await saving
  assert.deepEqual(saved,['<p>输入A</p>','<p>输入AB</p>'])
})
test('确认与结束之间又有输入，原子结束拒绝丢弃该版并再次保存',async t=>{
  const saved=[],remote=await editing(t,html=>saved.push(html))
  const finishing=remote.session.finish()
  let request=await nextRequest(remote,1)
  remote.reply({type:'edit-snapshot-result',id:request.id,value:{revision:0,savedRevision:0,html:'<p>原文</p>'}})
  request=await nextRequest(remote,2)
  assert.equal(request.command,'edit-stop')
  remote.reply({type:'edit-state-result',id:request.id,value:editState(1,0)})
  request=await nextRequest(remote,3)
  remote.reply({type:'edit-snapshot-result',id:request.id,value:{revision:1,savedRevision:0,html:'<p>最后一字</p>'}})
  request=await nextRequest(remote,4)
  remote.reply({type:'edit-state-result',id:request.id,value:editState(1,1)})
  request=await nextRequest(remote,5)
  assert.equal(request.command,'edit-stop')
  remote.reply({type:'edit-state-result',id:request.id,value:editState(1,1)})
  await finishing
  assert.deepEqual(saved,['<p>最后一字</p>'])
})
test('写入失败不确认保存，保留会话供下一次重试',async t=>{
  let writes=0
  const remote=await editing(t,()=>{if(++writes===1)throw new Error('合成写入失败')})
  const failing=remote.session.flush();failing.catch(()=>{})
  let request=await nextRequest(remote,1)
  remote.reply({type:'edit-snapshot-result',id:request.id,value:{revision:1,savedRevision:0,html:'<p>草稿</p>'}})
  await assert.rejects(failing,/写入失败/)
  assert.ok(remote.messages.every(message=>message.command!=='edit-ack'))
  const retry=remote.session.flush()
  request=await nextRequest(remote,2)
  remote.reply({type:'edit-snapshot-result',id:request.id,value:{revision:1,savedRevision:0,html:'<p>草稿</p>'}})
  request=await nextRequest(remote,3)
  remote.reply({type:'edit-state-result',id:request.id,value:editState(1,1)})
  await retry
  assert.equal(writes,2)
})

test('畸形整页结果明确拒绝而不使Port处理器崩溃',async t=>{
  const remote=peer(t),result=remote.channel.request('edit-snapshot')
  result.catch(()=>{})
  const id=await requestId(remote)
  remote.reply({type:'edit-snapshot-result',id,value:5})
  await assert.rejects(result,/网页编辑数据无效/)
})

test('状态回调接收实际脏版本与持久化确认，供父页未保存退出保护使用',async t=>{
  const states=[],remote=await editing(t,()=>{},state=>states.push(state))
  assert.deepEqual(states,[editState(0,0)])
  remote.reply({type:'edit-status',value:editState(1,0)})
  await turn();await turn()
  assert.deepEqual(states.at(-1),editState(1,0))
  const saving=remote.session.flush()
  let request=await nextRequest(remote,1)
  remote.reply({type:'edit-snapshot-result',id:request.id,value:{revision:1,savedRevision:0,html:'<p>草稿</p>'}})
  request=await nextRequest(remote,2)
  remote.reply({type:'edit-state-result',id:request.id,value:editState(1,1)})
  await saving
  assert.deepEqual(states.at(-1),editState(1,1))
})
