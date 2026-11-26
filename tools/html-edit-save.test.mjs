import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {htmlContentIdentity,mergeHtmlEditSnapshot} from '../src/htmlEditMerge.js'
import {createHtmlEditPersistence} from '../src/editor/htmlEditPersistence.js'

const draft={id:'shape:web',typeName:'shape',type:'embed',x:0,props:{url:'https://cowart.local/c/test/assets/a.html'},meta:{cowartHtmlDraftContentHash:'a'}}
const before={schema:{},store:{[draft.id]:draft}}
const clients=[()=>import('../src/cowartClient.js?edit-merge'),()=>import('../src/cowartClient.js?edit-conflict'),()=>import('../src/cowartClient.js?edit-off'),()=>import('../src/cowartClient.js?edit-target-change'),()=>import('../src/cowartClient.js')]
let clientIndex=0
async function fixture(t,{remote=before,initial=before,fail=true,readState}={}){
  const originalWindow=globalThis.window,calls=[]
  t.after(()=>{globalThis.window=originalWindow})
  let failed=false
  globalThis.window={openai:{toolOutput:{canvasDir:'synthetic-no-disk'}},cowartMcp:{async callServerTool({name,arguments:args}){
    calls.push({name,args})
    if(name==='get_cowart_canvas_state')return {structuredContent:readState?readState():{revision:calls.length===1?'r1':'r2',snapshot:calls.length===1?initial:remote}}
    assert.equal(name,'insert_cowart_html_draft')
    if(fail&&!failed){failed=true;return{isError:true,content:[{type:'text',text:'版本冲突'}],structuredContent:{storage:'revision-conflict'}}}
    return {structuredContent:{revision:'r3',previousRevision:args.expectedRevision,shapeId:draft.id,shapeRecord:{...remote.store[draft.id],meta:{cowartHtmlDraftContentHash:'saved'}}}}
  }}}
  const client=await clients[clientIndex++]()
  await client.loadCowartCanvasState()
  return{client,calls}
}
test('ON在冲突后读最新并合并，重试仍携带最新expectedRevision，保存后下一次接续新版本',async t=>{
  const remote={...before,store:{[draft.id]:{...draft,x:80}}},f=await fixture(t,{remote})
  let merged
  await f.client.updateCowartHtmlDraft({draftShapeId:draft.id,htmlContent:'<p>输入1</p>'},{expectedContent:await htmlContentIdentity(draft),async reconcile(latest,baseline){merged=await mergeHtmlEditSnapshot(baseline,latest,before,draft.id,await htmlContentIdentity(draft));return true},applyResult:()=>true})
  assert.equal(merged.store[draft.id].x,80)
  assert.deepEqual(f.calls.map(call=>[call.name,call.args.expectedRevision]),[['get_cowart_canvas_state',undefined],['insert_cowart_html_draft','r1'],['get_cowart_canvas_state',undefined],['insert_cowart_html_draft','r2']])
  await f.client.updateCowartHtmlDraft({draftShapeId:draft.id,htmlContent:'<p>输入2</p>'},{applyResult:()=>true})
  assert.equal(f.calls.at(-1).args.expectedRevision,'r3')
})
test('ON远端原文冲突先读最新，拒绝重试且不确认网页保存',async t=>{
  const remote={...before,store:{[draft.id]:{...draft,meta:{cowartHtmlDraftContentHash:'remote'}}}},f=await fixture(t,{remote})
  let applied=false
  await assert.rejects(f.client.updateCowartHtmlDraft({draftShapeId:draft.id,htmlContent:'<p>不能覆盖</p>'},{expectedContent:await htmlContentIdentity(draft),async reconcile(latest,baseline){await mergeHtmlEditSnapshot(baseline,latest,before,draft.id,await htmlContentIdentity(draft));return true},applyResult:()=>{applied=true}}),/网页内容/)
  assert.equal(f.calls.filter(call=>call.name==='insert_cowart_html_draft').length,1)
  assert.equal(f.calls.at(-1).name,'get_cowart_canvas_state')
  assert.equal(applied,false)
})
test('OFF不提供新选项时保持原有单次写入与冲突行为',async t=>{
  const f=await fixture(t)
  await assert.rejects(f.client.updateCowartHtmlDraft({draftShapeId:draft.id,htmlContent:'<p>旧版</p>'}),/版本冲突/)
  assert.deepEqual(f.calls.map(call=>call.name),['get_cowart_canvas_state','insert_cowart_html_draft'])
  assert.equal(f.calls.at(-1).args.expectedRevision,'r1')
})

