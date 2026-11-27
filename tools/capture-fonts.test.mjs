import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {captureFontEnvironment,createFontCaptureClone,waitForCaptureFonts} from '../content-channel/capture-realm.js'

function documentFixture(faces){
  const appended=[],removed=[],shadow={appendChild(){}},doc={fonts:faces}
  const host={style:{},setAttribute(key,value){this[key]=value},attachShadow(options){assert.equal(options.mode,'closed');return shadow},remove(){removed.push(this)}}
  Object.assign(doc,{createElement:tag=>tag==='canvas'?{ownerDocument:doc}:host,createTextNode:text=>({text,ownerDocument:doc}),body:{append:node=>appended.push(node)}})
  Object.defineProperty(doc,'styleSheets',{get(){throw new Error('不能读取跨源CSS')}})
  return {doc,host,shadow,appended,removed}
}
test('实际绘字canvas沿用源页已加载字体，度量节点隔绝网页CSS；不读取CDN样式表',()=>{
  const f=documentFixture([{status:'loaded'}]),neutral={}
  const environment=captureFontEnvironment(f.doc,neutral)
  assert.equal(environment.canvas.ownerDocument,f.doc)
  assert.equal(environment.document.body,f.shadow)
  assert.equal(environment.document.createTextNode('测试').ownerDocument,f.doc)
  assert.equal(f.host['data-html2canvas-ignore'],'true')
  assert.deepEqual(f.appended,[f.host]);environment.dispose();assert.deepEqual(f.removed,[f.host])
})
test('未加载自定义字体使用原中性环境，不插入辅助节点、不提供额外canvas',()=>{
  for(const faces of [[],[{status:'error'}],[{status:'loading'}],[{status:'unloaded'}]]){
    const f=documentFixture(faces),neutral={}
    const environment=captureFontEnvironment(f.doc,neutral)
    assert.equal(environment.document,neutral);assert.equal(environment.canvas,undefined)
    environment.dispose();assert.deepEqual(f.appended,[])
  }
})
test('源页字体失败照常回退，挂起字体两秒后结束，取消立即拒绝',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const controller=new AbortController(),doc={fonts:{ready:new Promise(()=>{})}}
  const task=waitForCaptureFonts(doc,controller.signal);t.mock.timers.tick(1999)
  let settled=false;task.then(()=>{settled=true});await Promise.resolve();assert.equal(settled,false)
  t.mock.timers.tick(1);await task
  await waitForCaptureFonts({fonts:{ready:Promise.reject(new Error('字体失败'))}},controller.signal)
  const cancelled=waitForCaptureFonts(doc,controller.signal);controller.abort();await assert.rejects(cancelled,{name:'AbortError'})
})
function cloneFixture({load=true,fonts=Promise.resolve(),onclone=()=>{}}={}){
  let removed=0,stopped=0,loadListeners=0
  const frame=new EventTarget(),cloned={fonts:{ready:fonts},documentElement:{},open(){},write(){},adoptNode:node=>node,replaceChild(){},close(){if(load)frame.dispatchEvent(new Event('load'))}}
  const add=frame.addEventListener.bind(frame),remove=frame.removeEventListener.bind(frame)
  Object.assign(frame,{style:{},setAttribute(){},contentDocument:cloned,contentWindow:{stop(){stopped++},scrollTo(){}},remove(){removed++}})
  frame.addEventListener=(...args)=>{loadListeners++;add(...args)}
  frame.removeEventListener=(...args)=>{loadListeners--;remove(...args)}
  const doc={doctype:null,createElement:()=>frame,body:{appendChild(){}},defaultView:{pageXOffset:0,pageYOffset:0}}
  const element={scrollLeft:0,scrollTop:0},cloner={documentElement:{},scrolledElements:[[element,8,9]],clonedReferenceElement:{},options:{onclone}}
  return {doc,cloner,frame,element,state:()=>({removed,stopped,loadListeners})}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve))
test('字体挂起不会卡住克隆加载事件或fonts.ready，完成后还原滚动并移除监听',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  let observed=0
  const f=cloneFixture({load:false,fonts:new Promise(()=>{}),onclone(){observed++}})
  const task=createFontCaptureClone(f.cloner,f.doc,{left:0,top:0,width:320,height:180},new AbortController().signal)
  t.mock.timers.tick(2000);await flush();t.mock.timers.tick(2000)
  assert.equal(await task,f.frame);assert.equal(observed,1)
  assert.equal(f.element.scrollLeft,8);assert.equal(f.element.scrollTop,9)
  assert.deepEqual(f.state(),{removed:0,stopped:2,loadListeners:0})
})
test('克隆等待中取消或onclone失败，都会移除临时框架和监听',async()=>{
  const f=cloneFixture({load:false}),controller=new AbortController()
  const task=createFontCaptureClone(f.cloner,f.doc,{width:1,height:1},controller.signal)
  controller.abort();await assert.rejects(task,{name:'AbortError'})
  assert.deepEqual(f.state(),{removed:1,stopped:0,loadListeners:0})
  const failed=cloneFixture({onclone(){throw new Error('克隆回调失败')}})
  await assert.rejects(createFontCaptureClone(failed.cloner,failed.doc,{width:1,height:1},new AbortController().signal),/克隆回调失败/)
  assert.equal(failed.state().removed,1)
})
test('度量环境初始化失败也回收帮助节点，不留下后续无法finally的资源',()=>{
  const f=documentFixture([{status:'loaded'}])
  const create=f.doc.createElement
  f.doc.createElement=tag=>{if(tag==='canvas')throw new Error('画布创建失败');return create(tag)}
  assert.throws(()=>captureFontEnvironment(f.doc,{}),/画布创建失败/)
  assert.deepEqual(f.appended,[]);assert.deepEqual(f.removed,[f.host])
})
test('克隆保留真实doctype、脚本字体，图片尚未就绪时不提前解析布局',async()=>{
  let serialized
  const f=cloneFixture(),image=new EventTarget();Object.assign(image,{complete:false,src:'synthetic.png'})
  f.frame.contentDocument.images=[image]
  const face={status:'loaded'},added=[];f.doc.fonts=[face]
  f.frame.contentDocument.fonts.add=font=>added.push(font)
  f.doc.doctype={name:'html',publicId:'-//W3C//DTD HTML 4.01 Transitional//EN'}
  f.doc.defaultView.XMLSerializer=class{serializeToString(value){assert.equal(value,f.doc.doctype);return '<!DOCTYPE html PUBLIC "legacy">'}}
  f.frame.contentDocument.write=text=>{serialized=text}
  let finished=false
  const task=createFontCaptureClone(f.cloner,f.doc,{left:0,top:0,width:320,height:180},new AbortController().signal).then(value=>{finished=true;return value})
  await flush();assert.equal(finished,false);assert.match(serialized,/PUBLIC "legacy"/);assert.deepEqual(added,[face])
  image.dispatchEvent(new Event('load'));assert.equal(await task,f.frame)
})
