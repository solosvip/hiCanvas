import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands } from '../engine/index.js'
import { createImageGallery } from './renderer-preview/image-fixtures.js'

async function setup(commands = [], options = {}) {
  let snapshot = createImageGallery(undefined, true).snapshot, revision = 0, time = 0
  if (commands.length) snapshot = executeCanvasCommands(snapshot, commands).snapshot
  const commits = []; let commitGate = null
  const session = await createEditorSession({ actor: 'crop', transport: { read: async () => ({ snapshot, revision: String(revision) }), subscribe: () => () => {},
    commit: async request => { if(commitGate) await commitGate; assert.equal(request.expectedRevision, String(revision)); commits.push(request); const result = executeCanvasCommands(snapshot, request.commands); snapshot = result.snapshot; return { ...result, revision: String(++revision) } } } })
  const interaction = createCanvasInteraction({ session, edgeScrolling: false, ...options })
  const pointer = (type, x, y, extra = {}) => interaction.dispatch({ type: `pointer_${type}`, time: ++time, pointerId: 1, button: 0, buttons: type === 'up' ? 0 : 1, point: { x, y }, ...extra })
  const key = (key, extra = {}) => interaction.dispatch({ type: 'key_down', time: ++time, key, ...extra })
  const click = async (x, y) => { pointer('down', x, y); await pointer('up', x, y) }
  return { session, interaction, pointer, key, click, commits, input: value => interaction.dispatch({ ...value, time: ++time }), shape: () => session.store.get('shape:image-0'),
    pause: milliseconds => { time += milliseconds },
    holdCommit: () => { let resume; commitGate=new Promise(resolve=>{resume=resolve}); return ()=>{resume();commitGate=null} },
    crop: action => interaction.cropImage(action), snapshot: () => snapshot,
    remote: async commands => { snapshot = executeCanvasCommands(snapshot, commands).snapshot; revision++; await session.refresh() },
    close: () => { interaction.dispose(); session.dispose() } }
}

test('F13 逐帧右边裁剪跟手，松手一次提交；选择和裁剪状态不写入画板', async () => {
  const f = await setup()
  try {
    await f.click(220, 210); f.crop({ type: 'start' })
    assert.equal(f.interaction.state.get().croppingId, 'shape:image-0')
    f.pointer('down', 340, 210); f.pointer('move', 320, 210)
    assert.equal(f.shape().props.w, 220); assert.equal(f.commits.length, 0)
    f.pointer('move', 280, 210)
    assert.equal(f.shape().props.w, 180)
    assert.deepEqual(f.shape().props.crop, { topLeft: { x: 0, y: 0 }, bottomRight: { x: .75, y: 1 } })
    await f.pointer('up', 280, 210)
    assert.equal(f.commits.length, 1); assert.equal(f.commits[0].commands.length, 1)
    assert.equal(f.snapshot().store['shape:image-0'].props.w, 180)
    assert.ok(!JSON.stringify(f.commits).includes('croppingId'))
  } finally { f.close() }
})

test('F16 Esc 撤掉当前逐帧手势；Enter 退出，后续已提交裁剪保留', async () => {
  const f = await setup()
  try {
    await f.click(220,210); f.key('Enter')
    f.pointer('down',340,210); f.pointer('move',280,210); f.key('Escape')
    assert.equal(f.shape().props.w,240); assert.equal(f.commits.length,0)
    assert.equal(f.interaction.state.get().croppingId,'shape:image-0')
    await f.pointer('up',280,210)
    f.pointer('down',340,210); f.pointer('move',280,210); await f.pointer('up',280,210)
    f.key('Enter'); assert.equal(f.interaction.state.get().croppingId,null)
    assert.equal(f.shape().props.w,180); assert.equal(f.commits.length,1)
    f.crop({type:'start'}); f.crop({type:'zoom_begin'}); f.crop({type:'zoom',value:50}); f.crop({type:'zoom',value:100})
    assert.equal(f.commits.length,1); f.crop({type:'cancel'})
    assert.equal(f.shape().props.w,180); assert.equal(f.shape().props.crop.topLeft.x,0)
    f.crop({type:'zoom_begin'}); f.crop({type:'zoom',value:100}); await f.crop({type:'zoom_end'})
    assert.equal(f.commits.length,2); assert.equal(f.shape().props.w,180)
  } finally { f.close() }
})

