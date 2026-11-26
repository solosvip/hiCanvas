import {contentBase,contentReferences} from './content-references.mjs'
import {open,realpath} from 'node:fs/promises'
import {constants} from 'node:fs'
import {join,relative,sep,extname} from 'node:path'
import {httpError} from './file-lock.mjs'

const virtual='http://cowart.local'
const types={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.svg':'image/svg+xml','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.apng':'image/apng','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg'}
export function sandboxActiveAsset(res,type) {
  res.setHeader('x-content-type-options','nosniff')
  if(/^(?:text\/html|image\/svg\+xml)(?:;|$)/i.test(type)){
    // Successful authored resources may be framed, but never inherit this
    // service's origin. Errors retain the canvas's frame-denial headers.
    res.removeHeader('x-frame-options')
    res.setHeader('content-security-policy','sandbox allow-scripts allow-forms allow-popups')
  }
}
function localPath(value,base,parentOrigin,id) {
  let url
  try{url=new URL(value,base)}catch{return null}
  if(![virtual,'https://cowart.local',parentOrigin].includes(url.origin))return null
  let parts
  try{parts=url.pathname.split('/').slice(1).map(part=>decodeURIComponent(part))}catch{throw httpError('内容资源路径无效。',403)}
  const scoped=parts[0]==='c',actual=scoped?parts[1]:'legacy',tail=scoped?parts.slice(2):parts
  if(!['assets','page-assets'].includes(tail[0]))return null
  if(parts.some(part=>!part||part==='.'||part==='..'||/[\\/\0]/.test(part)))throw httpError('内容资源路径无效。',403)
  if(actual!==id||!(tail[0]==='assets'&&tail.length===2||tail[0]==='page-assets'&&tail.length===3))throw httpError('内容只能引用本画板的资源。',403)
  return {path:url.pathname,tail}
}
// This is a conservative literal-reference allowlist, not an HTML sanitizer.
// Missing/dynamic references are denied, never fetched or served by directory fallback.
function projectUrls(text,parentOrigin) {
  for(const origin of ['http://cowart.local','https://cowart.local',parentOrigin]) {
    text=text.replaceAll(origin+'/c/','/c/').replaceAll(origin+'/assets/','/assets/').replaceAll(origin+'/page-assets/','/page-assets/')
  }
  return text
}
export function createContentAssets(workspace,{maxFileBytes=20*1024*1024,maxBytes=32*1024*1024,maxFiles=128,recursiveText=false,preserveUrls=false}={}) {
  return async (html,{parentOrigin,sourceUrl,conversationId='legacy'})=>{
    const source=sourceUrl?localPath(sourceUrl,virtual+'/',parentOrigin,conversationId):null
    if(sourceUrl&&!source)throw httpError('内容来源不是本画板资源。',403)
    const path=source?.path||'/document.html',files=new Map(),queue=[],discovered=new Set()
    let size=Buffer.byteLength(html)
    const discover=(text,base,kind='html')=>{if(kind==='html')base=contentBase(text,base);for(const value of contentReferences(text,{modules:recursiveText,kind})){
      if(kind==='javascript'&&!/^(?:[./]|[a-z][a-z\d+.-]*:)/i.test(value))continue
      const ref=localPath(value,base,parentOrigin,conversationId)
      if(!ref||discovered.has(ref.path)||ref.path===path)continue
      if(discovered.size>=maxFiles)throw httpError('内容资源集合超过上限。',413)
      discovered.add(ref.path);queue.push(ref)
    }}
    discover(html,virtual+path)
    while(queue.length){
      if(files.size>=maxFiles||size>maxBytes)throw httpError('内容资源集合超过上限。',413)
      const ref=queue.shift(),storage=await workspace.storageFor(conversationId)
      const directory=ref.tail[0]==='assets'?join(storage.canvasDir,'assets'):join(storage.canvasDir,'pages',encodeURIComponent(ref.tail[1]),'assets')
      const base=await realpath(directory),target=await realpath(join(directory,ref.tail.at(-1)))
      const root=await realpath(storage.canvasDir),directoryDelta=relative(root,base)
      if(directoryDelta==='..'||directoryDelta.startsWith('..'+sep)||directoryDelta.startsWith(sep))throw httpError('内容资源目录不能指向画板外。',403)
      const delta=relative(base,target)
      if(!delta||delta.startsWith('..'+sep)||delta==='..'||delta.startsWith(sep))throw httpError('内容资源不能指向目录外。',403)
      const file=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW)
      let bytes
      try{
        const stat=await file.stat()
        if(!stat.isFile()||stat.size>maxFileBytes||size+stat.size>maxBytes)throw httpError('内容资源超过上限。',413)
        const buffer=Buffer.alloc(stat.size+1)
        let length=0
        while(length<buffer.length){const {bytesRead}=await file.read(buffer,length,buffer.length-length,length);if(!bytesRead)break;length+=bytesRead}
        if(length!==stat.size)throw httpError('读取期间内容资源发生变化。',409)
        bytes=buffer.subarray(0,length)
      }finally{await file.close()}
      const extension=extname(ref.path).toLowerCase(),type=types[extension]||'application/octet-stream'
      size+=bytes.length
      if(extension==='.css'||recursiveText&&['.js','.mjs','.html','.htm','.svg'].includes(extension)){
        const text=bytes.toString('utf8');files.set(ref.path,{bytes,type});discover(text,virtual+ref.path,extension==='.css'?'css':['.js','.mjs'].includes(extension)?'javascript':'html')
        bytes=Buffer.from(preserveUrls?text:projectUrls(text,parentOrigin))
      }
      files.set(ref.path,{bytes,type})
    }
    if(size>maxBytes)throw httpError('内容资源集合超过上限。',413)
    files.set(path,{bytes:Buffer.from(preserveUrls?html:projectUrls(html,parentOrigin)),type:'text/html; charset=utf-8'})
    return {path,files}
  }
}
