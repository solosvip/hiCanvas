import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {runInNewContext} from 'node:vm'
import {build} from 'esbuild'
import {loadGeneratedFrame} from '../renderer/index.js'

globalThis.location={origin:'http://127.0.0.1:43300',search:''}

// Bundle only the production load-handler export; unused UI/SDK imports are
// excluded, without replacing the content host or its message channel.
const bundled=await build({stdin:{contents:"export {createSlidesFrameLoadHandler} from './src/editor/slidesMedia.jsx'",resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'iife',globalName:'slidesMedia',platform:'node',jsx:'transform',plugins:[{name:'unused-ui-imports',setup(builder){builder.onResolve({filter:/.*/},args=>args.importer.endsWith('/slidesMedia.jsx')?{path:args.path,external:true,sideEffects:false}:undefined)}}]})
const {createSlidesFrameLoadHandler}=runInNewContext(bundled.outputFiles[0].text+';slidesMedia',{})
let sequence=0
async function page(t){
  const id=(++sequence).toString(16).padStart(48,'0')
  const frame=await loadGeneratedFrame('<h1>synthetic slide</h1>',{conversationId:'synthetic',fetcher:async(url,options)=>url==='/api/health'?Response.json({contentHost:{port:12345}}):options.method==='POST'?Response.json({id,url:`http://${id}.localhost:12345/document.html`,revokeToken:'f'.repeat(48),leaseMs:1800000}):Response.json({ok:true})})
  const load=createSlidesFrameLoadHandler(frame)
  t.after(async()=>{load.dispose();await frame.dispose()})
  return {frame,load}
}
function child(t){
  const iframe=new EventTarget(),host=new EventTarget(),ports=[]
  iframe.ownerDocument={defaultView:host}
  let connection
  iframe.contentWindow={postMessage(data,_origin,transfers){connection={data,port:transfers[0]};ports.push(connection.port);connection.port.start()}}
  t.after(()=>ports.forEach(port=>port.close()))
  return {iframe,event:{currentTarget:iframe},reply(extra){const {options,...base}=connection.data;connection.port.postMessage({...base,...extra})}}
}
async function navigation(remote,load,direction,beforeNavigation){
  const values=[]
  let finish
  const received=new Promise(resolve=>{finish=resolve})
  load.onLoad(remote.event,value=>{values.push(value);finish()})
  beforeNavigation?.()
  remote.reply({type:'ready'});remote.reply({type:'slide-nav',value:direction})
  await received
  await new Promise(resolve=>setImmediate(resolve))
  assert.deepEqual(values,[direction])
  return values
}

test('幻灯片实例释放后迟到的 onLoad 不抛全局错误，直接 bind 仍明确拒绝',async t=>{
  const {frame,load}=await page(t)
  await frame.dispose()
  assert.doesNotThrow(()=>load.onLoad({currentTarget:{}},()=>{}))
  assert.throws(()=>frame.bind({}),/内容实例已失效/)
})

test('退出旧页面后迟到回调不碰新页面，正常加载与同一 iframe 重载仍各翻一次',async t=>{
  const previous=await page(t),current=await page(t),remote=child(t)
  previous.load.dispose()
  // Effect cleanup retires the callback before its asynchronous DELETE ends.
  assert.doesNotThrow(()=>previous.load.onLoad({currentTarget:{}},()=>{}))
  assert.equal(previous.frame.disposed,false)
  await previous.frame.dispose()
  const first=await navigation(remote,current.load,'next',()=>{
    assert.doesNotThrow(()=>previous.load.onLoad(remote.event,()=>{throw new Error('旧页面不能翻页')}))
  })
  remote.iframe.dispatchEvent(new Event('load'))
  const reloaded=await navigation(remote,current.load,'previous')
  assert.deepEqual(first,['next'],'重载后旧订阅不能收到新一代的意图')
  assert.deepEqual(reloaded,['previous'])
})