test('F15 比例裁剪后的边柄保持比例；双击边界复位，双击图片进入裁剪', async () => {
  const f = await setup()
  try {
    await f.click(220,210)
    await f.click(220,210)
    assert.equal(f.interaction.state.get().croppingId,'shape:image-0')
    await f.crop({type:'aspect',preset:'square'})
    f.pointer('down',310,210); f.pointer('move',280,210)
    assert.equal(f.shape().props.w,150); assert.equal(f.shape().props.h,150)
    assert.equal(f.shape().y,135)
    await f.pointer('up',280,210)
    await f.click(280,210); await f.click(280,210)
    assert.ok(Math.abs(f.shape().props.w-240)<1e-9); assert.ok(Math.abs(f.shape().props.h-180)<1e-9)
  } finally { f.close() }
})

test('双击来自两次真实点击，超过400毫秒或16屏幕像素重新计数', async () => {
  for (const change of ['time','distance','button','pointerType']) {
    const f=await setup()
    try {
      await f.click(220,210)
      if(change==='time') f.pause(401)
      const x=change==='distance'?237:220, extra=change==='button'?{button:2}:change==='pointerType'?{pointerType:'pen'}:{}
      f.pointer('down',x,210,extra); await f.pointer('up',x,210,extra)
      assert.ok(!f.interaction.state.get().croppingId,change)
      // Start a fresh primary-mouse pair at the same point.
      f.pause(401); await f.click(220,210); f.pointer('down',220,210)
      assert.ok(!f.interaction.state.get().croppingId,'第二次按下时不进入裁剪')
      await f.pointer('up',220,210)
      assert.equal(f.interaction.state.get().croppingId,'shape:image-0',change)
      assert.equal(f.commits.length,0)
    } finally { f.close() }
  }
})

test('保存期间被忽略的点击不参与计数，保存结束后的单击不会误进裁剪', async () => {
  const f=await setup(); let resume, saving
  try {
    f.crop({type:'start',id:'shape:image-0'}); f.pointer('down',340,210); f.pointer('move',280,210)
    resume=f.holdCommit(); saving=f.pointer('up',280,210)
    assert.equal(f.session.state.get().isSubmitting,true)
    await f.click(220,210)
    resume(); await saving; f.key('Enter')
    await f.click(220,210)
    assert.ok(!f.interaction.state.get().croppingId)
    assert.equal(f.commits.length,1)
  } finally { resume?.(); await saving?.catch(()=>{}); f.close() }
})

test('F13 Ctrl 拖选中图片边柄临时裁剪，松手一次提交并回到选择', async () => {
  const f = await setup()
  try {
    await f.click(220,210)
    f.pointer('down',340,210,{ctrlKey:true}); f.pointer('move',280,210,{ctrlKey:true})
    assert.equal(f.shape().props.w,180); assert.equal(f.shape().props.crop.bottomRight.x,.75)
    await f.pointer('up',280,210,{ctrlKey:true})
    assert.equal(f.commits.length,1); assert.equal(f.interaction.state.get().croppingId,null)
  } finally { f.close() }
})

