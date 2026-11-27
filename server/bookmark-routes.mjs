import { BookmarkError } from './bookmark-address.mjs'
import { createBookmarkFetcher } from './bookmark-fetch.mjs'
import { sendJson } from './protocol.mjs'

const messages = {
  invalid_request:'请求只能包含一个网址。', invalid_url:'网址无效，仅支持标准 HTTP 或 HTTPS 网址。',
  request_too_large:'网址请求超过大小限制。', unsupported_request_type:'需要 JSON 网址请求。',
  target_not_public:'只支持公开网络上的网址。', redirect_rejected:'网页跳转不符合安全规则。',
  redirect_limit:'网页跳转次数过多。', upstream_too_large:'网页响应超过大小限制。',
  unsupported_content_type:'该响应不是可读取的 HTML 网页。', unsupported_encoding:'网页使用了不支持的压缩编码。',
  invalid_html:'网页头部无法安全解析。', rate_limited:'刷新次数过多，请稍后重试。',
  metadata_busy:'正在读取其他网页，请稍后重试。', upstream_failed:'暂时无法读取网页信息。',
  metadata_timeout:'读取网页信息超时。',
}

function body(req,signal) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(req.headers['content-type'] || '')) throw new BookmarkError('unsupported_request_type',415)
  const length=req.headers['content-length']
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length)>12*1024)) throw new BookmarkError('request_too_large',413)
  return new Promise((resolve,reject)=>{
    const chunks=[]
    let bytes=0, ended=false
    const finish=(error,value)=>{
      if(ended)return
      ended=true;clearTimeout(timer)
      req.removeListener('data',data);req.removeListener('end',end);req.removeListener('error',errorEvent)
      signal.removeEventListener('abort',abort)
      if(error)reject(error);else resolve(value)
    }
    const data=chunk=>{
      bytes+=chunk.length
      if(bytes>12*1024)finish(new BookmarkError('request_too_large',413))
      else chunks.push(chunk)
    }
    const end=()=>{
      try {
        const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))
        if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==1 || !Object.hasOwn(value,'url')) throw new Error()
        finish(null,value.url)
      }catch{finish(new BookmarkError('invalid_request',400))}
    }
    const errorEvent=()=>finish(new BookmarkError('invalid_request',400))
    const abort=()=>finish(new BookmarkError('metadata_cancelled',499))
    const timer=setTimeout(()=>finish(new BookmarkError('metadata_timeout',504)),5000)
    req.on('data',data);req.once('end',end);req.once('error',errorEvent)
    signal.addEventListener('abort',abort,{once:true})
    if(signal.aborted)abort()
  })
}

// Parent middleware has already enforced BOTH local-read and client gates.
export function createBookmarkRoutes(options) {
  const fetcher=createBookmarkFetcher(options)
  const active=new Set()
  return {
    close(){for(const controller of active)controller.abort();fetcher.close()},
    async handle(req,res){
      const controller=new AbortController()
      const disconnected=()=>{if(!res.writableEnded)controller.abort()}
      req.once('aborted',disconnected);res.once('close',disconnected)
      active.add(controller)
      res.setHeader('cache-control','no-store')
      try {
        if(req.method!=='POST')throw new BookmarkError('invalid_request',405)
        const url=await body(req,controller.signal)
        const result=await fetcher.fetch(url,{signal:controller.signal})
        if(!controller.signal.aborted && !res.destroyed)sendJson(res,200,result)
      }catch(error){
        if(controller.signal.aborted || res.destroyed || error?.code==='metadata_cancelled')return res.destroy()
        const known=error instanceof BookmarkError && Object.hasOwn(messages,error.code)
        const code=known?error.code:'upstream_failed'
        const status=known?error.status:502
        if(status===429 || status===503)res.setHeader('retry-after',status===429?'60':'1')
        // Do not drain an unbounded slow/oversized body to keep a connection.
        res.setHeader('connection','close')
        res.once('finish',()=>{if(!req.complete)req.destroy()})
        sendJson(res,status,{error:{code,message:messages[code]}})
      }finally{
        req.removeListener('aborted',disconnected);res.removeListener('close',disconnected)
        active.delete(controller)
      }
    },
  }
}
