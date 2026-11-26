// File-backed HTML is returned inline by HTTP commands, while the mounted
// legacy shape uses cowart.local. Treat those as equivalent only after checking
// the inline bytes against the stored hash; stale metadata cannot hide a change.
export async function htmlContentIdentity(record){
  const asset=record?.meta?.cowartHtmlDraftAssetUrl,hash=record?.meta?.cowartHtmlDraftContentHash
  let url=record?.props?.url
  if(asset&&hash&&typeof url==='string'){
    if(url==='http://cowart.local'+asset||url==='https://cowart.local'+asset||url===asset)url=asset
    else if(/^data:text\/html(?:;[^,]*)?,/i.test(url)){
      try{
        const comma=url.indexOf(','),header=url.slice(0,comma),data=url.slice(comma+1)
        const bytes=/;base64$/i.test(header)?Uint8Array.from(atob(data),char=>char.charCodeAt(0)):new TextEncoder().encode(decodeURIComponent(data))
        const digest=await crypto.subtle.digest('SHA-256',bytes)
        const actual=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')
        if(actual===hash)url=asset
      }catch{/* Invalid inline content keeps its distinct identity. */}
    }
  }
  return JSON.stringify([record?.type,url,asset,hash])
}
// Object insertion order is not a schema/record change; arrays remain ordered.
const same=(a,b)=>{
  if(a===b)return true
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false
  const keys=Object.keys(a)
  return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]))
}
export async function mergeHtmlEditSnapshot(baseline,latest,current,draftId,expectedContent){
  if(!baseline?.store||!latest?.store||!current?.store||!same(baseline.schema,latest.schema)||!same(baseline.schema,current.schema))throw new Error('画板结构已变化，网页草稿仍保留，请先处理冲突。')
  if(!latest.store[draftId])throw new Error('网页已被删除，当前网页草稿仍保留。')
  if(await htmlContentIdentity(latest.store[draftId])!==expectedContent)throw new Error('网页内容已被其他窗口修改，当前网页草稿仍保留，请先合并。')
  const comparable=async record=>record&&await htmlContentIdentity(record)===expectedContent?{...record,props:{...record.props,url:expectedContent}}:record
  const targetBefore=await comparable(baseline.store[draftId]),targetRemote=await comparable(latest.store[draftId]),targetLocal=await comparable(current.store[draftId])
  const store={}
  for(const id of new Set([...Object.keys(baseline.store),...Object.keys(latest.store),...Object.keys(current.store)])){
    const before=baseline.store[id],remote=latest.store[id],local=current.store[id]
    const [a,b,c]=id===draftId?[targetBefore,targetRemote,targetLocal]:[before,remote,local]
    const changedLocal=!same(a,c),changedRemote=!same(a,b)
    if(changedLocal&&changedRemote&&!same(c,b))throw new Error('画板有重叠修改，网页草稿仍保留，请先处理冲突。')
    const record=changedLocal?local:remote
    if(record)store[id]=record
  }
  return {...latest,store}
}
