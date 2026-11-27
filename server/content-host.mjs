import {isolatedContentSandbox} from '../content-channel/index.js'
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { httpError } from './file-lock.mjs'
import {readChannelAssets} from './content-channel-assets.mjs'

// Read-only, disposable publications; no canvas API, file system or network proxy.
export function createContentHost({now=Date.now,ttl=30*60*1000,maxHtmlBytes=5*1024*1024,maxTotalBytes=128*1024*1024,maxInstances=64,prepare=async html=>({path:'/document.html',files:new Map([['/document.html',{bytes:Buffer.from(html),type:'text/html; charset=utf-8'}]])})} = {}) {
  const instances=new Map()
  let listening,closed=false,usedBytes=0,preparing=0
  function remove(instance) { if(instances.delete(instance.hostname)) usedBytes-=instance.size }
  function sweep() { for(const instance of instances.values()) if(instance.expiresAt<=now())remove(instance) }
  const timer=setInterval(sweep,Math.min(ttl,60000));timer.unref()
  const server=createServer((req,res)=>{
    sweep()
    const instance=instances.get(req.headers.host)
    if(!instance){res.writeHead(403).end();return}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return}
    let path
    try{path=new URL(req.url,'http://localhost').pathname}catch{res.writeHead(400).end();return}
    const file=instance.files.get(path)
    if(!file){res.writeHead(404).end();return}
    const sandbox=isolatedContentSandbox(`http://${instance.hostname}`,{port:server.address().port,parentOrigin:instance.parentOrigin})
    res.writeHead(200,{'content-type':file.type,'content-length':file.bytes.length,'cache-control':'no-store','content-security-policy':`sandbox ${sandbox}; frame-ancestors ${instance.parentOrigin} 'self'`,'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin'})
    res.end(req.method==='HEAD'?undefined:file.bytes)
  })
  async function info() {
    if(closed)throw httpError('内容宿主已关闭。',503)
    listening ||= new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
    await listening
    return {port:server.address().port,leaseMs:ttl}
  }
  function authorize(id,token) {
    sweep()
    const instance=[...instances.values()].find(value=>value.id===id)
    const supplied=typeof token==='string'?Buffer.from(token):Buffer.alloc(0)
    if(!instance||supplied.length!==Buffer.byteLength(instance.revokeToken)||!timingSafeEqual(supplied,Buffer.from(instance.revokeToken)))throw httpError('内容实例已失效。',403)
    return instance
  }
  return {
    info,
    async register({html,parentOrigin,...context}) {
      if(typeof html!=='string'||!html.trim())throw httpError('需要非空HTML。')
      if(Buffer.byteLength(html)>maxHtmlBytes)throw httpError('HTML超过内容宿主上限。',413)
      if(typeof parentOrigin!=='string'||!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(parentOrigin))throw httpError('父窗口来源无效。',403)
      if(preparing>=4)throw httpError('内容宿主登记繁忙，请稍后重试。',429)
      preparing++
      try {
      const {port}=await info()
      const prepared=await prepare(html,{...context,parentOrigin})
      const assets=await readChannelAssets()
      // Editing restores authored resource spellings inside the content realm.
      // Its immutable original is instance-local plain text, charged to the
      // same user-content memory budget; it is never fetched by the parent.
      const editSource=Buffer.from(html)
      const size=[...prepared.files.values()].reduce((sum,file)=>sum+file.bytes.length,0)+editSource.length
      sweep()
      if(closed)throw httpError('内容宿主已关闭。',503)
      if(instances.size>=maxInstances||size+usedBytes>maxTotalBytes)throw httpError('内容宿主容量已满。',413)
      const id=randomBytes(24).toString('hex'),hostname=`${id}.localhost:${port}`,revokeToken=randomBytes(24).toString('hex')
      const prefix='/.hicanvas-channel/'+id+'/',files=new Map(prepared.files)
      files.set(prefix+'edit-source.txt',{bytes:editSource,type:'text/plain; charset=utf-8'})
      for(const [name,bytes] of assets)files.set(prefix+name,{bytes,type:'text/javascript; charset=utf-8'})
      const document=files.get(prepared.path)
      const source=prefix+'bootstrap.js?instance='+id+'&parent='+encodeURIComponent(parentOrigin)
      const script=`<script type="module" src="${source}"></script>`
      const original=document.bytes.toString('utf8')
      const injected=/^\s*<!doctype[^>]*>/i.test(original)?original.replace(/^(\s*<!doctype[^>]*>)/i,'$1'+script):script+original
      files.set(prepared.path,{...document,bytes:Buffer.from(injected)})
      // User-content quota is unchanged. The finite bridge is shared host code.
      const instance={id,hostname,parentOrigin,revokeToken,files,size,expiresAt:now()+ttl}
      instances.set(hostname,instance);usedBytes+=size
      return {id,url:`http://${hostname}${prepared.path}`,revokeToken,expiresAt:instance.expiresAt,leaseMs:ttl}
      }finally{preparing--}
    },
    revoke(id,token){remove(authorize(id,token))},
    renew(id,token){const instance=authorize(id,token);instance.expiresAt=now()+ttl;return {expiresAt:instance.expiresAt}},
    async close(){if(closed)return;closed=true;clearInterval(timer);instances.clear();usedBytes=0;if(listening){await listening;server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}}
  }
}
