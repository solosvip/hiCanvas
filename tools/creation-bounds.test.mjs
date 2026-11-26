import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'

// Independent native legacy measurements: start (500,350), end (650,430).
// Star/cloud/heart deliberately use the pointer box in the normalized renderer;
// the legacy seed-curve offsets are documented in both feature inventories.
const variants = ['rectangle','ellipse','triangle','diamond','pentagon','hexagon','octagon','star','rhombus','rhombus-2','oval','trapezoid','arrow-right','arrow-left','arrow-up','arrow-down','x-box','check-box','cloud','heart']
for(const geo of variants) test(`${geo} 的普通、Shift、Alt 拖动严格符合指针边界`,async()=>{
  for(const [modifiers,box] of [[{},[500,350,150,80]],[{shiftKey:true},[500,350,150,150]],[{altKey:true},[351,271,299,159]]]){
    const f=await creationFixture()
    try{
      f.interaction.setCreationOptions({geo}); f.interaction.setTool('geo')
      f.pointer('down',500,350); f.pointer('move',650,430,modifiers); await f.pointer('up',650,430,modifiers)
      const [s]=f.shapes(); assert.deepEqual([s.x,s.y,s.props.w,s.props.h],box)
      assert.equal(f.commits.length,1)
    }finally{f.close()}
  }
})

// A zero axis uses the negative side of the 1-unit seed for frames, but the
// positive side for geo. Shift chooses the other positive axis in both tools.
for(const toolId of ['geo','frame']) test(`${toolId} 的单轴与 Shift 单轴拖动保留旧版种子方向`,async()=>{
  for(const [x,y,mods,geoBox,frameBox] of [
    [500,355,{},[500,350,1,5],[499,350,1,5]],
    [505,350,{},[500,350,5,1],[500,349,5,1]],
    [500,345,{},[500,345,1,5],[499,345,1,5]],
    [495,350,{},[495,350,5,1],[495,349,5,1]],
    [500,500,{shiftKey:true},[500,350,150,150],[500,350,150,150]],
    [350,350,{shiftKey:true},[350,350,150,150],[350,350,150,150]],
  ]){
    const f=await creationFixture()
    try{
      f.interaction.setTool(toolId);f.pointer('down',500,350);f.pointer('move',x,y,mods);await f.pointer('up',x,y,mods)
      const [s]=f.shapes();assert.deepEqual([s.x,s.y,s.props.w,s.props.h],toolId==='geo'?geoBox:frameBox)
    }finally{f.close()}
  }
})

test('未开放创建工具的产品不拦截 Q，也不能通过最近工具或工具栏启用创建',async()=>{
  const f=await creationFixture({toolIds:['select','hand']})
  try{
    const before=f.interaction.state.get();f.key('q')
    assert.deepEqual(f.interaction.state.get(),before)
    for(const key of ['r','o','f','g','a'])f.key(key)
    assert.equal(f.interaction.state.get().toolId,'select')
    assert.throws(()=>f.interaction.useRecentTool(),/开放/)
    assert.throws(()=>f.interaction.beginToolDrag({toolId:'geo'}),/开放/)
    assert.equal(f.commits.length,0)
  }finally{f.close()}
})

for(const [toolId,box] of [
  ['frame',[170,130,160,90]],['ai-image',[192,29.25,256,341.5]],
  ['ai-draft',[64,56,512,288]],['ai-film',[64,56,512,288]],['ai-slides',[58,50,524,300]],
])test(`${toolId} 动态尺寸在 200% 视角下只改变新建默认尺寸`,async()=>{
  const f=await creationFixture({camera:{x:0,y:0,z:2}})
  try{
    f.interaction.setCreationOptions({dynamicSize:true}); f.interaction.beginToolDrag({toolId})
    await f.click(900,768)
    if(toolId==='frame')await f.click(500,350)
    const [s]=f.shapes();assert.deepEqual([s.x,s.y,s.props.w,s.props.h],box)
    assert.equal(Object.hasOwn(s.props,'scale'),false)
  }finally{f.close()}
})
