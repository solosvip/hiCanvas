import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {htmlContentIdentity,mergeHtmlEditSnapshot} from '../src/htmlEditMerge.js'

const draft={id:'shape:web',typeName:'shape',type:'embed',x:0,props:{url:'https://cowart.local/c/test/assets/a.html',w:300,h:200},meta:{cowartHtmlDraft:true,cowartHtmlDraftContentHash:'a'}}
const other={id:'shape:other',typeName:'shape',type:'geo',x:0}
const state=(web=draft,extras={})=>({schema:{version:1},store:{[web.id]:web,[other.id]:other,...extras}})
test('不相交修改三方合并，远端位置与本地其他记录同时保留',async()=>{
  const latest=state({...draft,x:200}),current=state(draft,{[other.id]:{...other,x:50}})
  const merged=await mergeHtmlEditSnapshot(state(),latest,current,draft.id,await htmlContentIdentity(draft))
  assert.equal(merged.store[draft.id].x,200)
  assert.equal(merged.store[other.id].x,50)
})
test('远端改了同一网页原文或删除网页时拒绝覆盖，保留本地草稿',async()=>{
  for(const latest of [state({...draft,meta:{...draft.meta,cowartHtmlDraftContentHash:'remote'}}),{...state(),store:{[other.id]:other}}])await assert.rejects(async()=>mergeHtmlEditSnapshot(state(),latest,state(),draft.id,await htmlContentIdentity(draft)),/网页内容|删除/)
})
test('两边改同一记录不能强行覆盖，远端删记录也参与三方判断',async()=>{
  const latest=state(draft,{[other.id]:{...other,x:20}}),current=state(draft,{[other.id]:{...other,x:30}})
  await assert.rejects(async()=>mergeHtmlEditSnapshot(state(),latest,current,draft.id,await htmlContentIdentity(draft)),/冲突/)
  const deleted=state();delete deleted.store[other.id]
  await assert.rejects(async()=>mergeHtmlEditSnapshot(state(),deleted,current,draft.id,await htmlContentIdentity(draft)),/冲突/)
})

test('等价结构不受对象键顺序影响；仅经过内容哈希验证的内联和文件地址等价',async()=>{
  const html='<p>原文</p>',bytes=new TextEncoder().encode(html)
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('')
  const web={...draft,meta:{cowartHtmlDraftAssetUrl:'/c/test/assets/a.html',cowartHtmlDraftContentHash:digest}}
  const inline={...web,props:{...web.props,url:'data:text/html;base64,'+Buffer.from(html).toString('base64')}}
  assert.equal(await htmlContentIdentity(web),await htmlContentIdentity(inline))
  assert.notEqual(await htmlContentIdentity(web),await htmlContentIdentity({...inline,props:{...inline.props,url:'data:text/html;base64,'+btoa('foreign')}}))
  const before=state(web),latest={...state(inline),schema:{second:2,version:1}},current={...state(web),schema:{version:1,second:2}}
  before.schema=latest.schema
  await mergeHtmlEditSnapshot(before,latest,current,draft.id,await htmlContentIdentity(web))
})
