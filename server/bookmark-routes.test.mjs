import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { Duplex } from 'node:stream'
import { createCanvasMiddleware } from './routes.mjs'

async function setup(hang = false) {
  let resolutions=0, connections=0, cancellations=0, storageCalls=0
  const boundary={
    createResolver:()=>({resolve4:async()=>{resolutions++;return hang ? new Promise(()=>{}) : ['8.8.8.8']},resolve6:async()=>[],cancel:()=>{cancellations++}}),
    connectTcp(){throw new Error('HTTP not used')},
    connectTls(config) {
      connections++
      const socket=new Duplex({read(){},write(_chunk,_encoding,callback){
        const body='<head><title>Result</title><meta name=description content="plain &amp; safe"></head>'
        queueMicrotask(()=>{socket.push(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);socket.push(null)})
        callback()
      }})
      Object.assign(socket,{remoteAddress:config.host,remotePort:config.port,authorized:true,getPeerCertificate:()=>({subjectaltname:'DNS:site.example.net'})})
      socket.setKeepAlive=socket.setNoDelay=socket.setTimeout=()=>socket
      queueMicrotask(()=>socket.emit('secureConnect'))
      return socket
    },
  }
  const workspace=new Proxy({root:'/unused-bookmark-workspace'}, {get(target,key){if(key in target)return target[key];return()=>{storageCalls++;throw new Error('Storage must not be accessed')}}})
  const middleware=createCanvasMiddleware({workspace,bookmarkOptions:{boundary}})
  const server=createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end()}))
  server.listen(0,'127.0.0.1');await once(server,'listening')
  const port=server.address().port
  return {port, base:`http://127.0.0.1:${port}`, get counts(){return {resolutions,connections,cancellations,storageCalls}},
    async close(){await middleware.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))} }
}
async function call(f,body={url:'https://site.example.net/'},headers={},method='POST') {
  return await new Promise((resolve,reject)=>{
    const request=httpRequest(f.base+'/api/bookmark/metadata',{method,headers:{'x-hicanvas-client':'1','content-type':'application/json',...headers}},response=>{
      let data='';response.setEncoding('utf8');response.on('data',chunk=>{data+=chunk})
      response.on('end',()=>{try{resolve({response:{status:response.statusCode,headers:{get:name=>response.headers[name]??null}},body:JSON.parse(data)})}catch(error){reject(error)}})
    })
    request.on('error',reject)
    request.end(method==='GET'?undefined:typeof body==='string'?body:JSON.stringify(body))
  })
}

test('real parent middleware returns only metadata without reading or writing a board',async()=>{
  const f=await setup()
  try {
    const {response,body}=await call(f)
    assert.equal(response.status,200)
    assert.equal(response.headers.get('cache-control'),'no-store')
    assert.equal(response.headers.get('access-control-allow-origin'),null)
    assert.deepEqual(body,{title:'Result',description:'plain & safe',url:'https://site.example.net/'})
    assert.deepEqual(f.counts,{resolutions:1,connections:1,cancellations:0,storageCalls:0})
  } finally {await f.close()}
})

test('unchanged parent gates reject foreign Host/Origin, cross-site and missing identity before DNS',async()=>{
  const f=await setup()
  try {
    for(const headers of [{host:'evil.net'},{origin:'https://evil.net'},{origin:'http://content.localhost:9999'},
      {'sec-fetch-site':'cross-site'},{'x-hicanvas-client':''}]) assert.equal((await call(f,undefined,headers)).response.status,403)
    assert.equal(f.counts.resolutions,0)
    assert.equal(f.counts.connections,0)
    assert.equal(f.counts.storageCalls,0)
  }finally{await f.close()}
})

test('URL-only JSON contract enforces byte limit, media type and consistent public errors',async()=>{
  const f=await setup()
  try {
    for(const [body,headers,status,code] of [
      [{url:'https://site.example.net/',allowPrivate:true},{},400,'invalid_request'],
      [{url:'https://site.example.net/',headers:{Cookie:'secret'}},{},400,'invalid_request'],
      [[],{},400,'invalid_request'], ['{',{},400,'invalid_request'],
      [{url:'https://site.example.net/'},{'content-type':'text/plain'},415,'unsupported_request_type'],
      [' '.repeat(12289),{},413,'request_too_large'],
      [JSON.stringify({url:'https://site.example.net/'+ '好'.repeat(4100)}),{},413,'request_too_large'],
      [{url:'http://127.0.0.1/secret'}, {},422,'target_not_public'],
      [{url:'file:///secret'}, {},400,'invalid_url'],
    ]) {
      const result=await call(f,body,headers)
      assert.equal(result.response.status,status)
      assert.equal(result.body.error.code,code)
      assert.doesNotMatch(JSON.stringify(result.body),/\/secret|Cookie|allowPrivate/)
    }
    assert.equal(f.counts.resolutions,0)
    assert.equal(f.counts.storageCalls,0)
    assert.equal((await call(f,undefined,{},'GET')).response.status,405)
  }finally{await f.close()}
})

test('client disconnect cancels DNS, normal request body end does not',async()=>{
  const f=await setup(true)
  try {
    const request=httpRequest(f.base+'/api/bookmark/metadata',{method:'POST',headers:{'x-hicanvas-client':'1','content-type':'application/json'}})
    request.on('error',()=>{})
    request.end(JSON.stringify({url:'https://site.example.net/'}))
    for(let n=0; n<100 && !f.counts.resolutions; n++) await new Promise(resolve=>setTimeout(resolve,5))
    assert.equal(f.counts.resolutions,1)
    assert.equal(f.counts.cancellations,0)
    request.destroy()
    for(let n=0; n<100 && !f.counts.cancellations; n++) await new Promise(resolve=>setTimeout(resolve,5))
    assert.equal(f.counts.cancellations,1)
    assert.equal(f.counts.connections,0)
  }finally{await f.close()}
})
