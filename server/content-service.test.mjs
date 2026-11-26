import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHiCanvasService} from './local-service.mjs'
import http from 'node:http'
const contentGet=url=>new Promise((resolve,reject)=>{
  const u=new URL(url);http.get({hostname:'127.0.0.1',port:u.port,path:u.pathname,headers:{host:u.host}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}))}).on('error',reject)
})
async function setup(t,enabled=false){
  const scratch=fileURLToPath(new URL('../.scratch/',import.meta.url));await mkdir(scratch,{recursive:true})
  const root=await mkdtemp(join(scratch,'content-host-')),distDir=join(root,'dist'),canvasDir=join(root,'canvas')
  await mkdir(distDir);await writeFile(join(distDir,'index.html'),'<h1>host</h1>')
  const service=createHiCanvasService({distDir,canvasDir,settingsDir:join(root,'settings'),contentHostEnabled:enabled})
  await new Promise(resolve=>service.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{service.closeAllConnections();await new Promise(resolve=>service.close(resolve));await rm(root,{recursive:true,force:true})})
  const base=`http://127.0.0.1:${service.address().port}`
  async function api(path,method='GET',body,headers={}){
    const response=await fetch(base+path,{method,headers:{'x-hicanvas-client':'1','content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)})
    return {status:response.status,body:await response.json()}
  }
  return {root,canvasDir,base,api,service}
}
test('开关默认关闭；开启后的启动信息提供运行时端口，只有父来源可登记和撤销',async t=>{
  const off=await setup(t)
  assert.deepEqual((await off.api('/api/health')).body.contentHost,{enabled:false})
  assert.equal((await off.api('/api/content-host/instances','POST',{html:'<h1>x</h1>'})).status,404)
  const on=await setup(t,true),health=(await on.api('/api/health')).body
  assert.equal(health.contentHost.enabled,true);assert.ok(health.contentHost.port)
  const denied=await on.api('/api/content-host/instances','POST',{html:'x'},{origin:'http://attacker.localhost:1'})
  assert.equal(denied.status,403)
  const created=await on.api('/api/content-host/instances','POST',{html:'<h1>x</h1>'})
  assert.equal(created.status,201)
  assert.equal((await contentGet(created.body.url)).text,'<h1>x</h1>')
  assert.equal((await on.api('/api/content-host/instances','DELETE',created.body)).status,200)
  assert.equal((await contentGet(created.body.url)).status,403)
})
test('仅发布本页授权素材及其CSS依赖，禁止越画板、路径和符号链接，直接HTML与SVG带沙箱',async t=>{
  const {root,canvasDir,api,base}=await setup(t,true)
  const {conversation}= (await api('/api/conversations/open','POST',{title:'synthetic'})).body
  const id=conversation.id,dir=join(canvasDir,'conversations',id,'assets'),prefix=`/c/${id}/assets/`
  await mkdir(dir,{recursive:true})
  for(const [name,text] of [['page.html','<h1>page</h1>'],['icon.svg','<svg xmlns="http://www.w3.org/2000/svg"/>'],['sheet.css','div{background:url("icon.svg")}'],['hidden.txt','not authorized']])await writeFile(join(dir,name),text)
  await writeFile(join(root,'private.txt'),'never published');await symlink(join(root,'private.txt'),join(dir,'escape.png'))
  const created=await api('/api/content-host/instances','POST',{html:'<link rel="stylesheet" href="sheet.css"><h1>x</h1>',sourceUrl:prefix+'page.html',conversationId:id})
  assert.equal(created.status,201)
  for(const name of ['sheet.css','icon.svg'])assert.equal((await contentGet(new URL(prefix+name,created.body.url))).status,200,name)
  assert.equal((await contentGet(new URL(prefix+'hidden.txt',created.body.url))).status,404)
  assert.equal((await api('/api/content-host/instances','POST',{html:'<img src="escape.png">',sourceUrl:prefix+'page.html',conversationId:id})).status,403)
  assert.equal((await api('/api/content-host/instances','POST',{html:'x',sourceUrl:'/c/another/assets/p.html',conversationId:id})).status,403)
  for(const name of ['page.html','icon.svg']){
    const response=await fetch(base+prefix+name)
    assert.equal(response.status,200)
    assert.match(response.headers.get('content-security-policy'),/sandbox/)
    assert.doesNotMatch(response.headers.get('content-security-policy'),/allow-same-origin/)
  }
})

test('关闭主服务同时停止内容端口',async t=>{
  const {service,api}=await setup(t,true)
  const created=await api('/api/content-host/instances','POST',{html:'<h1>close</h1>'})
  assert.equal((await contentGet(created.body.url)).status,200)
  service.closeAllConnections();await new Promise(resolve=>service.close(resolve))
  await assert.rejects(contentGet(created.body.url),e=>e.code==='ECONNREFUSED')
})
