import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasAnnotationCapture, createCanvasExport } from '../engine/index.js'
import { preflightCanvasExport } from '../renderer/index.js'
import { creationFixture } from './creation-test-fixture.mjs'

const target = { type:'create_shape', id:'shape:target', shapeType:'image', x:200, y:200, props:{w:200,h:140} }
const complete = (snapshot, options) => ({ ...preflightCanvasExport(snapshot,options),status:'complete',mime:'image/png',bytes:new Uint8Array([137,80,78,71]) })
function capture(f,render=complete,preflight=preflightCanvasExport){return createCanvasAnnotationCapture({session:f.session,interaction:f.interaction,preflight,render})}

test('截图固定明确目标和文档，忽略当前选择，不改变视角/选择/历史/文档',async()=>{
  const f=await creationFixture({commands:[target,{...target,id:'shape:other',x:1500}]})
  let release,received
  const action=capture(f,(snapshot,options)=>{received={snapshot,options};return new Promise(resolve=>{release=()=>resolve(complete(snapshot,options))})})
  try{
    f.interaction.select('all');const before=structuredClone(f.current()),state=f.interaction.state.get()
    const pending=action.run({targetId:'shape:target'})
    assert.deepEqual(received.options.ids,['shape:target'])
    assert.equal((await action.run({targetId:'shape:other'})).reason,'exporting')
    assert.deepEqual(f.current(),before);assert.equal(f.interaction.state.get(),state)
    await f.remote([{type:'update',id:'shape:target',changes:{x:900}}])
    f.interaction.select('clear');f.interaction.setCamera({x:100,y:-100,z:2})
    release();const result=await pending
    assert.equal(result.targetId,'shape:target');assert.equal(result.sourceBounds.x,200)
    assert.equal(received.snapshot.store['shape:target'].x,200)
    assert.equal(f.current().store['shape:target'].x,900)
    assert.deepEqual(f.interaction.state.get().selectedIds,[])
    assert.deepEqual(f.interaction.state.get().camera,{x:100,y:-100,z:2})
    assert.equal(f.commits.length,0)
  }finally{action.dispose();f.close()}
})

test('过大截图在渲染前拒绝，移动标注或换目标后重试使用新计划和实际尺寸',async()=>{
  const f=await creationFixture({commands:[target,{...target,id:'shape:other',x:12000},{type:'create_shape',id:'shape:a',shapeType:'arrow',x:300,y:300,props:{end:{x:6000,y:0},bend:0,color:'red'}}]})
  let renders=0;const action=capture(f,(snapshot,options)=>{renders++;return complete(snapshot,options)})
  try{
    await assert.rejects(action.run({targetId:'shape:target'}),e=>e.code==='annotation-size-limit'&&e.width===6164)
    assert.equal(renders,0);assert.equal(action.state.get().busy,false)
    await f.remote([{type:'update',id:'shape:a',changes:{props:{end:{x:200,y:0}}}}])
    const result=await action.run({targetId:'shape:target'})
    assert.deepEqual(result.ids,['shape:target','shape:a']);assert.equal(result.width,728)
    const other=await action.run({targetId:'shape:other'})
    assert.deepEqual(other.ids,['shape:other']);assert.equal(renders,2);assert.equal(f.commits.length,0)
  }finally{action.dispose();f.close()}
})

test('输入区、菜单、组字、拖动、文字和裁剪不争用输出；工具栏表单来源可用',async()=>{
  const f=await creationFixture({commands:[target]});const action=capture(f)
  try{
    for(const [context,reason] of [[{owner:'form'},'input-owner'],[{owner:'menu'},'input-owner'],[{owner:'canvas',isComposing:true},'composing'],[{owner:'text-editing'},'text-editing']]){
      f.interaction.setInputContext(context);assert.equal((await action.run({targetId:'shape:target'})).reason,reason)
    }
    f.interaction.setInputContext({owner:'form'})
    assert.equal((await action.run({targetId:'shape:target',origin:'toolbar'})).status,'complete')
    f.interaction.setInputContext({owner:'canvas'});f.session.beginGesture()
    assert.equal((await action.run({targetId:'shape:target'})).reason,'pointer-gesture');f.session.cancelGesture()
    f.interaction.select('all');f.interaction.cropImage({type:'start',id:'shape:target'})
    assert.equal((await action.run({targetId:'shape:target'})).reason,'cropping')
    f.interaction.cropImage({type:'cancel'})
    assert.equal(f.commits.length,0)
  }finally{action.dispose();f.close()}
})

