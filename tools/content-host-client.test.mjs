import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as renderer from '../renderer/index.js'
const {loadGeneratedFrame}=renderer

globalThis.location={origin:'http://127.0.0.1:43300',search:''}
const instance={id:'a'.repeat(48),url:`http://${'a'.repeat(48)}.localhost:12345/document.html`,revokeToken:'b'.repeat(48),leaseMs:1800000}
function transport({afterPost,invalid=false,gist=false,override={}}={}){
  const calls=[]
  return {calls,async fetcher(url,options={}){
    calls.push({url,...options})
    if(url==='/api/health')return Response.json({contentHost:{port:12345}})
    if(url.startsWith('data:'))return new Response('<h1>decoded</h1>')
    if(options.method==='POST'){afterPost?.();return Response.json({...instance,...gist?{url:instance.url.replace('/document.html','/gist.html')}:{},...invalid?{url:'http://parent.invalid/document.html'}:{},...override})}
    return Response.json({ok:true})
  }}
}
test('Gist加载器只发送kind和ID，复用租约释放且不暴露通道绑定',async()=>{
  const on=transport({gist:true}),frame=await renderer.loadGistFrame('ABC012',{fetcher:on.fetcher})
  assert.deepEqual(JSON.parse(on.calls.find(call=>call.method==='POST').body),{kind:'gist',gistId:'abc012'})
  assert.deepEqual(frame.attributes,{src:instance.url.replace('/document.html','/gist.html'),sandbox:'allow-scripts allow-same-origin'})
  for(const name of ['bind','channel','edit','play','capture'])assert.equal(name in frame,false,name)
  await Promise.all([frame.dispose(),frame.dispose()])
  assert.equal(frame.disposed,true)
  assert.equal(on.calls.filter(call=>call.method==='DELETE').length,1)
})
test('Gist拒绝损坏/错代次/错来源发布描述并撤销，不泄露底层URL错误',async()=>{
  for(const override of [
    {url:'not-a-url'},{url:instance.url},{url:instance.url.replace('/document.html','/gist.html?extra=1')},
    {url:instance.url.replace('/document.html','/gist.html#fragment')},{id:'c'.repeat(48)},
    {revokeToken:'wrong'},{leaseMs:0},{leaseMs:1.5},{leaseMs:'1800000'},
  ]){
    const on=transport({gist:true,override})
    await assert.rejects(renderer.loadGistFrame('abc012',{fetcher:on.fetcher}),/内容宿主来源无效/)
    assert.equal(on.calls.filter(call=>call.method==='DELETE').length,1)
  }
})
test('Gist坏ID在请求前拒绝；登记取消后迟到实例撤销且不挂载',async()=>{
  const invalid=transport({gist:true})
  for(const id of ['abc.js','abc\n','a'.repeat(65),null])await assert.rejects(renderer.loadGistFrame(id,{fetcher:invalid.fetcher}),/Gist ID 无效/)
  assert.equal(invalid.calls.length,0)
  const abort=new AbortController(),cancelled=transport({gist:true,afterPost:()=>abort.abort()})
  await assert.rejects(renderer.loadGistFrame('abc012',{signal:abort.signal,fetcher:cancelled.fetcher}),{name:'AbortError'})
  assert.equal(cancelled.calls.filter(call=>call.method==='DELETE').length,1)
})

test('Gist续租失败只撤销一次，重复dispose不再续租',async t=>{
  t.mock.timers.enable({apis:['setInterval']})
  const on=transport({gist:true}),fetcher=async(url,options)=>options?.method==='PUT'?new Response('',{status:403}):on.fetcher(url,options)
  const failures=[]
  const frame=await renderer.loadGistFrame('abc012',{fetcher,onInvalidated:message=>failures.push(message)})
  t.mock.timers.tick(instance.leaseMs/2)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(frame.disposed,true)
  assert.deepEqual(failures,['内容实例已失效，请重新加载。'])
  assert.equal(on.calls.filter(call=>call.method==='DELETE').length,1)
  t.mock.timers.tick(instance.leaseMs*2)
  await frame.dispose()
  assert.equal(on.calls.filter(call=>call.method==='DELETE').length,1)
  assert.equal(failures.length,1)
})
test('生成网页只用内容实例，data URL解码后登记且卸载只撤销一次',async()=>{
  const on=transport(),frame=await loadGeneratedFrame(null,{directUrl:'data:text/html,hello',fetcher:on.fetcher})
  assert.equal(frame.disposed,false)
  assert.deepEqual(frame.attributes,{src:instance.url,sandbox:'allow-forms allow-popups allow-scripts allow-same-origin'})
  const registered=JSON.parse(on.calls.find(call=>call.method==='POST').body)
  assert.equal(registered.html,'<h1>decoded</h1>')
  await Promise.all([frame.dispose(),frame.dispose()])
  assert.equal(frame.disposed,true)
  assert.throws(()=>frame.bind({}),/内容实例已失效/)
  assert.equal(on.calls.filter(call=>call.method==='DELETE').length,1)
})
test('同页并发挂载共用启动信息，取消一个挂载不取消其余挂载的启动请求',async t=>{
  const original=transport(),abort=new AbortController()
  const continuations=[],healthSignals=[]
  const fetcher=async(url,options={})=>{
    if(url==='/api/health'){
      healthSignals.push(options.signal)
      await new Promise(resolve=>{continuations.push(resolve)})
    }
    return original.fetcher(url,options)
  }
  const cancelled=loadGeneratedFrame('cancelled',{fetcher,signal:abort.signal})
  const active=loadGeneratedFrame('active',{fetcher})
  abort.abort()
  for(const resume of continuations)resume()
  await assert.rejects(cancelled,{name:'AbortError'})
  const frame=await active
  t.after(()=>frame.dispose())
  for(const healthSignal of healthSignals)assert.notEqual(healthSignal,abort.signal)
  assert.equal(original.calls.filter(call=>call.url==='/api/health').length,1)
  assert.equal(original.calls.filter(call=>call.method==='POST').length,1)
  await frame.dispose()
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
  const oldLocation=globalThis.location;globalThis.location={...oldLocation,search:'?conversation=another-board'}
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
  assert.equal(active.disposed,true)
  t.mock.timers.tick(instance.leaseMs*2)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(failing.calls.filter(call=>call.method==='DELETE').length,1)
  assert.equal(renewals,1)
  await active.dispose()
})

test('发布未水合原文，保留本机图片地址供实例资源授权',async()=>{
  const original='<img src="/c/synthetic/assets/a.png">',hydrated='<img src="data:image/png;base64,AA==">'
  const on=transport(),frame=await loadGeneratedFrame(hydrated,{originalHtml:original,fetcher:on.fetcher})
  assert.equal(JSON.parse(on.calls.find(call=>call.method==='POST').body).html,original)
  await frame.dispose()
})

test('缺失或损坏启动描述及旧服务器均明确失败，绝不降级为同源加载',async()=>{
  for(const response of [new Response('',{status:404}),new Response('',{status:405}),Response.json({}),Response.json({contentHost:{}}),...[0,-1,65536,1.5,'12345'].map(port=>Response.json({contentHost:{port}}))]){
    const calls=[]
    const fetcher=async(url)=>{calls.push(url);return response}
    await assert.rejects(loadGeneratedFrame('<script>parent.document</script>',{fetcher}),/内容宿主|启动信息/)
    assert.deepEqual(calls,['/api/health'])
  }
})
