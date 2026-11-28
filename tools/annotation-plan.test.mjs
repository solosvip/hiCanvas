import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasAnnotationCapture } from '../engine/index.js'
import { preflightCanvasExport } from '../renderer/index.js'
import { creationFixture } from './creation-test-fixture.mjs'

const image = (x = 200, y = 200, w = 200, h = 140) => ({ type: 'create_shape', id: 'shape:target', shapeType: 'image', x, y, props: { w, h } })
const arrow = (id, x, y, end, extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'arrow', x, y, props: { start: { x: 0, y: 0 }, end, bend: 0, color: 'red' }, ...extra })
async function capture(commands) {
  const f = await creationFixture({ commands })
  const action = createCanvasAnnotationCapture({ session: f.session, interaction: f.interaction, preflight: preflightCanvasExport, render: async (snapshot, options) => ({ ...preflightCanvasExport(snapshot, options), status: 'complete', mime: 'image/png', bytes: new Uint8Array([1]) }) })
  try { return await action.run({ targetId: 'shape:target' }) }
  finally { action.dispose(); f.close() }
}

test('标注按页面AABB汇集，接触算附近，输出并集四边32留白及实际编码尺寸', async () => {
  const result = await capture([image(), arrow('touch', 600, 300, { x: 80, y: 0 }), arrow('outside', 600.01, 450, { x: 80, y: 0 })])
  assert.deepEqual(result.ids, ['shape:target', 'shape:touch'])
  assert.deepEqual(result.sourceBounds, { x: 200, y: 200, w: 480, h: 140 })
  assert.deepEqual(result.bounds, { x: 168, y: 168, w: 544, h: 204 })
  assert.deepEqual([result.scale, result.width, result.height], [2, 1088, 408])
})

test('四边四角在160/200/720外扩边界内收集，越0.01不收；只按AABB相交', async () => {
  for (const [edge, margin] of [[40, 160], [200, 200], [1000, 720]]) for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]]) {
    const x = dx < 0 ? -margin - 1 : dx > 0 ? edge + margin : edge / 2
    const y = dy < 0 ? -margin - 1 : dy > 0 ? edge + margin : edge / 2
    const commands = [image(0,0,edge,edge), arrow('a',x,y,{x:1,y:1})]
    assert.deepEqual((await capture(commands)).ids, ['shape:target','shape:a'])
    commands[1].x += dx * .01; commands[1].y += dy * .01
    assert.deepEqual((await capture(commands)).ids, ['shape:target'])
  }
  // Observed counterexample: path x+y=1200 never enters the nearby box,
  // whose maximum x+y is1140, but its rectangle does overlap it.
  assert.deepEqual((await capture([image(),arrow('a',700,500,{x:-200,y:200})])).ids,['shape:target','shape:a'])
})

test('两遍收集消除同几何层序漏字，120接触包含，文字之间不递归扩散', async () => {
  const label = (id,x) => ({type:'create_shape',id:`shape:${id}`,shapeType:'text',x,y:300,text:'Label',props:{color:'red',autoSize:false,w:40}})
  const a = arrow('a',570,250,{x:300,y:0})
  for (const order of [[a,label('label',850)],[label('label',850),a]]) {
    assert.deepEqual((await capture([image(),...order,label('chain',1000)])).ids,['shape:target','shape:a','shape:label'])
  }
  for (const [x, included] of [[989.99,true],[990,true],[990.01,false]]) {
    assert.equal((await capture([image(),a,label('boundary',x)])).ids.includes('shape:boundary'),included)
  }
})

