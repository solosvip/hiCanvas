import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createContentHost } from './content-host.mjs'

const request = (url, host) => new Promise((resolve, reject) => {
  const parsed = new URL(url)
  const req = http.get({hostname:'127.0.0.1',port:parsed.port,path:parsed.pathname,headers:{host:host||parsed.host}}, res => {
    const parts=[];res.on('data',x=>parts.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(parts).toString()}))
  });req.on('error',reject)
})
test('内容宿主按实例登记不同来源，仅发布文档并可立即撤销', async t => {
  const host=createContentHost()
  t.after(()=>host.close())
  const one=await host.register({html:'<h1>one</h1>',parentOrigin:'http://127.0.0.1:43218'})
  const two=await host.register({html:'<h1>two</h1>',parentOrigin:'http://127.0.0.1:43218'})
  assert.notEqual(new URL(one.url).hostname,new URL(two.url).hostname)
  assert.match(new URL(one.url).hostname,/^[a-f0-9]{48}\.localhost$/)
  assert.ok(new URL(one.url).port)
  assert.ok((await request(one.url)).text.endsWith('<h1>one</h1>'))
  assert.equal((await request(one.url,'not-registered.localhost:'+new URL(one.url).port)).status,403)
  assert.equal((await request(new URL('/api/canvas',one.url))).status,404)
  host.revoke(one.id,one.revokeToken)
  assert.equal((await request(one.url)).status,403)
  assert.equal((await request(two.url)).status,200)
})
test('实例脚本只发布固定白名单，别的实例路径、穿越和白名单外均不可读',async t=>{
  const host=createContentHost();t.after(()=>host.close())
  const one=await host.register({html:'<!doctype html><h1>channel</h1>',parentOrigin:'http://127.0.0.1:43218'})
  const two=await host.register({html:'two',parentOrigin:'http://127.0.0.1:43218'})
  const page=await request(one.url)
  assert.ok(page.text.startsWith('<!doctype html><script type="module"'))
  const script=page.text.match(/src="([^"]+)"/)[1]
  const bootstrap=await request(new URL(script,one.url))
  assert.equal(bootstrap.status,200)
  assert.match(bootstrap.headers['content-type'],/^text\/javascript/)
  assert.match(bootstrap.text,/installContentChild/)
  assert.equal((await request(new URL(script,two.url))).status,404)
  for(const path of ['index.js','parent.js','../../server/content-host.mjs','%2e%2e%2f%2e%2e%2fserver/content-host.mjs']){
    assert.equal((await request(new URL('/.hicanvas-channel/'+one.id+'/'+path,one.url))).status,404,path)
  }
})
test('实例到期不可读取或复活，资源和总量受限，管理能力不能伪造', async t => {
  let clock=100
  const host=createContentHost({now:()=>clock,ttl:50,maxHtmlBytes:30,maxTotalBytes:60,maxInstances:2})
  t.after(()=>host.close())
  await assert.rejects(host.register({html:'x'.repeat(31),parentOrigin:'http://127.0.0.1:43218'}),e=>e.status===413)
  const one=await host.register({html:'<p>one</p>',parentOrigin:'http://127.0.0.1:43218'})
  assert.throws(()=>host.revoke(one.id,'wrong'),e=>e.status===403)
  assert.equal((await request(one.url)).status,200)
  clock=151
  assert.equal((await request(one.url)).status,403)
  assert.throws(()=>host.renew(one.id,one.revokeToken),e=>e.status===403)
})
test('登记受实例数和宿主总字节限制，撤销后容量可复用',async t=>{
  const parentOrigin='http://127.0.0.1:43218'
  const count=createContentHost({maxInstances:1}),bytes=createContentHost({maxTotalBytes:16})
  t.after(()=>count.close());t.after(()=>bytes.close())
  const one=await count.register({html:'one',parentOrigin})
  await assert.rejects(count.register({html:'two',parentOrigin}),e=>e.status===413)
  count.revoke(one.id,one.revokeToken)
  assert.ok((await count.register({html:'two',parentOrigin})).url)
  await bytes.register({html:'12345',parentOrigin})
  await assert.rejects(bytes.register({html:'6789',parentOrigin}),e=>e.status===413)
})

test('编辑原文是每实例固定纯文本，保留资源原址且计入总内存',async t=>{
  const parentOrigin='http://127.0.0.1:43218',html='<img src="http://cowart.local/assets/sample.png">'
  const host=createContentHost({prepare:async text=>({path:'/document.html',files:new Map([['/document.html',{bytes:Buffer.from(text.replace('http://cowart.local','')),type:'text/html'}]])})})
  t.after(()=>host.close())
  const one=await host.register({html,parentOrigin}),two=await host.register({html:'two',parentOrigin})
  const path='/.hicanvas-channel/'+one.id+'/edit-source.txt'
  const original=await request(new URL(path,one.url))
  assert.equal(original.text,html)
  assert.match(original.headers['content-type'],/^text\/plain/)
  assert.equal(original.headers['x-content-type-options'],'nosniff')
  assert.equal((await request(new URL(path,two.url))).status,404)
  const limited=createContentHost({maxTotalBytes:9});t.after(()=>limited.close())
  await assert.rejects(limited.register({html:'12345',parentOrigin}),e=>e.status===413)
  host.revoke(one.id,one.revokeToken)
  assert.equal((await request(new URL(path,one.url))).status,403)
})

test('成功续租可跨过原到期点，新的到期时间仍会回收',async t=>{
  let clock=100
  const host=createContentHost({now:()=>clock,ttl:50});t.after(()=>host.close())
  const one=await host.register({html:'lease',parentOrigin:'http://127.0.0.1:43218'})
  clock=125;assert.equal(host.renew(one.id,one.revokeToken).expiresAt,175)
  clock=151;assert.equal((await request(one.url)).status,200)
  clock=176;assert.equal((await request(one.url)).status,403)
})

test('并发登记不能在异步通道准备期间超出实例配额',async t=>{
  const host=createContentHost({maxInstances:1});t.after(()=>host.close())
  const attempts=await Promise.allSettled(['one','two'].map(html=>host.register({html,parentOrigin:'http://127.0.0.1:43396'})))
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1)
  assert.equal(attempts.find(result=>result.status==='rejected')?.reason.status,413)
})
