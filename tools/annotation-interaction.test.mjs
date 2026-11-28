import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { toRichText } from '@tldraw/tlschema'
import { creationFixture } from './creation-test-fixture.mjs'
import { getShapeTextLayout, createConnectionContext, getConnectionGeometry } from '../renderer/geometry.js'

test('新建空标签在接入文字视图前已有可用的弧线标签布局', async () => {
  const f = await creationFixture()
  try {
    f.key('c'); f.pointer('down', 500, 280); await f.pointer('up', 350, 280)
    const shape = f.session.store.get(f.interaction.state.get().textEditing.id)
    const before = structuredClone(shape)
    for (const context of [undefined, createConnectionContext(f.session.store.allRecords())]) {
      for (const content of ['', ' \n\t', '已有标签']) for (const annotation of [true, false]) {
        const record = { ...shape, meta: { cowartAnnotationArrow: annotation }, props: { ...shape.props, labelPosition: annotation ? 0 : .5, richText: toRichText(content) } }
        const saved = structuredClone(record), layout = getShapeTextLayout(record, context)
        assert.ok([layout.x, layout.y, layout.w, layout.h].every(Number.isFinite))
        assert.ok(layout.h > 0)
        if (content.trim()) assert.deepEqual(layout.bounds, getConnectionGeometry(record, context).label.bounds)
        else if (annotation) assert.deepEqual(layout.center, { x: 0, y: 0 })
        assert.deepEqual(record, saved)
      }
    }
    assert.deepEqual(shape, before)
    assert.deepEqual(shape.props.richText, toRichText(''))
  } finally { f.close() }
})

test('C 创建弧形标注并编辑起点标签，新建和首次文字只占一步撤销', async () => {
  const f = await creationFixture({ commands: [{ type: 'create_shape', id: 'shape:existing', shapeType: 'geo', x: 900 }] })
  try {
    f.interaction.setCreationOptions({ toolLocked: true })
    f.key('c')
    assert.equal(f.interaction.state.get().toolId, 'annotation')
    assert.equal(f.interaction.state.get().creation.toolLocked, false)
    f.pointer('down', 200, 300); f.pointer('move', 500, 300); await f.pointer('up', 500, 300)
    const state = f.interaction.state.get(), id = state.textEditing.id
    assert.equal(state.inputContext.owner, 'text-editing')
    assert.equal(f.commits.length, 0)
    const arrow = f.session.store.get(id)
    assert.equal(arrow.meta.cowartAnnotationArrow, true)
    assert.deepEqual(Object.fromEntries(['kind', 'dash', 'color', 'labelColor', 'labelPosition', 'bend'].map(k => [k, arrow.props[k]])), { kind: 'arc', dash: 'draw', color: 'red', labelColor: 'red', labelPosition: 0, bend: -36 })
    assert.equal(f.session.store.allRecords().filter(r => r.typeName === 'binding').length, 0)
    f.interaction.editText({ type: 'update', content: toRichText('中文 annotation 🙂\n第二行') })
    await f.key('Escape')
    assert.equal(f.commits.length, 1)
    assert.equal(f.interaction.state.get().toolId, 'select')
    assert.equal(f.interaction.state.get().textEditing, null)
    assert.equal(f.interaction.state.get().inputContext.owner, 'canvas')
    const saved = f.current()
    await f.session.undo()
    assert.deepEqual(f.shapes().map(s => s.id), ['shape:existing'])
    await f.session.redo(); assert.deepEqual(f.current(), saved)
  } finally { f.close() }
})

test('短拖按屏幕8px判定；Esc和pointercancel撤掉草稿但保留工具，空标签保存', async () => {
  for (const z of [.5, 1, 2]) {
    const f = await creationFixture({ camera: { x: 0, y: 0, z } })
    try {
      f.key('c'); f.pointer('down', 100, 100); await f.pointer('up', 107.99, 100)
      assert.equal(f.previewShapes().length, 0); assert.equal(f.commits.length, 0)
      assert.equal(f.interaction.state.get().toolId, 'annotation')
      for (const cancel of ['Escape', 'pointercancel']) {
        f.pointer('down', 100, 100); f.pointer('move', 140, 100)
        if (cancel === 'Escape') await f.key(cancel); else await f.pointer('cancel', 140, 100)
        assert.equal(f.previewShapes().length, 0); assert.equal(f.session.state.get().isGestureActive, false)
        assert.equal(f.interaction.state.get().toolId, 'annotation')
      }
      f.pointer('down', 100, 100); await f.pointer('up', 108, 100)
      const id = f.interaction.state.get().textEditing.id
      assert.equal(f.session.store.get(id).props.end.x, 8 / z)
      await f.key('Escape')
      assert.equal(f.shapes().length, 1); assert.equal(f.commits.length, 1)
      await f.session.undo(); assert.equal(f.shapes().length, 0)
      f.interaction.setTool('annotation'); await f.key('Escape')
      assert.equal(f.interaction.state.get().toolId, 'select')
    } finally { f.close() }
  }
})