test('四类非输入控件焦点可截图，展开菜单、select和组字仍阻止标注输出（#209）',async()=>{
  const f=await creationFixture({commands:[target]});let renders=0
  const action=capture(f,(snapshot,options)=>{renders++;return complete(snapshot,options)})
  try{
    for(const owner of ['button','toolbar-button','anchor','menu-trigger']){
      f.interaction.setInputContext({owner})
      for(const origin of ['canvas','toolbar'])assert.equal((await action.run({targetId:'shape:target',origin})).status,'complete',`${owner}/${origin}`)
    }
    assert.equal(renders,8)
    const blocked=[[{owner:'menu-trigger',expanded:true},'input-owner'],[{owner:'menu'},'input-owner'],[{owner:'select'},'input-owner'],...['button','toolbar-button','anchor','menu-trigger'].map(owner=>[{owner,isComposing:true},'composing'])]
    for(const [context,reason]of blocked){
      f.interaction.setInputContext(context)
      for(const origin of ['canvas','toolbar'])assert.equal((await action.run({targetId:'shape:target',origin})).reason,reason)
    }
    assert.equal(renders,8);assert.equal(f.commits.length,0)
  }finally{action.dispose();f.close()}
})

test('取消/销毁和外部signal不交付残余截图，不取消别的普通输出动作',async()=>{
  const f=await creationFixture({commands:[target]});let release,writes=0
  const action=capture(f,(snapshot,options)=>new Promise(resolve=>{release=()=>resolve(complete(snapshot,options))}))
  const exp=createCanvasExport({session:f.session,interaction:f.interaction,background:'#fff',render:complete,download:()=>{writes++}})
  try{
    for(const stop of ['cancel','signal','dispose']){
      const controller=new AbortController(),pending=action.run({targetId:'shape:target',signal:controller.signal})
      if(stop==='signal') controller.abort(new Error('Synthetic caller cancelled'));else action[stop]()
      await exp.run();assert.equal(writes,['cancel','signal','dispose'].indexOf(stop)+1)
      release();assert.equal((await pending).status,'cancelled');assert.equal(action.state.get().busy,false)
    }
    assert.equal((await action.run({targetId:'shape:target'})).reason,'disposed');assert.equal(f.commits.length,0)
  }finally{action.dispose();exp.dispose();f.close()}
})

test('取消信号已触发不渲染，失败和不完整字节释放busy，报告资源计数',async()=>{
  const f=await creationFixture({commands:[target]});let mode='throw',calls=0
  const action=capture(f,(snapshot,options)=>{calls++;if(mode==='throw')throw Object.assign(new Error('Synthetic renderer failed'),{blockedResources:2,failedResources:1});return {...complete(snapshot,options),...(mode==='size'?{width:1}:mode==='bytes'?{bytes:new Uint8Array()}:mode==='mime'?{mime:'image/svg+xml'}:{})}})
  try{
    const signal=AbortSignal.abort(new Error('Synthetic pre-cancel'))
    assert.equal((await action.run({targetId:'shape:target',signal})).status,'cancelled');assert.equal(calls,0)
    await assert.rejects(action.run({targetId:'shape:target'}),/renderer failed/)
    assert.equal(action.state.get().lastError.blockedResources,2);assert.equal(action.state.get().lastError.failedResources,1)
    for(mode of ['size','bytes','mime']) {await assert.rejects(action.run({targetId:'shape:target'}),/不完整/);assert.equal(action.state.get().busy,false)}
    mode='complete';assert.equal((await action.run({targetId:'shape:target'})).status,'complete')
    await assert.rejects(action.run({targetId:'shape:missing'}),/请选择/)
    assert.equal(f.commits.length,0)
  }finally{action.dispose();f.close()}
})
