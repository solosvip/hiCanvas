import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { getShapeScalingCapabilities } from '../engine/index.js'
import { creationFixture } from './creation-test-fixture.mjs'

// Read back after native legacy toolbar clicks on 2026-11-26. The viewport
// was 1280x800, camera {0,0,1}. These literals do not come from tool presets.
const aiCases = [
  ['ai-image',384,58.5,512,683,'AI 图片',{cowartAiImageHolder:true,cowartAiImageHolderVersion:1}],
  ['ai-draft',128,112,1024,576,'AI 网页',{cowartAiDraftHolder:true,cowartAiDraftHolderVersion:1}],
  ['ai-film',128,112,1024,576,'AI 影片',{cowartAiDraftHolder:true,cowartAiDraftHolderVersion:1,cowartAiFilmHolder:true,cowartFilmStyle:'product-launch',cowartFilmDuration:15,cowartFilmMuted:false}],
  ['ai-slides',116,100,1048,600,'AI 幻灯片',{cowartAiSlides:true,cowartAiSlidesVersion:1,cowartAiSlidesFlow:'horizontal',cowartAiSlidesGap:32,cowartAiSlidesPadding:12}],
]

for (const [toolId,x,y,w,h,name,meta] of aiCases) test(`${toolId} 复用创建手势，保存身份并保持普通画框缩放能力`, async () => {
  const f = await creationFixture()
  try {
    f.interaction.setTool(toolId); await f.click(640,400)
    const [s] = f.shapes()
    assert.deepEqual([s.type,s.x,s.y,s.props,s.meta],['frame',x,y,{w,h,name,color:'blue'},meta])
    assert.equal(getShapeScalingCapabilities(s).lockAspectRatio,false,'AI 身份不能自行改变 #105 的 frame 比例规则')
    await f.key('z',{metaKey:true})
    assert.deepEqual(f.current(),f.initial)
    f.interaction.setTool(toolId); f.pointer('down',500,350); f.pointer('move',650,430); await f.pointer('up',650,430)
    const [drag] = f.shapes()
    assert.deepEqual([drag.x,drag.y,drag.props.w,drag.props.h,drag.meta],[500,350,150,80,meta])
  } finally { f.close() }
})

test('hiCanvas 的 A 原生快捷键创建 AI 图片框，保留居中放框语义', async () => {
  const f = await creationFixture()
  try {
    await f.key('a')
    const [s] = f.shapes()
    assert.deepEqual([s.type,s.x,s.y,s.props.w,s.props.h,s.meta.cowartAiImageHolder],['frame',384,58.5,512,683,true])
    assert.equal(f.commits.length,1)
    assert.equal(f.interaction.state.get().toolId,'select')
  } finally { f.close() }
})

for (const [toolId,previewBox,dropBox] of [
  ['geo',[400,250,200,200],[550,330,200,200]],
  ['frame',[340,260,320,180],[490,340,320,180]],
  ['ai-image',[244,8.5,512,683],[394,88.5,512,683]],
  ['ai-draft',[-12,62,1024,576],[138,142,1024,576]],
  ['ai-film',[-12,62,1024,576],[138,142,1024,576]],
  ['ai-slides',[-24,50,1048,600],[126,130,1048,600]],
]) test(`工具栏拖入 ${toolId} 首帧居中跟手、固定默认尺寸并一次保存`, async () => {
  const f = await creationFixture()
  try {
    f.interaction.setCreationOptions({toolLocked:true})
    f.interaction.beginToolDrag({toolId})
    assert.equal(f.previewShapes().length,0,'起手方法自身不修改画板')
    f.pointer('down',876,768); f.pointer('move',500,350)
    const [preview] = f.previewShapes()
    assert.deepEqual([preview.x,preview.y,preview.props.w,preview.props.h],previewBox)
    assert.equal(f.commits.length,0)
    assert.equal(f.interaction.state.get().creation.dragFromToolbar,true)
    await f.pointer('up',650,430)
    const [saved] = f.shapes()
    assert.deepEqual([saved.x,saved.y,saved.props.w,saved.props.h],dropBox)
    assert.equal(f.commits.length,1)
    assert.equal(f.interaction.state.get().toolId,'select','工具栏拖入不受 Q 锁定影响')
    assert.equal(f.interaction.state.get().creation.dragFromToolbar,false)
    await f.key('z',{metaKey:true})
    assert.deepEqual(f.current(),f.initial)
  } finally { f.close() }
})

for (const [toolId,x,y,w,h,name,meta] of aiCases) test(`工具栏点击 ${toolId} 以原生 down/up 在视口中央创建`, async () => {
  const f = await creationFixture()
  try {
    f.interaction.setCreationOptions({toolLocked:true})
    f.interaction.beginToolDrag({toolId}); f.pointer('down',600,768)
    assert.equal(f.previewShapes().length,0)
    await f.pointer('up',600,768)
    const [s] = f.shapes()
    assert.deepEqual([s.x,s.y,s.props,s.meta],[x,y,{w,h,name,color:'blue'},meta])
    assert.equal(f.interaction.state.get().toolId,'select')
  } finally { f.close() }
})

for (const toolId of ['geo','frame']) test(`工具栏单击 ${toolId} 只切工具，随后画布点击才创建`, async () => {
  const f = await creationFixture()
  try {
    f.interaction.beginToolDrag({toolId}); await f.click(876,768)
    assert.equal(f.shapes().length,0)
    assert.equal(f.interaction.state.get().toolId,toolId)
    assert.equal(f.session.state.get().isGestureActive,false)
    assert.equal(f.interaction.state.get().creation.dragFromToolbar,false)
    await f.click(500,350)
    assert.equal(f.shapes().length,1)
  } finally { f.close() }
})

for (const cancel of ['outside','escape','pointer-cancel']) test(`工具栏拖入 ${cancel} 完全取消，不留下隐藏对象或撤销项`, async () => {
  const f = await creationFixture()
  try {
    f.interaction.beginToolDrag({toolId:'geo',geo:'cloud'})
    f.pointer('down',876,768); f.pointer('move',650,430)
    if (cancel==='outside') await f.pointer('up',1400,430)
    else if (cancel==='escape') { f.key('Escape'); await f.pointer('up',650,430) }
    else f.pointer('cancel',650,430)
    assert.deepEqual(f.current(),f.initial)
    assert.equal(f.previewShapes().length,0)
    assert.equal(f.commits.length,0)
    assert.equal(f.session.state.get().isGestureActive,false)
    assert.equal(f.interaction.state.get().toolId,'select')
    assert.equal(f.interaction.state.get().creation.dragFromToolbar,false)
  } finally { f.close() }
})

test('工具栏起手严格校验工具与变体，后续移动仍受归一化时间约束', async () => {
  const f = await creationFixture()
  try {
    const before=f.interaction.state.get()
    for (const options of [null,{}, {toolId:'unknown'},{toolId:'hand'},{toolId:'geo',geo:'unknown'},{toolId:'frame',geo:'cloud'},{toolId:'geo',point:{x:1,y:2}}]) assert.throws(()=>f.interaction.beginToolDrag(options))
    assert.deepEqual(f.interaction.state.get(),before)
    f.interaction.beginToolDrag({toolId:'geo',geo:'star'}); f.pointer('down',876,768)
    assert.throws(()=>f.interaction.dispatch({type:'pointer_move',time:0,point:{x:500,y:350}}),/单调/)
    f.pointer('cancel',500,350)
    assert.deepEqual(f.current(),f.initial)
  } finally { f.close() }
  assert.throws(()=>f.interaction.beginToolDrag({toolId:'geo'}),/关闭/)
})
