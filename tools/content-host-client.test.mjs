import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {loadGeneratedFrame} from '../renderer/index.js'

const instance={id:'a'.repeat(48),url:`http://${'a'.repeat(48)}.localhost:12345/document.html`,revokeToken:'b'.repeat(48),leaseMs:1800000}
function transport({enabled=true,afterPost,invalid=false}={}){
  const calls=[]
  return {calls,async fetcher(url,options={}){
    calls.push({url,...options})
    if(url==='/api/health')return Response.json({contentHost:enabled?{enabled:true,port:12345}:{enabled:false}})
    if(url.startsWith('data:'))return new Response('<h1>decoded</h1>')
    if(options.method==='POST'){afterPost?.();return Response.json({...instance,...invalid?{url:'http://parent.invalid/document.html'}:{}})}
    return Response.json({ok:true})
  }}
}
test('加载开关关闭保留srcdoc和data URL，开启只用内容实例且卸载只撤销一次',async()=>{
  const off=transport({enabled:false})
  const old=await loadGeneratedFrame('<h1>original</h1>',{fetcher:off.fetcher})
  assert.deepEqual(old.attributes,{srcDoc:'<h1>original</h1>'})
  const direct=await loadGeneratedFrame(null,{directUrl:'data:text/html,hello',fetcher:off.fetcher})
  assert.equal(direct.attributes.src,'data:text/html,hello')
  assert.equal(off.calls.filter(call=>call.method).length,0)
  const on=transport(),frame=await loadGeneratedFrame(null,{directUrl:'data:text/html,hello',fetcher:on.fetcher})
  assert.deepEqual(frame.attributes,{src:instance.url})
  const registered=JSON.parse(on.calls.find(call=>call.method==='POST').body)
  assert.equal(registered.html,'<h1>decoded</h1>')
  await Promise.all([frame.dispose(),frame.dispose()])
  assert.equal(on.calls.filter(call=>call.method==='DELETE').length,1)
})
test('异步登记期间卸载仍回收实例；拒绝错误宿主时也撤销已获得的能力',async()=>{
  const abort=new AbortController(),cancelled=transport({afterPost:()=>abort.abort()})
  await assert.rejects(loadGeneratedFrame('html',{fetcher:cancelled.fetcher,signal:abort.signal}),{name:'AbortError'})
  assert.equal(cancelled.calls.filter(call=>call.method==='DELETE').length,1)
  const invalid=transport({invalid:true})
  await assert.rejects(loadGeneratedFrame('html',{fetcher:invalid.fetcher}),/内容宿主来源无效/)
  assert.equal(invalid.calls.filter(call=>call.method==='DELETE').length,1)
})
test('旧全局素材来源不跟随当前画板参数，续租失败撤销并停止请求',async t=>{
  const oldLocation=globalThis.location;globalThis.location={search:'?conversation=another-board'}
  t.after(()=>{globalThis.location=oldLocation})
  const legacy=transport(),frame=await loadGeneratedFrame('html',{sourceUrl:'/assets/page.html',fetcher:legacy.fetcher})
  t.after(()=>frame.dispose())
  assert.equal(JSON.parse(legacy.calls.find(call=>call.method==='POST').body).conversationId,'legacy')
  await frame.dispose()
  t.mock.timers.enable({apis:['setInterval']})
  let renewals=0
  const failing=transport(),fetcher=async(url,options)=>{if(options?.method==='PUT'){renewals++;return new Response('',{status:403})}return failing.fetcher(url,options)}
  const active=await loadGeneratedFrame('html',{fetcher})
  t.mock.timers.tick(instance.leaseMs/2)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(failing.calls.filter(call=>call.method==='DELETE').length,1)
  t.mock.timers.tick(instance.leaseMs*2)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(failing.calls.filter(call=>call.method==='DELETE').length,1)
  assert.equal(renewals,1)
  await active.dispose()
})