test('更换相机撤掉未保存裁剪；远端锁定后不覆盖远端，仍可重新进入', async () => {
  const f = await setup()
  try {
    await f.click(220,210); f.crop({type:'start'})
    f.pointer('down',340,210); f.pointer('move',280,210)
    f.interaction.setCamera({x:0,y:0,z:2})
    assert.equal(f.shape().props.w,240); assert.equal(f.commits.length,0)
    f.interaction.setCamera({x:0,y:0,z:1})
    f.pointer('down',340,210); f.pointer('move',280,210)
    await f.remote([{type:'update',id:'shape:image-0',changes:{isLocked:true}}])
    f.pointer('move',260,210); await f.pointer('up',260,210)
    assert.equal(f.shape().isLocked,true); assert.equal(f.commits.length,0)
    await f.remote([{type:'update',id:'shape:image-0',changes:{isLocked:false}}])
    f.crop({type:'start',id:'shape:image-0'}); f.pointer('down',340,210); f.pointer('move',280,210)
    await f.pointer('up',280,210); assert.equal(f.commits.length,1)
    f.pointer('down',280,210); f.pointer('move',260,210)
    await f.remote([{type:'update',id:'shape:image-0',changes:{isLocked:true}}])
    await f.remote([{type:'update',id:'shape:image-0',changes:{isLocked:false}}])
    f.crop({type:'start',id:'shape:image-0'})
    assert.equal(f.session.state.get().isGestureActive,false)
    f.pointer('down',280,210); f.pointer('move',260,210); await f.pointer('up',260,210)
    assert.equal(f.commits.length,2)
  } finally { f.close() }
})

test('八个裁剪柄沿旋转父容器局部轴工作，镜像保持，逐帧不读整份快照', async () => {
  const handles = [['top_left',0,0,20,10,220,170], ['top',120,0,0,10,240,170], ['top_right',240,0,-20,10,220,170], ['right',240,90,-20,0,220,180], ['bottom_right',240,180,-20,-10,220,170], ['bottom',120,180,0,-10,240,170], ['bottom_left',0,180,20,-10,220,170], ['left',0,90,20,0,220,180]]
  for (const [name,x,y,dx,dy,w,h] of handles) {
    const f = await setup([{type:'create_shape',id:'shape:frame',shapeType:'frame',x:400,y:200,rotation:.4,props:{w:1000,h:1000}}, {type:'update',id:'shape:image-0',changes:{parentId:'shape:frame',rotation:.3,props:{flipX:true,flipY:true}}}], {camera:{x:40,y:-20,z:.75}})
    try {
      f.crop({type:'start',id:'shape:image-0'})
      const overlay=f.interaction.state.get().overlays[0], camera=f.interaction.state.get().camera
      const point=(lx,ly)=>({x:(overlay.bounds.x+lx*Math.cos(.7)-ly*Math.sin(.7)+camera.x)*camera.z,y:(overlay.bounds.y+lx*Math.sin(.7)+ly*Math.cos(.7)+camera.y)*camera.z})
      const a=point(x,y), b=point(x+dx,y+dy), saved=f.session.store.getStoreSnapshot
      f.session.store.getStoreSnapshot=()=>{throw new Error('裁剪帧不许取整份快照')}
      f.pointer('down',a.x,a.y); f.pointer('move',(a.x+b.x)/2,(a.y+b.y)/2); f.pointer('move',b.x,b.y)
      assert.ok(Math.abs(f.shape().props.w-w)<1e-8,name); assert.ok(Math.abs(f.shape().props.h-h)<1e-8,name)
      f.session.store.getStoreSnapshot=saved
      await f.pointer('up',b.x,b.y)
      assert.equal(f.commits.length,1,name); assert.equal(f.shape().props.flipX,true); assert.equal(f.shape().props.flipY,true)
    } finally { f.close() }
  }
})

test('裁剪中 Shift 保持起点比例，移图保持裁剪框，远端目标变化拒绝覆盖', async () => {
  const f=await setup()
  try {
    f.crop({type:'start',id:'shape:image-0'}); f.pointer('down',340,210); f.pointer('move',280,210,{shiftKey:true})
    assert.equal(f.shape().props.w,180); assert.equal(f.shape().props.h,135); assert.equal(f.shape().y,142.5)
    await f.pointer('up',280,210,{shiftKey:true})
    f.pointer('down',220,210); f.pointer('move',200,210)
    assert.equal(f.shape().x,100); assert.equal(f.shape().props.w,180)
    assert.equal(f.commits.length,1); await f.pointer('up',200,210); assert.equal(f.commits.length,2)
    f.pointer('down',280,210)
    await f.remote([{type:'update',id:'shape:image-0',changes:{x:500}}])
    assert.throws(()=>f.pointer('move',260,210),error=>error.code==='conflict')
    assert.equal(f.shape().x,500); assert.equal(f.commits.length,2)
  } finally { f.close() }
})