test('计算内联身份期间切换画板，发送写请求前重验目标，不向新画板发旧HTML',async t=>{
  const html='<p>original</p>',bytes=new TextEncoder().encode(html),digest=await crypto.subtle.digest('SHA-256',bytes)
  const hash=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')
  const inline={...draft,props:{url:'data:text/html;base64,'+btoa(html)},meta:{cowartHtmlDraftAssetUrl:'/c/test/assets/a.html',cowartHtmlDraftContentHash:hash}}
  const initial={...before,store:{[draft.id]:inline}},f=await fixture(t,{initial,remote:initial,fail:false})
  const expectedContent=await htmlContentIdentity(inline)
  let release,entered
  const held=new Promise(resolve=>{entered=resolve})
  t.mock.method(crypto.subtle,'digest',()=>{entered();return new Promise(resolve=>{release=()=>resolve(digest)})})
  const saving=f.client.updateCowartHtmlDraft({draftShapeId:draft.id,htmlContent:'<p>draft-A</p>'},{expectedContent})
  saving.catch(()=>{})
  await held
  window.openai.toolOutput.canvasDir='synthetic-other-board'
  release()
  await assert.rejects(saving,/target changed/)
  assert.deepEqual(f.calls.map(call=>call.name),['get_cowart_canvas_state'])
})

test('合并摘要等待期间轮询推进到同外观新版本，应用旧快照之前拒绝，不回写旧位置',async t=>{
  const html='<p>original</p>',bytes=new TextEncoder().encode(html),digest=await crypto.subtle.digest('SHA-256',bytes)
  const hash=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')
  const web={...draft,props:{url:'http://cowart.local/c/test/assets/a.html'},meta:{cowartHtmlDraftAssetUrl:'/c/test/assets/a.html',cowartHtmlDraftContentHash:hash}}
  const initial={...before,store:{[draft.id]:web}},remote={...initial,store:{[draft.id]:{...web,x:20,props:{url:'data:text/html;base64,'+btoa(html)}}}}
  let reads=0
  const f=await fixture(t,{initial,remote,readState:()=>[{revision:'r1',snapshot:initial},{revision:'r2',snapshot:remote},{revision:'r3',snapshot:initial}][reads++]})
  let applied=0
  const editor={getShape:()=>web,store:{getStoreSnapshot:()=>initial,mergeRemoteChanges:()=>{applied++}}}
  const save=createHtmlEditPersistence(editor,draft.id,()=>true)
  let entered,release,blocked=false
  const held=new Promise(resolve=>{entered=resolve}),nativeDigest=crypto.subtle.digest.bind(crypto.subtle)
  t.mock.method(crypto.subtle,'digest',(...args)=>{if(blocked)return nativeDigest(...args);blocked=true;entered();return new Promise(resolve=>{release=()=>resolve(digest)})})
  const saving=save('<p>local draft</p>');saving.catch(()=>{})
  await held
  const polled=await f.client.refreshCowartCanvasSnapshot()
  f.client.acceptCowartCanvasSnapshot(polled)
  release()
  await assert.rejects(saving,/合并期间画板已变化/)
  assert.equal(applied,0)
  assert.equal(initial.store[draft.id].x,0)
  assert.equal(f.calls.filter(call=>call.name==='insert_cowart_html_draft').length,1)
})
