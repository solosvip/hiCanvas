import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'

// Independent black-box observations, 2026-11-26: legacy 5.1.1, hidden
// 1280x800 Electron window, native toolbar/keyboard/pointer input. A click at
// (500,350) creates a centered 200x200 rectangle only on pointer-up.
test('点击几何工具在松手时创建居中默认对象，一次撤销全部还原', async () => {
  const f = await creationFixture()
  try {
    f.interaction.setTool('geo')
    f.pointer('down', 500, 350)
    assert.equal(f.previewShapes().length, 0)
    assert.equal(f.commits.length, 0)
    await f.pointer('up', 500, 350)
    const [shape] = f.shapes()
    assert.deepEqual({ type: shape.type, geo: shape.props.geo, x: shape.x, y: shape.y, w: shape.props.w, h: shape.props.h }, { type: 'geo', geo: 'rectangle', x: 400, y: 250, w: 200, h: 200 })
    assert.deepEqual(f.interaction.state.get().selectedIds, [shape.id])
    assert.equal(f.interaction.state.get().toolId, 'select')
    assert.equal(f.commits.length, 1)
    await f.key('z', { metaKey: true })
    assert.deepEqual(f.current(), f.initial)
  } finally { f.close() }
})

// All twenty variants were selected through the legacy shape picker and
// clicked at (500,350); star/cloud are the only default-size exceptions.
for (const [geo, x, y, w, h] of [
  ['rectangle',400,250,200,200], ['ellipse',400,250,200,200], ['triangle',400,250,200,200],
  ['diamond',400,250,200,200], ['hexagon',400,250,200,200], ['oval',400,250,200,200],
  ['rhombus',400,250,200,200], ['star',400,255,200,190], ['cloud',350,260,300,180],
  ['heart',400,250,200,200], ['x-box',400,250,200,200], ['check-box',400,250,200,200],
  ['arrow-left',400,250,200,200], ['arrow-right',400,250,200,200], ['arrow-up',400,250,200,200],
  ['arrow-down',400,250,200,200], ['pentagon',400,250,200,200], ['octagon',400,250,200,200],
  ['rhombus-2',400,250,200,200], ['trapezoid',400,250,200,200],
]) test(`点击创建 ${geo} 的类型、默认尺寸与外观匹配旧版`, async () => {
  const f = await creationFixture()
  try {
    f.interaction.setCreationOptions({ geo })
    f.interaction.setTool('geo')
    await f.click(500,350)
    const [s] = f.shapes()
    assert.deepEqual([s.type,s.props.geo,s.x,s.y,s.props.w,s.props.h,s.props.font,s.props.dash], ['geo',geo,x,y,w,h,'draw','draw'])
  } finally { f.close() }
})

test('普通画框点击默认 320×180', async () => {
  const f = await creationFixture()
  try {
    f.interaction.setTool('frame'); await f.click(500,350)
    const [s] = f.shapes()
    assert.deepEqual([s.type,s.x,s.y,s.props], ['frame',340,260,{w:320,h:180,name:'',color:'black'}])
  } finally { f.close() }
})

// Native drags (500,350)->(650,430) and the three other quadrants. Alt
// resizes the legacy 1x1 seed about (500.5,350.5), hence 299/301, not 300.
for (const tool of ['geo','frame']) for (const [name, end, modifiers, expected] of [
  ['右下', [650,430], {}, [500,350,150,80]],
  ['左上', [350,270], {}, [350,270,150,80]],
  ['右上', [650,270], {}, [500,270,150,80]],
  ['左下', [350,430], {}, [350,350,150,80]],
  ['Shift', [650,430], {shiftKey:true}, [500,350,150,150]],
  ['Alt', [650,430], {altKey:true}, [351,271,299,159]],
  ['Shift+Alt', [650,430], {shiftKey:true,altKey:true}, [351,201,299,299]],
  ['Alt 左上', [350,270], {altKey:true}, [350,270,301,161]],
  ['Shift+Alt 左上', [350,270], {shiftKey:true,altKey:true}, [350,200,301,301]],
]) test(`${tool} 拖动${name}：本地预览与松手保存匹配独立观察`, async () => {
  const f = await creationFixture()
  try {
    f.interaction.setTool(tool); f.pointer('down',500,350,modifiers)
    f.pointer('move',...end,modifiers)
    const [p] = f.previewShapes()
    assert.deepEqual([p.x,p.y,p.props.w,p.props.h],expected)
    assert.equal(f.shapes().length,0)
    assert.equal(f.commits.length,0)
    await f.pointer('up',...end,modifiers)
    const [s] = f.shapes()
    assert.deepEqual([s.x,s.y,s.props.w,s.props.h],expected)
    assert.equal(f.commits.length,1)
  } finally { f.close() }
})

for (const [dx,dy,dimensions] of [[4,0,[200,200]],[2,3,[200,200]],[3,3,[3,3]],[5,0,[5,1]]]) test(`点击与拖动阈值使用屏幕距离 ${dx},${dy}`, async () => {
  const f = await creationFixture()
  try {
    f.interaction.setTool('geo'); f.pointer('down',500,350)
    f.pointer('move',500+dx,350+dy); await f.pointer('up',500+dx,350+dy)
    const [s] = f.shapes()
    assert.deepEqual([s.props.w,s.props.h],dimensions)
  } finally { f.close() }
})

