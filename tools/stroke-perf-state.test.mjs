import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {resetCamera} from './perf/strokes-probe.mjs'
import {assertStrokeStart,assertStrokeChange} from './perf/strokes-phase.mjs'

test('每阶段恢复视角保留两版相同选择，缺失、额外选择和错误视角会拦截',async()=>{
  const camera={x:10,y:20,z:.1},targetId='shape:stroke',fixture={camera,targetId}
  const originalWindow=globalThis.window,originalFrame=globalThis.requestAnimationFrame
  try{
    globalThis.requestAnimationFrame=callback=>callback()
    for(const renderer of ['legacy','preview']){
      const state={camera:{x:0,y:0,z:1},selectedIds:[targetId]},setCamera=value=>state.camera={...value}
      globalThis.window=renderer==='legacy'?{__cowartEditor:{setCamera,selectNone:()=>state.selectedIds=[]}}:{__HICANVAS_STROKE_PREVIEW__:{resetCamera:setCamera}}
      await resetCamera({camera})
      assert.doesNotThrow(()=>assertStrokeStart(fixture,state))
      for(const selectedIds of [[],['other'],[targetId,'other']])assert.throws(()=>assertStrokeStart(fixture,{...state,selectedIds}),/同一目标/)
      assert.throws(()=>assertStrokeStart(fixture,{...state,camera:{...camera,z:.2}}),/视角/)
    }
  }finally{
    if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow
    if(originalFrame===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=originalFrame
  }
})

test('拖动必须只改位置；缩放手柄、空转和视角操作误移动不能计为有效样本',()=>{
  const before={camera:{x:0,y:0,z:1},shape:{x:0,y:0,rotation:0,props:{segments:['unchanged']}}}
  const moved={...before,shape:{...before.shape,x:10,y:20}}
  assert.doesNotThrow(()=>assertStrokeChange('drag',before,moved))
  assert.throws(()=>assertStrokeChange('drag',before,before),/空转/)
  assert.throws(()=>assertStrokeChange('drag',before,{...moved,shape:{...moved.shape,props:{segments:['resized']}}}),/变形/)
  assert.throws(()=>assertStrokeChange('pan',before,moved),/意外移动/)
})
