import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {bindContentChannel} from '../content-channel/index.js'
import {validMessage} from '../content-channel/protocol.js'
import {createSlideGate} from '../content-channel/slides.js'

const flush=()=>new Promise(resolve=>setImmediate(resolve))
function peer(t,slides=true){
  const host=new EventTarget(),iframe=new EventTarget(),instanceId='d'.repeat(48)
  host.MessageChannel=MessageChannel;iframe.ownerDocument={defaultView:host}
  let connection
  iframe.contentWindow={postMessage(data,origin,ports){connection={data,port:ports[0]};connection.port.start()}}
  const channel=bindContentChannel(iframe,{url:'http://'+instanceId+'.localhost:12345/document.html',instanceId,slides})
  const reply=extra=>{const {options,...base}=connection.data;connection.port.postMessage({...base,...extra})}
  t.after(()=>{channel.dispose();connection.port.close()})
  return {channel,iframe,reply,get connection(){return connection}}
}
test('翻页消息只接受方向，不接受页码、未知字段或旧代；每代只能翻一次',async t=>{
  const remote=peer(t),directions=[]
  remote.channel.subscribeNavigation(value=>directions.push(value))
  const {options,...base}=remote.connection.data
  for(const value of ['next','previous'])assert.equal(validMessage({...base,type:'slide-nav',value},base.instance,base.generation),true)
  for(const extra of [{value:1},{value:'last'},{page:99},{value:{direction:'next'}},{execute:'parent.fetch()'}])assert.equal(validMessage({...base,type:'slide-nav',value:'next',...extra},base.instance,base.generation),false)
  remote.reply({type:'slide-nav',value:'next'});await flush();await flush();assert.deepEqual(directions,[])
  remote.reply({type:'ready'});remote.reply({type:'slide-nav',value:'next',generation:'old'})
  for(let i=0;i<300;i++)remote.reply({type:'slide-nav',value:'next'})
  await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(directions,['next'])
  const old=remote.connection;remote.iframe.dispatchEvent(new Event('load'))
  old.port.postMessage({...base,type:'slide-nav',value:'previous'})
  remote.reply({type:'ready'});remote.reply({type:'slide-nav',value:'previous'})
  await flush();await flush();assert.deepEqual(directions,['next','previous']);old.port.close()
})
test('翻页消耗普通额度，未启用幻灯片的实例不能翻页',async t=>{
  for(const slides of [true,false]){
    const remote=peer(t,slides),directions=[];remote.channel.subscribeNavigation(value=>directions.push(value))
    remote.reply({type:'ready'})
    if(slides)for(let i=0;i<130;i++)remote.reply({type:'unknown'})
    remote.reply({type:'slide-nav',value:'next'})
    await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(directions,[])
  }
})
test('边界拒绝不消耗该页的有效翻页，成功后重复意图不能连跳',()=>{
  let index=0;const gate=createSlideGate(direction=>{const next=Math.max(0,Math.min(2,index+(direction==='next'?1:-1)));if(index===next)return false;index=next;return true})
  gate('previous');assert.equal(index,0);gate('next');assert.equal(index,1)
  for(let i=0;i<1000;i++)gate('next');assert.equal(index,1)
})