test('R/O/F/G/Q 切工具、重用最近几何与锁定后连续创建，只更新会话选择', async () => {
  const f = await creationFixture()
  try {
    f.key('r'); assert.equal(f.interaction.state.get().toolId,'geo')
    f.key('o'); assert.equal(f.interaction.state.get().creation.geo,'ellipse')
    f.interaction.setCreationOptions({geo:'triangle'})
    await f.click(450,300)
    f.key('g'); assert.equal(f.interaction.state.get().creation.geo,'triangle')
    f.key('q'); await f.click(750,500)
    assert.equal(f.interaction.state.get().toolId,'geo')
    assert.equal(f.interaction.state.get().creation.toolLocked,true)
    await f.click(950,500)
    assert.equal(f.shapes().length,3)
    assert.equal(f.shapes()[2].props.geo,'triangle')
    assert.deepEqual(f.interaction.state.get().selectedIds,[f.shapes()[2].id])
    f.key('q'); f.key('f'); await f.click(400,600)
    assert.equal(f.interaction.state.get().toolId,'select')
    f.interaction.useRecentTool(); assert.equal(f.interaction.state.get().toolId,'frame')
    const config = f.interaction.state.get().creation
    await f.key('z',{metaKey:true})
    assert.deepEqual(f.interaction.state.get().creation,config)
    assert.equal(f.commits.length,4)
    assert.ok(f.commits.every(c=>!JSON.stringify(c.commands).includes('toolLocked')))
  } finally { f.close() }
})

// Native dynamic-size preference was false initially. At zoom .5 / 2 the
// enabled geo click sizes were 400 / 100 with scale 2 / .5; dragging always
// followed page coordinates. Frames scale their default size, never props.scale.
for (const [z,dynamicSize,expected] of [[.5,false,[900,600,200,200,1]],[.5,true,[800,500,400,400,2]],[2,false,[150,75,200,200,1]],[2,true,[200,125,100,100,.5]]]) test(`动态尺寸 ${dynamicSize} 在缩放 ${z} 下只影响新建默认尺寸与笔触倍率`, async () => {
  const f = await creationFixture({camera:{x:0,y:0,z}})
  try {
    f.interaction.setCreationOptions({dynamicSize}); f.interaction.setTool('geo'); await f.click(500,350)
    const [s] = f.shapes()
    assert.deepEqual([s.x,s.y,s.props.w,s.props.h,s.props.scale],expected)
    f.interaction.setTool('geo'); f.pointer('down',500,350); f.pointer('move',650,430); await f.pointer('up',650,430)
    const p = f.shapes()[1]
    assert.deepEqual([p.props.w,p.props.h,p.props.scale],z===.5?[300,160,dynamicSize?2:1]:[75,40,dynamicSize?.5:1])
  } finally { f.close() }
})

test('创建选项严格校验、只读且不提交；关闭后的新增方法遵守生命周期', async () => {
  const f = await creationFixture()
  const before = f.interaction.state.get().creation
  try {
    for (const value of [null,[],{geo:'unknown'},{toolLocked:'true'},{dynamicSize:1},{extra:true}]) assert.throws(()=>f.interaction.setCreationOptions(value))
    assert.deepEqual(f.interaction.state.get().creation,before)
    f.interaction.setCreationOptions({geo:'cloud',toolLocked:true,dynamicSize:true})
    assert.throws(()=>{f.interaction.state.get().creation.geo='star'},TypeError)
    assert.deepEqual(f.current(),f.initial)
    assert.equal(f.commits.length,0)
  } finally { f.close() }
  assert.throws(()=>f.interaction.setCreationOptions({geo:'star'}),/关闭/)
  assert.throws(()=>f.interaction.useRecentTool(),/关闭/)
})

test('几何默认两入口同源；G保留当前默认，最近工具回取历史变体但不回退颜色', async () => {
  const f = await creationFixture()
  try {
    f.interaction.setCreationOptions({ geo: 'pentagon' })
    assert.equal(f.interaction.getStyles().next.geo, 'pentagon')
    f.interaction.setTool('geo'); await f.click(350, 300)
    f.interaction.select('clear')
    await f.interaction.setStyles({ geo: 'trapezoid', color: 'red' })
    assert.equal(f.interaction.state.get().creation.geo, 'trapezoid')
    f.key('g'); await f.click(650, 300)
    assert.deepEqual(f.shapes().map(s => s.props.geo), ['pentagon', 'trapezoid'])
    f.interaction.select('clear')
    await f.interaction.setStyles({ geo: 'octagon', color: 'white' })
    f.interaction.useRecentTool()
    assert.equal(f.interaction.getStyles().next.geo, 'trapezoid')
    await f.click(950, 300)
    assert.deepEqual([f.shapes()[2].props.geo, f.shapes()[2].props.color], ['trapezoid', 'white'])
    f.interaction.setTool('geo'); f.pointer('down', 200, 500)
    const config = f.interaction.state.get().creation, defaults = f.interaction.getStyles().next
    assert.throws(() => f.interaction.setCreationOptions({ geo: 'cloud', toolLocked: true }), /进行|忙碌/)
    assert.deepEqual(f.interaction.state.get().creation, config)
    assert.deepEqual(f.interaction.getStyles().next, defaults)
    assert.throws(() => f.interaction.setCreationOptions({ geo: 'cloud', dynamicSize: 'bad' }))
    assert.deepEqual(f.interaction.getStyles().next, defaults)
    f.key('Escape')
  } finally { f.close() }
})
