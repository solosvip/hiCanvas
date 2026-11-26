import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction } from '../engine/index.js'
import { memoryTransport } from './renderer-preview/transport.js'

test('空白创建预览复用公开历史契约，原生快捷键入口可以撤销和重做整次创建',async()=>{
  const snapshot=createCanvasSnapshot(),session=await createEditorSession({transport:memoryTransport(snapshot),actor:'synthetic-creator'})
  const interaction=createCanvasInteraction({session,toolIds:['select','geo'],viewport:{w:1280,h:800}})
  try{
    interaction.setTool('geo')
    interaction.dispatch({type:'pointer_down',time:1,point:{x:500,y:350}})
    await interaction.dispatch({type:'pointer_up',time:2,point:{x:500,y:350}})
    const shape=session.store.allRecords().find(r=>r.typeName==='shape')
    assert.deepEqual([shape.x,shape.y,shape.props.w,shape.props.h],[400,250,200,200])
    await interaction.dispatch({type:'key_down',time:3,key:'z',metaKey:true})
    assert.equal(session.store.allRecords().some(r=>r.typeName==='shape'),false)
    await interaction.dispatch({type:'key_down',time:4,key:'z',metaKey:true,shiftKey:true})
    assert.deepEqual(session.store.get(shape.id),shape)
  }finally{interaction.dispose();session.dispose()}
})
