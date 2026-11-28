import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { canvasToolRegistry } from '../engine/index.js'
import { creationFixture } from './creation-test-fixture.mjs'

const content = text => ({ type: 'doc', content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }] })
const note = { id: 'shape:note', typeName: 'shape', type: 'note', x: 300, y: 300, rotation: 0, index: 'a1', parentId: 'page:page', isLocked: false, opacity: 1, meta: {}, props: { color: 'black', richText: content(''), size: 'm', font: 'draw', align: 'middle', verticalAlign: 'middle', labelColor: 'black', growY: 0, fontSizeAdjustment: 1, url: '', scale: 1, textFirstEditedBy: null } }

test('便签显式创建后复用文字会话，创建和首次输入整次撤销', async () => {
  assert.equal(typeof canvasToolRegistry.note, 'function')
  const f = await creationFixture()
  try {
    await f.key('N'); await f.click(400, 350)
    assert.equal(f.interaction.state.get().textEditing.kind, 'note')
    assert.equal(f.commits.length, 0)
    f.interaction.editText({ type: 'update', content: content('First note') })
    await f.interaction.editText({ type: 'finish' })
    assert.equal(f.shapes().length, 1)
    assert.equal(f.shapes()[0].type, 'note')
    assert.equal(f.commits.length, 1)
    await f.session.undo(); assert.equal(f.shapes().length, 0)
    await f.session.redo(); assert.equal(f.shapes().length, 1)
  } finally { f.close() }
})

test('普通便签取下一对象默认，四边相邻继承来源整体透明度且不污染默认', async () => {
  for (const direction of ['top', 'right', 'bottom', 'left']) {
    const f = await creationFixture({ commands: [putNote('shape:note', 300, 300, { richText: content('Source'), color: 'blue', font: 'sans', size: 's', align: 'start', verticalAlign: 'start' }, { opacity: .75 })] })
    try {
      await f.interaction.setStyles({ color: 'red', size: 'xl', font: 'mono', align: 'end', verticalAlign: 'end', opacity: .25 })
      await f.click(400, 400)
      const handle = f.interaction.state.get().overlays.find(o => o.kind === 'note').handles.find(h => h.id === direction)
      await f.click(handle.x, handle.y)
      const id = f.interaction.state.get().textEditing.id
      f.interaction.editText({ type: 'update', content: content('Adjacent') }); await f.key('Escape')
      const adjacent = f.current().store[id]
      assert.deepEqual([adjacent.props.color, adjacent.props.font, adjacent.props.size, adjacent.props.align, adjacent.props.verticalAlign, adjacent.opacity], ['blue', 'sans', 's', 'start', 'start', .75])
      await f.session.undo(); assert.equal(f.shapes().length, 1)
      await f.session.redo(); assert.deepEqual(f.current().store[id], adjacent)
      f.interaction.setTool('note'); await f.click(1000, 650)
      f.interaction.editText({ type: 'update', content: content('Ordinary') }); await f.key('Escape')
      const ordinary = f.shapes().at(-1)
      assert.deepEqual([ordinary.props.color, ordinary.props.font, ordinary.props.size, ordinary.props.align, ordinary.props.verticalAlign, ordinary.opacity], ['red', 'mono', 'xl', 'end', 'end', .25])
      assert.equal(f.commits.length, 2)
    } finally { f.close() }
  }
})

