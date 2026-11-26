import {createContentAssets} from './content-assets.mjs'
import {contentBase,rewriteContentReferences} from './content-references.mjs'
import {readChannelAssets} from './content-channel-assets.mjs'
import {httpError} from './file-lock.mjs'

const virtual='http://cowart.local',maxBytes=32*1024*1024
export async function prepareOfflineSlides(workspace,{pages,parentOrigin,conversationId}){
  if(!Array.isArray(pages)||!pages.length||pages.length>200)throw httpError('离线导出需要1至200页。')
  const prepare=createContentAssets(workspace,{recursiveText:true,preserveUrls:true}),externalResources=new Set(),prepared=[],completed=[]
  let total=0,outputBytes=0
  // Snapshot every page before assembling anything. This function never writes
  // files; the caller receives all complete pages or a single explicit failure.
  for(const page of pages){
    if(typeof page?.html!=='string'||!page.html.trim()||Buffer.byteLength(page.html)>5*1024*1024)throw httpError('幻灯片HTML为空或超过5 MiB。',413)
    const result=await prepare(page.html,{parentOrigin,sourceUrl:page.sourceUrl,conversationId})
    for(const file of result.files.values())total+=file.bytes.length
    if(total>maxBytes)throw httpError('整套离线幻灯片资源超过32 MiB。',413)
    prepared.push(result)
  }
  const script=new Map(await readChannelAssets()).get('offline-slides.js').toString('utf8')
  for(const snapshot of prepared){
    const cache=new Map(),visiting=new Set()
    const rewrite=(text,base,kind='html')=>{
      const resolvedBase=kind==='html'?contentBase(text,virtual+base):virtual+base
      return rewriteContentReferences(text,(value,ref)=>{
      if(ref.module&&!/^(?:[./]|[a-z][a-z\d+.-]*:)/i.test(value))return value
      if(!value||value.startsWith('#')||/^(?:data:|javascript:|mailto:|tel:|about:)/i.test(value))return value
      let url
      try{url=new URL(value,resolvedBase)}catch{throw httpError('离线资源地址无效。')}
      const local=[virtual,'https://cowart.local',parentOrigin].includes(url.origin)
      if(ref.tag==='base'&&local)return './'
      if(!local){
        if(['http:','https:'].includes(url.protocol)){
          if(/^(?:localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/.test(url.hostname))throw httpError('离线页面仍依赖本机服务。')
          externalResources.add(url.href)
        }
        return value
      }
      if(!snapshot.files.has(url.pathname))throw httpError('本机引用无法离线打包：'+url.pathname)
      return encode(url.pathname)+url.hash
    },{modules:true,kind,maxBytes:maxBytes-outputBytes})
    }
    function encode(path){
      if(cache.has(path))return cache.get(path)
      if(visiting.has(path))throw httpError('离线资源有循环引用，无法封装。')
      visiting.add(path)
      const file=snapshot.files.get(path),text=/^(?:text\/(?:css|javascript|html)|image\/svg\+xml)/.test(file.type)
      const bytes=text?Buffer.from(rewrite(file.bytes.toString('utf8'),path,file.type.startsWith('text/css')?'css':file.type.startsWith('text/javascript')?'javascript':'html')):file.bytes
      if(4*Math.ceil(bytes.length/3)+file.type.length+20>maxBytes)throw httpError('离线资源展开超过32 MiB。',413)
      const value='data:'+file.type.split(';')[0]+';base64,'+bytes.toString('base64')
      cache.set(path,value);visiting.delete(path);return value
    }
    const html=rewrite(snapshot.files.get(snapshot.path).bytes.toString('utf8'),snapshot.path)
    const bridge='<script>'+script.replaceAll('</script','<\\/script')+'</script>'
    const page=/^\s*<!doctype[^>]*>/i.test(html)?html.replace(/^(\s*<!doctype[^>]*>)/i,'$1'+bridge):bridge+html
    outputBytes+=Buffer.byteLength(page)
    if(outputBytes>maxBytes)throw httpError('整套离线幻灯片展开超过32 MiB。',413)
    completed.push(page)
  }
  return {pages:completed,playerScript:script,externalResources:[...externalResources].sort()}
}
