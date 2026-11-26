import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'

const frame = {type:'create_shape',id:'shape:outer',shapeType:'frame',x:300,y:150,props:{w:700,h:500}}

// Legacy native clicks inside plain/rotated frames, including a locked frame,
// were read back on 2026-11-26. Children keep their page orientation.
for (const [name,command,extra,expected] of [
  ['普通画框',frame,[],['shape:outer',100,100,0]],
  ['旋转画框',{...frame,x:800,props:{w:500,h:500},rotation:Math.PI/2},[],['shape:outer',100,300,-Math.PI/2]],
  ['锁定画框',{...frame,x:800,props:{w:500,h:500},rotation:Math.PI/2},[{type:'update',id:'shape:outer',changes:{isLocked:true}}],[null,500,250,0]],
]) test(`在${name}内创建时正确选择父级并换算坐标`, async () => {
  const f=await creationFixture({commands:[command,...extra]})
  try {
    f.interaction.setTool('geo'); await f.click(name==='普通画框'?500:600,350)
    const s=f.shapes().find(s=>s.id!=='shape:outer')
    assert.equal(s.parentId,expected[0]||Object.values(f.initial.store).find(r=>r.typeName==='page').id)
    for(const [actual,wanted] of [[s.x,expected[1]],[s.y,expected[2]],[s.rotation,expected[3]]]) assert.ok(Math.abs(actual-wanted)<1e-9)
    assert.equal(f.current().store['shape:outer'].x,command.x)
  } finally {f.close()}
})

for (const preview of [false,true]) test(`父级在${preview?'预览后':'第一帧前'}被远端修改时放弃创建，保留远端记录`,async()=>{
  const f=await creationFixture({commands:[frame]})
  try {
    f.interaction.setTool('geo'); f.pointer('down',500,350)
    if(preview)f.pointer('move',650,430)
    await f.remote([{type:'update',id:'shape:outer',changes:{x:320}}])
    assert.throws(()=>f.pointer('move',700,450),e=>e.code==='conflict')
    assert.equal(f.previewShapes().length,1)
    assert.equal(f.current().store['shape:outer'].x,320)
    assert.equal(f.commits.length,0)
  }finally{f.close()}
})

test('取消、非活动指针和实时修饰键不产生多余提交',async()=>{
  const f=await creationFixture()
  try{
    f.interaction.setTool('geo'); f.pointer('down',500,350); f.pointer('move',650,430)
    f.key('Shift',{shiftKey:true})
    assert.deepEqual([f.previewShapes()[0].props.w,f.previewShapes()[0].props.h],[150,150])
    f.key('Shift',{},'key_up')
    assert.deepEqual([f.previewShapes()[0].props.w,f.previewShapes()[0].props.h],[150,80])
    f.pointer('up',750,500,{pointerId:2}); f.pointer('cancel',750,500,{pointerId:2})
    assert.equal(f.session.state.get().isGestureActive,true)
    f.key('Escape'); await f.pointer('up',650,430)
    assert.deepEqual(f.current(),f.initial)
    assert.equal(f.interaction.state.get().toolId,'geo')
    f.key('Escape'); assert.equal(f.interaction.state.get().toolId,'select')
    assert.equal(f.commits.length,0)
  }finally{f.close()}
})

test('提交失败回到已确认文档并报告错误，不遗留预览对象',async()=>{
  const f=await creationFixture({beforeCommit:async()=>{throw Object.assign(new Error('Synthetic write failure'),{code:'transport'})}})
  try{
    f.interaction.setTool('geo'); f.pointer('down',500,350); f.pointer('move',650,430)
    await assert.rejects(f.pointer('up',650,430),/Synthetic write failure/)
    assert.deepEqual(f.current(),f.initial)
    assert.equal(f.previewShapes().length,0)
    assert.equal(f.session.state.get().isGestureActive,false)
    assert.equal(f.interaction.state.get().lastError.code,'transport')
  }finally{f.close()}
})

test('提交期间输入被拒绝，迟到的保存回复不覆盖宿主后来选择的工具',async()=>{
  let release
  const saved=new Promise(r=>{release=r})
  const f=await creationFixture({beforeCommit:()=>saved})
  try{
    f.interaction.setTool('geo'); f.pointer('down',500,350)
    const pending=f.pointer('up',500,350)
    f.key('r'); assert.equal(f.interaction.state.get().toolId,'geo')
    f.interaction.setTool('hand'); release(); await pending
    assert.equal(f.shapes().length,1)
    assert.equal(f.interaction.state.get().toolId,'hand')
  }finally{release();f.close()}
})

test('宿主重置视角取消工具栏起手后，下次画布点击立即按画布创建',async()=>{
  const f=await creationFixture()
  try{
    f.interaction.beginToolDrag({toolId:'geo'})
    f.pointer('down',876,768); f.pointer('move',650,430)
    f.interaction.setCamera({x:0,y:0,z:1})
    assert.equal(f.previewShapes().length,0)
    assert.equal(f.interaction.state.get().creation.dragFromToolbar,false)
    await f.click(500,350)
    assert.equal(f.shapes().length,1)
    assert.deepEqual([f.shapes()[0].x,f.shapes()[0].y],[400,250])
  }finally{f.close()}
})

test('新建保存失败时恢复起手前的选择',async()=>{
  let writes=0
  const f=await creationFixture({beforeCommit:async()=>{if(++writes===2)throw new Error('Synthetic second write failure')}})
  try{
    f.interaction.setTool('geo');await f.click(300,300)
    const previous=f.interaction.state.get().selectedIds[0]
    f.interaction.setTool('geo');await assert.rejects(f.click(800,500),/second write/)
    assert.deepEqual(f.interaction.state.get().selectedIds,[previous])
    assert.equal(f.shapes().length,1)
  }finally{f.close()}
})

test('保存期间重复同步相同几何选项，不阻止完成后回选择',async()=>{
  let release
  const saved=new Promise(resolve=>{release=resolve}), f=await creationFixture({beforeCommit:()=>saved})
  try{
    f.interaction.setTool('geo');f.pointer('down',500,350)
    const pending=f.pointer('up',500,350)
    f.interaction.setCreationOptions({geo:'rectangle'})
    release();await pending
    assert.equal(f.interaction.state.get().toolId,'select')
  }finally{release();f.close()}
})