test('已有便签双击编辑，无宿主姓名时署名保持空值', async () => {
  const f = await creationFixture({ commands: [{ type: 'put', record: note }] })
  try {
    await f.click(400, 400); await f.click(400, 400)
    assert.equal(f.interaction.state.get().textEditing?.kind, 'note')
    f.interaction.editText({ type: 'update', content: content('Edited note') })
    await f.key('Escape')
    assert.deepEqual(f.shapes()[0].props.richText, content('Edited note'))
    assert.equal(f.shapes()[0].props.textFirstEditedBy, null)
    assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

const putNote = (id, x, y, props = {}, extra = {}) => ({ type: 'put', record: { ...structuredClone(note), id, x, y, ...extra, props: { ...structuredClone(note.props), ...props } } })
const begin = async f => { await f.click(400,400); await f.click(400,400) }

test('宿主显示名在首次输入时建立署名，空格算输入、清空移除，整次撤销和重做', async () => {
  const f = await creationFixture({ displayName: 'Avery Longname', commands: [putNote('shape:note',300,300)] })
  try {
    await begin(f)
    assert.equal(f.previewShapes()[0].props.textFirstEditedBy,null)
    f.interaction.editText({ type:'update', content:content('   ') })
    const author = f.previewShapes()[0].props.textFirstEditedBy
    assert.ok(author)
    assert.equal(f.session.store.get(`user:${author}`).name,'Avery Longname')
    await f.key('Escape'); assert.equal(f.commits.length,1)
    await f.session.undo(); assert.equal(f.shapes()[0].props.textFirstEditedBy,null)
    await f.session.redo(); assert.equal(f.shapes()[0].props.textFirstEditedBy,author)
    await begin(f); f.interaction.editText({type:'update',content:content('')}); await f.key('Escape')
    assert.equal(f.shapes()[0].props.textFirstEditedBy,null)
  } finally { f.close() }
})

for (const [direction,x,y] of [['top',300,90],['right',510,300],['bottom',300,510],['left',90,300]]) test(`相邻${direction}柄与覆盖层同坐标，创建和输入只提交一次`, async () => {
  const f=await creationFixture({commands:[putNote('shape:note',300,300,{richText:content('Source'),color:'blue',font:'serif'})]})
  try {
    await f.click(400,400)
    const overlay=f.interaction.state.get().overlays.find(o=>o.kind==='note'),handle=overlay.handles.find(h=>h.id===direction)
    await f.click(handle.x,handle.y)
    const id=f.interaction.state.get().textEditing.id
    assert.notEqual(id,'shape:note'); assert.equal(f.commits.length,0)
    f.interaction.editText({type:'update',content:content('Adjacent')}); await f.key('Escape')
    const added=f.shapes().find(s=>s.id===id)
    assert.deepEqual([added.x,added.y],[x,y]); assert.equal(added.props.color,'blue'); assert.equal(added.props.font,'serif')
    assert.equal(f.commits.length,1); await f.session.undo(); assert.equal(f.shapes().length,1)
    await f.session.redo(); assert.equal(f.shapes().length,2)
  }finally{f.close()}
})

for(const [key,mods,x,y] of [['Tab',{},510,300],['Tab',{shiftKey:true},90,300],['Enter',{metaKey:true},300,510],['Enter',{ctrlKey:true,shiftKey:true},300,90]])test(`便签续建 ${key} ${JSON.stringify(mods)} 整次提交源文和新邻居`,async()=>{
 const f=await creationFixture({commands:[putNote('shape:note',300,300,{}, {opacity:.75})]})
 try{
  await f.interaction.setStyles({opacity:.25,color:'red'})
  await begin(f); f.interaction.editText({type:'update',content:content('Source')}); await f.key(key,mods)
  assert.equal(f.commits.length,1);const id=f.interaction.state.get().textEditing.id
  assert.notEqual(id,'shape:note'); assert.deepEqual([f.shapes().find(s=>s.id===id).x,f.shapes().find(s=>s.id===id).y],[x,y])
  assert.equal(f.current().store[id].opacity,.75);assert.equal(f.interaction.getStyles().next.opacity,.25)
  await f.key('Escape');assert.equal(f.commits.length,1)
  await f.session.undo();assert.equal(f.shapes().length,1);assert.deepEqual(f.shapes()[0].props.richText,content(''))
  assert.equal(Object.values(f.current().store).some(r=>r.typeName==='instance'),false)
 }finally{f.close()}
})

test('RTL续建方向反转并复用已有邻位，组合输入与重复键不续建',async()=>{
 const f=await creationFixture({commands:[putNote('shape:note',300,300,{richText:content('مرحبا')}),putNote('shape:existing',90,300,{}, {index:'a2'})]})
 try{
  await begin(f);await f.key('Tab',{isComposing:true});await f.key('Tab',{repeat:true})
  assert.equal(f.interaction.state.get().textEditing.id,'shape:note')
  await f.key('Tab');assert.equal(f.interaction.state.get().textEditing.id,'shape:existing');assert.equal(f.shapes().length,2)
 }finally{f.close()}
})

for(const [x,expected]of [[501,510],[519,510],[500,500],[520,520]])test(`便签拖动${x}：旧版9/10边界和松手整次撤销`,async()=>{
 const f=await creationFixture({commands:[putNote('shape:target',300,300),putNote('shape:note',800,300,{}, {index:'a2'})]})
 try{
  f.pointer('down',900,400);f.pointer('move',x+100,400)
  assert.equal(f.previewShapes().find(s=>s.id==='shape:note').x,expected);assert.equal(f.commits.length,0)
  await f.pointer('up',x+100,400);assert.equal(f.shapes().find(s=>s.id==='shape:note').x,expected)
  assert.equal(f.commits.length,1);assert.equal(f.interaction.state.get().overlays.some(o=>o.kind==='snap'),false)
  await f.session.undo();assert.equal(f.shapes().find(s=>s.id==='shape:note').x,800)
 }finally{f.close()}
})

test('相邻便签的缩放尺寸、长便签下方及父级旋转使用原几何',async()=>{
 const f=await creationFixture({commands:[{type:'create_shape',id:'shape:frame',shapeType:'frame',x:700,y:100,rotation:Math.PI/2,props:{w:600,h:600}},putNote('shape:note',100,100,{scale:.5,growY:100},{parentId:'shape:frame',index:'a2'})]})
 try{
  await f.click(525,250)
  const handle=f.interaction.state.get().overlays.find(o=>o.kind==='note').handles.find(h=>h.id==='bottom')
  await f.click(handle.x,handle.y); await f.key('Escape')
  const added=f.shapes().find(s=>s.type==='note'&&s.id!=='shape:note')
  assert.equal(added.parentId,'shape:frame');assert.deepEqual([added.x,added.y],[100,255]);assert.equal(added.props.scale,.5);assert.equal(added.props.growY,0)
 }finally{f.close()}
})

test('输入再清空不留下作者记录或空撤销，已有作者不被后编辑者替换',async()=>{
 const f=await creationFixture({displayName:'New Author',commands:[putNote('shape:note',300,300)]})
 try{
  await begin(f);f.interaction.editText({type:'update',content:content('Draft')});f.interaction.editText({type:'update',content:content('')});await f.key('Escape')
  assert.equal(f.commits.length,0);assert.equal(Object.values(f.current().store).some(r=>r.typeName==='user'),false)
 }finally{f.close()}
 const g=await creationFixture({displayName:'New Author',commands:[{type:'put',record:{id:'user:original',typeName:'user',name:'Original Author',color:'blue',imageUrl:'',meta:{}}},putNote('shape:note',300,300,{textFirstEditedBy:'original',richText:content('Old')})]})
 try{await begin(g);g.interaction.editText({type:'update',content:content('Revised')});await g.key('Escape');assert.equal(g.shapes()[0].props.textFirstEditedBy,'original')}finally{g.close()}
})

test('续建保存失败保留源草稿，重试只有一个邻居且不丢远端位置',async()=>{
 let fail=true
 const f=await creationFixture({commands:[putNote('shape:note',300,300)],beforeCommit:()=>{if(fail)throw Object.assign(new Error('Synthetic offline'),{code:'offline'})}})
 try{
  await begin(f);f.interaction.editText({type:'update',content:content('Retained')})
  await assert.rejects(f.key('Tab'),/Synthetic offline/)
  assert.equal(f.interaction.state.get().textEditing.id,'shape:note');assert.deepEqual(f.interaction.state.get().textEditing.content,content('Retained'));assert.equal(f.shapes().length,1)
  fail=false;await f.remote([{type:'update',id:'shape:note',changes:{x:320}}]);await f.key('Tab')
  assert.equal(f.shapes().length,2);assert.equal(f.shapes()[0].x,320);assert.equal(f.shapes()[1].x,530)
  await f.key('Escape');assert.equal(f.commits.length,2)
 }finally{f.close()}
})

test('远端同字段冲突保留便签草稿，不创建邻居、不覆盖对方内容',async()=>{
 const f=await creationFixture({commands:[putNote('shape:note',300,300)]})
 try{
  await begin(f);f.interaction.editText({type:'update',content:content('Local')})
  await f.remote([{type:'update',id:'shape:note',changes:{props:{richText:content('Remote')}}}])
  assert.equal(await f.key('Tab'),false);assert.equal(f.shapes().length,1);assert.deepEqual(f.shapes()[0].props.richText,content('Remote'))
  assert.deepEqual(f.interaction.state.get().textEditing.content,content('Local'));assert.equal(f.commits.length,0)
 }finally{f.close()}
})

test('径向吸附、Ctrl实时修饰、缩放阈值和取消无残留',async()=>{
 for(const [dx,dy,zoom,snaps]of [[6,6,1,true],[8,8,1,false],[4,0,2,true],[5,0,2,false]]){
  const f=await creationFixture({camera:{x:0,y:0,z:zoom},commands:[putNote('shape:target',300,300),putNote('shape:note',800,300,{}, {index:'a2'})]})
  try{
   f.pointer('down',900*zoom,400*zoom);f.pointer('move',(610+dx)*zoom,(400+dy)*zoom,{ctrlKey:true})
   const moving=f.previewShapes().find(s=>s.id==='shape:note');assert.deepEqual([moving.x,moving.y],snaps?[510,300]:[510+dx,300+dy])
   await f.key('Escape');assert.equal(f.shapes().find(s=>s.id==='shape:note').x,800);assert.equal(f.commits.length,0);assert.equal(f.interaction.state.get().overlays.some(o=>o.kind==='snap'),false)
  }finally{f.close()}
 }
})

test('409重放按最新源便签位置重算邻位，整次只保存一次',async()=>{
 let once=true,f
 f=await creationFixture({commands:[putNote('shape:note',300,300)],beforeCommit:async()=>{if(once){once=false;await f.remote([{type:'update',id:'shape:note',changes:{x:700}}],false)}}})
 try{
  await begin(f);f.interaction.editText({type:'update',content:content('Retained after 409')});await f.key('Tab')
  assert.equal(f.shapes()[0].x,700);assert.equal(f.shapes()[1].x,910)
  assert.deepEqual(f.shapes()[0].props.richText,content('Retained after 409'));await f.key('Escape');await f.session.undo();assert.equal(f.shapes().length,1);assert.equal(f.shapes()[0].x,700)
 }finally{f.close()}
})

test('Space临时手形拥有便签柄输入，不能误续建',async()=>{
 const f=await creationFixture({commands:[putNote('shape:note',300,300)]})
 try{
  await f.click(400,400);await f.key(' ');await f.click(500,400)
  assert.equal(f.previewShapes().length,1);assert.equal(f.interaction.state.get().textEditing,null)
  await f.key(' ',{},'key_up');assert.equal(f.commits.length,0)
 }finally{f.close()}
})

test('续建提交中焦点转到表单或切换工具，完成后不抢回文字焦点',async()=>{
 for(const cancel of [f=>f.interaction.setInputContext({owner:'form'}),f=>f.interaction.setTool('hand')]){
  let release,entered
  const enteredPromise=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve)
  const f=await creationFixture({commands:[putNote('shape:note',300,300)],beforeCommit:async()=>{entered();await gate}})
  try{
   await begin(f);f.interaction.editText({type:'update',content:content('Saved source')});const saving=f.key('Tab');await enteredPromise
   cancel(f);release();await saving
   assert.equal(f.interaction.state.get().textEditing,null);assert.equal(f.shapes().length,2);assert.equal(f.commits.length,1)
  }finally{release();f.close()}
 }
})

test('从便签+起手的第二触点由统一双指导航接管',async()=>{
 const f=await creationFixture({commands:[putNote('shape:note',300,300)]})
 try{
  await f.click(400,400)
  f.pointer('down',500,400,{pointerType:'touch',pointerId:11});f.pointer('down',600,400,{pointerType:'touch',pointerId:12});f.pointer('move',700,400,{pointerType:'touch',pointerId:12})
  assert.equal(f.interaction.state.get().camera.z,2)
  await f.pointer('up',500,400,{pointerType:'touch',pointerId:11});await f.pointer('up',700,400,{pointerType:'touch',pointerId:12})
  assert.equal(f.previewShapes().length,1);assert.equal(f.commits.length,0);assert.equal(f.interaction.state.get().textEditing,null)
 }finally{f.close()}
})

test('已有无署名文字只查看或切到邻位，不冒认作者、不生成源文改动',async()=>{
 const f=await creationFixture({displayName:'Viewer',commands:[putNote('shape:note',300,300,{richText:content('Existing unsigned text')})]})
 try{
  await begin(f);await f.key('Escape');assert.equal(f.commits.length,0);assert.equal(f.shapes()[0].props.textFirstEditedBy,null)
  await begin(f);await f.key('Tab');assert.equal(f.shapes()[0].props.textFirstEditedBy,null);assert.equal(f.commits.length,1)
  assert.equal(f.commits[0].commands.some(c=>c.id==='shape:note'||c.record?.id==='shape:note'),false)
 }finally{f.close()}
})

test('已有署名便签清空后恢复原文，净空往返保留原作者和空撤销',async()=>{
 const f=await creationFixture({displayName:'Viewer',commands:[{type:'put',record:{id:'user:original',typeName:'user',name:'Original Author',color:'blue',imageUrl:'',meta:{}}},putNote('shape:note',300,300,{richText:content('Old'),textFirstEditedBy:'original'})]})
 try{
  await begin(f);f.interaction.editText({type:'update',content:content('')});assert.equal(f.previewShapes()[0].props.textFirstEditedBy,null)
  f.interaction.editText({type:'update',content:content('Old')});await f.key('Escape')
  assert.equal(f.shapes()[0].props.textFirstEditedBy,'original');assert.equal(f.commits.length,0)
  assert.equal(Object.values(f.current().store).filter(r=>r.typeName==='user').length,1)
 }finally{f.close()}
})

test('无输入或净空往返后收到远端署名，完成编辑不抹掉最新作者',async()=>{
 for(const change of [false,true]){
  const f=await creationFixture({displayName:'Viewer',commands:[putNote('shape:note',300,300,{richText:content('Old')})]})
  try{
   await begin(f)
   if(change){f.interaction.editText({type:'update',content:content('')});f.interaction.editText({type:'update',content:content('Old')})}
   await f.remote([{type:'put',record:{id:'user:remote',typeName:'user',name:'Remote Author',color:'blue',imageUrl:'',meta:{}}},{type:'update',id:'shape:note',changes:{props:{textFirstEditedBy:'remote'}}}])
   await f.key('Escape');assert.equal(f.shapes()[0].props.textFirstEditedBy,'remote');assert.equal(f.commits.length,0)
  }finally{f.close()}
 }
})


for (const owner of ['button', 'toolbar-button', 'anchor', 'menu-trigger']) test(`${owner}焦点下便签续建入口可见、可用且只有一步历史`, async () => {
  const f = await creationFixture({ commands: [putNote('shape:note', 300, 300, { richText: content('Source') })] })
  try {
    await f.click(400, 400); f.interaction.setInputContext({ owner })
    const overlay = f.interaction.state.get().overlays.find(o => o.kind === 'note')
    assert.ok(overlay, '控件聚焦不能隐藏续建入口')
    const right = overlay.handles.find(h => h.id === 'right')
    const initial = structuredClone(f.current())
    await f.click(right.x, right.y)
    const id = f.interaction.state.get().textEditing.id
    assert.notEqual(id, 'shape:note'); assert.equal(f.commits.length, 0)
    f.interaction.editText({ type: 'update', content: content('Neighbour') }); await f.key('Escape')
    const saved = structuredClone(f.current())
    assert.equal(f.commits.length, 1); assert.equal(f.shapes().length, 2)
    await f.session.undo(); assert.deepEqual(f.current(), initial)
    await f.session.redo(); assert.deepEqual(f.current(), saved)
    await f.click(400, 400); f.interaction.setInputContext({ owner }); await f.click(right.x, right.y)
    assert.equal(f.interaction.state.get().textEditing.id, id)
    assert.equal(f.shapes().length, 2); assert.equal(f.commits.length, 1)
    await f.key('Escape')
  } finally { f.close() }
})

const protectedNoteContexts = [
  ['input', { owner: 'form' }], ['textarea', { owner: 'form' }], ['contenteditable', { owner: 'form' }],
  ['文字编辑', { owner: 'text-editing' }], ['展开菜单', { owner: 'menu-trigger', expanded: true }],
  ['select', { owner: 'select' }], ['video', { owner: 'form' }], ['组字', { owner: 'canvas', isComposing: true }],
]
for (const [label, context] of protectedNoteContexts) test(`${label}焦点仍隐藏便签续建入口`, async () => {
  const f = await creationFixture({ commands: [putNote('shape:note', 300, 300)] })
  try {
    await f.click(400, 400); f.interaction.setInputContext(context)
    assert.equal(f.interaction.state.get().overlays.some(o => o.kind === 'note'), false)
    assert.equal(f.previewShapes().length, 1); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('文字会话里的续建提交期间焦点落到按钮，完成后也不抢回文字焦点', async () => {
  let entered, release
  const waiting = new Promise(resolve => entered = resolve), gate = new Promise(resolve => release = resolve)
  const f = await creationFixture({ commands: [putNote('shape:note', 300, 300)], beforeCommit: async () => { entered(); await gate } })
  try {
    await begin(f); f.interaction.editText({ type: 'update', content: content('Saved source') })
    const saving = f.key('Tab'); await waiting
    f.interaction.setInputContext({ owner: 'button' }); release(); await saving
    assert.equal(f.interaction.state.get().textEditing, null)
    assert.equal(f.interaction.state.get().inputContext.owner, 'button')
    assert.equal(f.shapes().length, 2); assert.equal(f.commits.length, 1)
  } finally { release(); f.close() }
})