test('已有标签改字独立撤销，组字不误完成；标注失焦保存且不抢回表单焦点', async () => {
  const f = await creationFixture()
  try {
    f.key('c'); f.pointer('down', 100, 200); await f.pointer('up', 400, 200)
    const id = f.interaction.state.get().textEditing.id
    f.interaction.editText({ type: 'update', content: toRichText('首次') }); await f.key('Escape')
    f.interaction.editText({ type: 'begin', id })
    f.interaction.editText({ type: 'update', content: toRichText('再次') })
    f.interaction.setInputContext({ owner: 'text-editing', isComposing: true })
    await f.key('Enter', { metaKey: true, isComposing: true })
    assert.equal(f.interaction.state.get().textEditing.id, id); assert.equal(f.commits.length, 1)
    f.interaction.setInputContext({ owner: 'text-editing', isComposing: false })
    await f.interaction.setInputContext({ owner: 'form' })
    assert.equal(f.interaction.state.get().textEditing, null)
    assert.equal(f.interaction.state.get().inputContext.owner, 'form')
    assert.equal(f.commits.length, 2)
    await f.session.undo()
    assert.equal(f.current().store[id].props.richText.content[0].content[0].text, '首次')
    await f.session.redo()
    assert.equal(f.current().store[id].props.richText.content[0].content[0].text, '再次')
  } finally { f.close() }
})

test('弧度按主要方向和长度分档，保持默认颜色来源且不改下一对象样式',async()=>{
  for(const [dx,dy,bend]of [[20,0,-16],[100,0,-16],[300,0,-36],[600,0,-48],[-300,0,36],[0,300,36],[0,-300,36],[100,100,-Math.hypot(100,100)*.12],[-100,-100,Math.hypot(100,100)*.12]]){
    const f=await creationFixture()
    try{
      await f.interaction.setStyles({color:'blue',font:'mono',size:'xl'})
      const next=f.interaction.getStyles().next
      f.key('c');f.pointer('down',600,400);f.pointer('move',600+dx,400+dy)
      assert.equal(f.previewShapes()[0].props.bend,0)
      await f.pointer('up',600+dx,400+dy)
      const record=f.session.store.get(f.interaction.state.get().textEditing.id)
      assert.equal(record.props.bend,bend);assert.equal(record.props.color,'blue');assert.equal(record.props.labelColor,'blue')
      assert.equal(record.props.font,'draw');assert.equal(record.props.size,'m')
      await f.key('Enter',{ctrlKey:true})
      assert.equal(f.interaction.state.get().textEditing,null)
      assert.deepEqual(f.interaction.getStyles().next,next)
    }finally{f.close()}
  }
})

test('C遵守表单/菜单、快捷键开关和组字门禁，组合键不抢复制入口',async()=>{
  const f=await creationFixture()
  try{
    for(const owner of ['form','menu','text-editing']){
      f.interaction.setInputContext({owner});await f.key('c');assert.equal(f.interaction.state.get().toolId,'select')
    }
    f.interaction.setInputContext({owner:'canvas',isComposing:true});await f.key('c');assert.equal(f.interaction.state.get().toolId,'select')
    f.interaction.setInputContext({owner:'canvas'});f.interaction.setShortcutsEnabled(false)
    await f.key('c');assert.equal(f.interaction.state.get().toolId,'select')
    f.interaction.setShortcutsEnabled(true)
    for(const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{repeat:true},{isComposing:true},{keyCode:229}]){
      await f.key('c',extra);assert.equal(f.interaction.state.get().toolId,'select')
    }
    assert.equal(f.commits.length,0);assert.equal(f.previewShapes().length,0)
  }finally{f.close()}
})