test('显式身份兼容旧颜色和红色label，锁定和零透明不排除；普通蓝黑不收', async () => {
  const samples = [
    ['meta',{color:'black',labelColor:'black'},{cowartAnnotationArrow:true},true],
    ['red',{color:'red'}, {},true],['yellow',{color:'yellow'},{},true],['orange',{color:'orange'},{},true],
    ['label',{color:'black',labelColor:'red'},{},true],['blue',{color:'blue',labelColor:'blue'},{},false],['black',{color:'black',labelColor:'black'},{},false],
  ]
  for (const [id,props,meta,expected] of samples) {
    const a=arrow(id,250,250,{x:80,y:20});Object.assign(a.props,props);a.meta=meta
    const commands=[image(),a,{type:'update',id:`shape:${id}`,changes:{isLocked:true,opacity:0}}]
    assert.equal((await capture(commands)).ids.includes(`shape:${id}`),expected)
  }
  const result=await capture([image(),{type:'create_shape',id:'shape:text',shapeType:'text',x:250,y:250,text:'black',meta:{cowartAnnotationText:true}},{type:'create_shape',id:'shape:ordinary',shapeType:'text',x:250,y:250,text:'black'}])
  assert.deepEqual(result.ids,['shape:target','shape:text'])
})

test('目标只按类别校验，空图片和幻灯片可用，空holder和普通框不混入', async () => {
  for (const [shapeType,meta,accepted] of [['image',{},true],['embed',{cowartHtmlDraft:true},true],['embed',{cowartHtmlDraft:true,cowartFilm:true},true],['frame',{cowartAiSlides:true},true],['frame',{cowartAiImageHolder:true},false],['frame',{},false],['geo',{},false]]) {
    const commands=[{type:'create_shape',id:'shape:target',shapeType,meta,props:{w:200,h:140,...(shapeType==='embed'&&{url:'data:text/html,synthetic'})}}]
    if(accepted) assert.deepEqual((await capture(commands)).ids,['shape:target'])
    else await assert.rejects(capture(commands),/请选择/)
  }
})

test('父框旋转和嵌套组用完整页面范围，父框裁掉的标注仍加入计划',async()=>{
  const commands=[{type:'create_shape',id:'shape:frame',shapeType:'frame',x:500,y:400,rotation:Math.PI/2,props:{w:100,h:100}},image(0,0,40,40),arrow('clipped',140,0,{x:50,y:0}),{type:'update',id:'shape:target',changes:{parentId:'shape:frame'}},{type:'update',id:'shape:clipped',changes:{parentId:'shape:frame'}}]
  const result=await capture(commands)
  assert.deepEqual(result.ids,['shape:target','shape:clipped'])
  assert.ok(result.sourceBounds.y+result.sourceBounds.h>=590)
  assert.equal(result.sourceBounds.x,460)
})

test('倍率切换、4096单边与1600万总像素包含边界，编码向外取整且不偷偷缩小',async()=>{
  for(const [w,scale,width] of [[936,2,2000],[937,1.5,1502],[1536,1.5,2400],[1537,1,1601],[4032,1,4096]]){
    const result=await capture([image(0,0,w,100)])
    assert.deepEqual([result.scale,result.width],[scale,width])
  }
  const fraction=await capture([image(200.25,200.5,330.25,140.5)])
  assert.deepEqual([fraction.width,fraction.height],[790,410])
  for(const [w,h,allowed] of [[4031,100,true],[4032,100,true],[4033,100,false],[100,4033,false],[3936,3935,true],[3936,3936,true],[3936,3937,false],[10000,100,false]]){
    if(allowed) assert.equal((await capture([image(0,0,w,h)])).status,'complete')
    else await assert.rejects(capture([image(0,0,w,h)]),error=>error.code==='annotation-size-limit'&&error.width===w+64&&error.height===h+64&&/4096px.*1600万.*缩小/.test(error.message))
  }
})

test('旧HTML的data和本机素材虚拟地址仍可分类，普通远端网址不算生成内容',async()=>{
  for(const url of ['data:text/html,synthetic','/assets/synthetic.html','/c/synthetic/page-assets/draft.htm','http://cowart.local/page-assets/draft.html']){
    const result=await capture([{type:'create_shape',id:'shape:target',shapeType:'embed',props:{url,w:200,h:140}}])
    assert.deepEqual(result.ids,['shape:target'])
  }
  await assert.rejects(capture([{type:'create_shape',id:'shape:target',shapeType:'embed',props:{url:'https://example.invalid/plain.html',w:200,h:140}}]),/请选择/)
})
