import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'

const frame={type:'create_shape',id:'shape:outer',shapeType:'frame',x:300,y:150,props:{w:700,h:500}}

// ADR 0009: the host rejects an old revision; runtime accepts unrelated records
// then replays only the local write set. A child follows its moved parent at
// the original local position. Missing parents still fail relationship checks.
for(const change of ['move-parent','delete-parent','unrelated'])test(`松手提交期间远端 ${change} 遵守记录级重放规则`,async()=>{
  let release,started,attempt=0
  const held=new Promise(resolve=>{release=resolve}),entered=new Promise(resolve=>{started=resolve})
  const f=await creationFixture({commands:[frame],beforeCommit:async()=>{if(++attempt===1){started();await held}}})
  try{
    f.interaction.setTool('geo');f.pointer('down',500,350);f.pointer('move',650,430)
    const pending=f.pointer('up',650,430);await entered
    const commands=change==='move-parent'?[{type:'update',id:'shape:outer',changes:{x:500}}]
      :change==='delete-parent'?[{type:'delete',ids:['shape:outer']}]
      :[{type:'create_shape',id:'shape:unrelated',shapeType:'geo',x:1200,y:700}]
    await f.remote(commands,false);release()
    if(change==='delete-parent'){
      await assert.rejects(pending)
      assert.equal(f.shapes().length,0);assert.equal(f.previewShapes().length,0)
      assert.ok(f.interaction.state.get().lastError)
      assert.equal(f.session.state.get().isGestureActive,false)
    }else{
      await pending
      const child=f.shapes().find(s=>!['shape:outer','shape:unrelated'].includes(s.id))
      assert.deepEqual([child.parentId,child.x,child.y,child.props.w,child.props.h],['shape:outer',200,200,150,80])
      const parent=f.current().store['shape:outer']
      assert.equal(parent.x+child.x,change==='move-parent'?700:500)
      assert.equal(f.interaction.state.get().lastError,null)
      assert.equal(f.commits.length,2)
      await f.key('z',{metaKey:true})
      assert.equal(f.current().store[child.id],undefined)
      assert.equal(f.current().store['shape:outer'].x,change==='move-parent'?500:300)
      assert.equal(Boolean(f.current().store['shape:unrelated']),change==='unrelated')
    }
  }finally{release();f.close()}
})