test('父级远端改变取消草稿，标签保存失败保留草稿且重试不抢新工具',async()=>{
  const f=await creationFixture({commands:[{type:'create_shape',id:'shape:frame',shapeType:'frame',x:200,y:200,props:{w:300,h:200}}]})
  try{
    f.key('c');f.pointer('down',250,250);f.pointer('move',350,280)
    await f.remote([{type:'update',id:'shape:frame',changes:{rotation:.3}}])
    assert.throws(()=>f.pointer('move',380,290),/改变/)
    assert.equal(f.previewShapes().length,1);assert.equal(f.current().store['shape:frame'].rotation,.3)
    assert.equal(f.commits.length,0)
  }finally{f.close()}
  let fail=true
  const g=await creationFixture({beforeCommit:()=>{if(fail)throw new Error('Synthetic annotation save failed')}})
  try{
    g.key('c');g.pointer('down',100,200);await g.pointer('up',300,200)
    g.interaction.editText({type:'update',content:toRichText('保留草稿')})
    await assert.rejects(g.key('Escape'),/save failed/)
    assert.equal(g.interaction.state.get().textEditing.content.content[0].content[0].text,'保留草稿')
    assert.equal(g.current().store[g.interaction.state.get().textEditing.id],undefined)
    g.interaction.setTool('hand');fail=false
    await g.interaction.editText({type:'finish'})
    assert.equal(g.interaction.state.get().toolId,'hand');assert.equal(g.shapes().length,1)
  }finally{g.close()}
})

test('永久原生夹具全部通过真实公开会话的文档校验',async()=>{
  const {createAnnotationFixture}=await import('./renderer-preview/annotation-fixture.js')
  const {createEditorSession}=await import('../engine/index.js')
  for(const kind of ['drawing','static','fraction','edge','edge-over','area','area-over','web','slides']){
    const data=createAnnotationFixture(kind)
    const session=await createEditorSession({actor:'synthetic',transport:{read:async()=>({snapshot:data.snapshot,revision:'0'}),subscribe:()=>()=>{},commit:async()=>{throw Error('只读夹具不提交')}}})
    try{assert.equal(session.store.allRecords().filter(r=>r.typeName==='shape').length,data.count)}finally{session.dispose()}
  }
})

test('标注失焦保存与同次画布点击合流，不重复提交，保存后重放选择',async()=>{
  let release
  const gate=new Promise(resolve=>{release=resolve})
  const f=await creationFixture({beforeCommit:()=>gate})
  try{
    f.key('c');f.pointer('down',100,200);await f.pointer('up',300,200)
    f.interaction.editText({type:'update',content:toRichText('点击外部保存')})
    const saving=f.interaction.setInputContext({owner:'canvas'})
    const click=f.pointer('down',900,700)
    f.pointer('up',900,700)
    release();await saving;await click
    assert.equal(f.commits.length,1)
    assert.equal(f.interaction.state.get().textEditing,null)
    assert.equal(f.interaction.state.get().lastError,null)
    assert.deepEqual(f.interaction.state.get().selectedIds,[])
  }finally{release();f.close()}
})

test('首次保存遇远端同ID空标签箭头时保留草稿，不重试覆盖别人的新记录',async()=>{
  let f,remote
  f=await creationFixture({beforeCommit:async()=>{
    if(remote)return
    const id=f.interaction.state.get().textEditing.id
    await f.remote([{type:'create_shape',id,shapeType:'arrow',x:999,props:{end:{x:100,y:0}}}],false)
    remote=structuredClone(f.current().store[id])
  }})
  try{
    f.key('c');f.pointer('down',100,200);await f.pointer('up',300,200)
    const id=f.interaction.state.get().textEditing.id,draft=toRichText('仅属于我的标注')
    f.interaction.editText({type:'update',content:draft})
    assert.equal(await f.interaction.editText({type:'finish'}),false)
    assert.deepEqual(f.current().store[id],remote)
    assert.deepEqual(f.interaction.state.get().textEditing.content,draft)
    assert.ok(f.interaction.state.get().textEditing.conflict)
    assert.equal(f.commits.length,1)
    assert.equal(await f.interaction.editText({type:'finish'}),false)
    assert.deepEqual(f.current().store[id],remote)
    f.interaction.editText({type:'cancel'});assert.deepEqual(f.current().store[id],remote)
  }finally{f.close()}
})
