import {parse} from '@babel/parser'
import {httpError} from './file-lock.mjs'

// Literal dependency enumeration, never a sanitizer. HTML raw-text contexts
// stay separate from JS; Babel supplies real import ranges, not prose matches.
function spans(text,{modules=false,kind='html'}={}){
  const result=[]
  const capture=(source,offset,patterns)=>{
    for(const pattern of patterns)for(const match of source.matchAll(pattern)){
      const index=match.slice(1).findIndex(value=>value!==undefined)+1
      result.push({start:offset+match.indices[index][0],end:offset+match.indices[index][1],raw:match[index]})
    }
  }
  const css=(source,offset)=>capture(source,offset,[/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/dgi,/@import\s+["']([^"']+)["']/dgi])
  const javascript=(source,offset)=>{
    if(!modules)return
    let tree
    try{tree=parse(source,{sourceType:'unambiguous',allowReturnOutsideFunction:true,createImportExpressions:true})}catch{return}
    const queue=[tree]
    while(queue.length){
      const node=queue.pop()
      if(!node||typeof node!=='object')continue
      const literal=['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type)?node.source:null
      if(literal?.type==='StringLiteral')result.push({start:offset+literal.start+1,end:offset+literal.end-1,raw:source.slice(literal.start+1,literal.end-1),decoded:literal.value,module:true})
      for(const value of Object.values(node))if(value&&typeof value==='object')Array.isArray(value)?queue.push(...value):queue.push(value)
    }
  }
  if(kind==='css')css(text,0)
  else if(kind==='javascript')javascript(text,0)
  else{
    const tokens=/<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|plaintext)\b((?:"[^"]*"|'[^']*'|[^'">])*?)>([\s\S]*?)(?:<\/\1\s*>|$)|<\/?[a-z][^\s/>]*(?:"[^"]*"|'[^']*'|[^'">])*>/dgi
    for(const token of text.matchAll(tokens)){
      if(token[0].startsWith('<!--')||token[0].startsWith('</'))continue
      const tag=(token[1]||token[0].match(/^<([^\s/>]+)/)[1]).toLowerCase(),header=token[1]?token[0].slice(0,token.indices[3][0]-token.index):token[0],attributes={}
      for(const match of header.matchAll(/\s([^\s/>=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/dg)){
        const name=match[1].toLowerCase(),index=match[2]!==undefined?2:match[3]!==undefined?3:4,raw=match[index]
        if(raw===undefined)continue
        attributes[name]=decode(raw)
        const start=token.index+match.indices[index][0],end=token.index+match.indices[index][1]
        if(['src','href','xlink:href','poster','data'].includes(name))result.push({start,end,raw,tag,attribute:name})
        if(name==='style')css(raw,start)
        if(name==='srcset')for(const item of raw.matchAll(/(?:^|,)\s*(data:[^\s]+|[^,\s]+)(?:\s+[^,]*)?/dg)){
          const value=item[1].replace(/,+$/,''),offset=start+item.indices[1][0];result.push({start:offset,end:offset+value.length,raw:value})
        }
      }
      if(tag==='style')css(token[3]||'',token.indices[3][0])
      if(tag==='script'&&!attributes.src&&(!attributes.type||/^(?:module|(?:text|application)\/(?:java|ecma)script)$/i.test(attributes.type)))javascript(token[3]||'',token.indices[3][0])
    }
  }
  return result.sort((a,b)=>a.start-b.start).filter((value,index,all)=>!index||value.start>=all[index-1].end)
}
const decode=value=>value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi,entity=>{
  const named={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'}
  if(named[entity.toLowerCase()])return named[entity.toLowerCase()]
  const number=entity.toLowerCase().startsWith('&#x')?parseInt(entity.slice(3,-1),16):Number(entity.slice(2,-1))
  return number>=0&&number<=0x10ffff?String.fromCodePoint(number):entity
})
export function contentBase(text,base){
  const ref=spans(text).find(item=>item.tag==='base'&&item.attribute==='href')
  try{return ref?new URL(decode(ref.raw),base).href:base}catch{return base}
}
export function contentReferences(text,options){return spans(text,options).filter(item=>item.tag!=='base').map(item=>item.decoded??decode(item.raw))}
export function rewriteContentReferences(text,rewrite,{maxBytes=Infinity,...options}={}){
  let bytes=Buffer.byteLength(text)
  if(bytes>maxBytes)throw httpError('离线资源展开超过32 MiB。',413)
  for(const item of spans(text,options).reverse()){
    const original=item.decoded??decode(item.raw),replacement=rewrite(original,item)
    if(replacement!==original){
      bytes+=Buffer.byteLength(replacement)-Buffer.byteLength(item.raw)
      if(bytes>maxBytes)throw httpError('离线资源展开超过32 MiB。',413)
      text=text.slice(0,item.start)+replacement+text.slice(item.end)
    }
  }
  return text
}
