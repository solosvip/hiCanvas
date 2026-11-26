import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// All changes below originate in native mouse/key/text events. JavaScript
// only focuses the synthetic host and reads public state/DOM geometry.
export async function connectionSmoke(target, output) {
  const contents = target.webContents, samples = []
  const evaluate = code => contents.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const check = (value, message) => { if (!value) throw new Error(message) }
  const flush = () => delay(35)
  const shape = (s, id) => s.connectionRecords?.find(r => r.id === id) || s.selectedShapes.find(r => r.id === id)
  const bindings = s => s.connectionRecords.filter(r => r.typeName === 'binding')
  const points = s => Object.values(s.props.points).sort((a,b) => a.index < b.index ? -1 : 1)
  async function until(predicate, label) {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) { const s = await state(); if (s.error) throw new Error(s.error); if (predicate(s)) return s; await delay(20) }
    throw new Error(`连接线原生回归超时：${label}；${JSON.stringify(await state())}`)
  }
  const mouse = async (type, x, y, modifiers = []) => { contents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers: type === 'mouseMove' ? ['leftButtonDown', ...modifiers] : modifiers }); await flush() }
  const click = async (x, y, mods) => { await mouse('mouseDown', x, y, mods); await mouse('mouseUp', x, y, mods) }
  const drag = async (a, b, mods) => { await mouse('mouseDown', ...a); await mouse('mouseMove', ...b, mods); await mouse('mouseUp', ...b, mods) }
  const key = async (keyCode, modifiers = []) => { for (const type of ['keyDown','keyUp']) contents.sendInputEvent({ type, keyCode, modifiers }); await flush() }
  async function load(gallery = 'connection-editing', extra = '') {
    const url = new URL(contents.getURL()); url.search = `?gallery=${gallery}&edgeScrolling=0${extra}`
    await target.loadURL(url.href); await until(s => s.ready, '就绪')
    await evaluate("document.querySelector('#canvas').focus();void 0")
  }
  const remember = async label => { const s = await state(); samples.push({ label, ...s }); return s }
  const painting = setInterval(() => contents.invalidate(), 30)
  let attached = false
  try {
    contents.debugger.attach('1.3'); attached = true
    await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await load('creation')
    await key('L'); await key('Q')
    await drag([250,400], [550,450], ['shift'])
    let s = await until(s => s.revision === '1', '线条创建'), line = s.selectedShapes[0], id = line.id
    check(line.type === 'line' && Math.abs(points(line).at(-1).x - 293.7748711599246) < 1e-8, 'Shift 15度原生创建不符')
    await click(800,550,['shift']); s = await until(s => s.revision === '2', 'Shift延伸')
    check(s.selectedShapes[0].id === id && points(s.selectedShapes[0]).length === 3, 'Shift没有延伸同一条线')
    await key('Z',['meta']); s = await until(s => s.revision === '3', '整次撤销加点')
    check(points(s.selectedShapes[0]).length === 2, '撤销没有只撤最后接段')
    await remember('line-create-continue-undo')
    const arrowButton = await evaluate("(()=>{const r=document.querySelector('[data-tool=arrow]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()")
    await click(arrowButton.x,arrowButton.y); check((await state()).toolId === 'arrow', '原生箭头按钮没有选择工具')
    await click(225,450); s = await state()
    check(s.revision === '3' && s.renderedShapes === 1 && s.toolId === 'arrow', '箭头单击留下种子或退出工具')
    await drag([225,450],[625,500]); s = await until(s => s.revision === '4', '箭头工具创建')
    const createdArrow = s.selectedShapes[0]
    check(createdArrow.type === 'arrow' && createdArrow.x === 225 && createdArrow.y === 450 && createdArrow.props.end.x === 400 && createdArrow.props.end.y === 50 && createdArrow.props.font === 'draw', '原生箭头工具创建记录不符')
    await remember('arrow-toolbar-create')
    await key('Z',['meta']); s = await until(s => s.revision === '5', '整次撤销箭头')
    check(s.renderedShapes === 1, '撤销箭头创建没有整次移除新对象')

    await load(); await click(350,450)
    check(await evaluate("document.querySelectorAll('[data-connection-handle]').length") === 3, '专用控制柄未显示')
    const endBox = await evaluate("(()=>{const r=document.querySelector('[data-connection-handle=end]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
    check(Math.abs(endBox.x - 600) < 1e-8 && Math.abs(endBox.y - 450) < 1e-8, '显示的端柄与页面命中坐标不一致')
    await drag([400,450],[400,550]); s = await until(s => s.revision === '1', '弧度提交')
    check(shape(s,'shape:arrow').props.bend === 100, '弧度下拉100没有写bend100')
    await key('Z',['meta']); await until(s => s.revision === '2', '撤销弧度')
    await mouse('mouseDown',600,450); await mouse('mouseMove',700,230,['alt']);
    s = await state(); check(s.revision === '2' && bindings(s).length === 1, '绑定预览提前保存或没有绑定')
    await mouse('mouseUp',700,230,['alt']); s = await until(s => s.revision === '3', '精确绑定提交')
    check(bindings(s)[0].props.isExact && bindings(s)[0].props.isPrecise, 'Alt未精确绑定')
    check(Math.abs(bindings(s)[0].props.normalizedAnchor.x - 1 / 3) < 1e-9, '绑定归一化坐标不符')
    await drag([700,230],[649,250]); s = await until(s => s.revision === '4', '轮廓外解绑')
    check(bindings(s).length === 0 && shape(s,'shape:arrow').props.end.x === 449, '轮廓外1px没有解绑')
    await drag([649,250],[700,230],['control']); s = await until(s => s.revision === '5', 'Ctrl解绑')
    check(bindings(s).length === 0, 'Ctrl没有忽略绑定目标')
    await remember('bend-binding-unbinding-modifiers')

    await load(); await click(350,450)
    await mouse('mouseDown',600,450); await mouse('mouseMove',700,230)
    await until(s => bindings(s)[0]?.props.isPrecise, '停留精确绑定')
    await mouse('mouseUp',700,230); await until(s => s.revision === '1', '停留保存')
    await remember('binding-dwell')

    await load(); await click(350,450)
    await drag([430,450],[510,450]); s = await until(s => s.revision === '1', '标签位置')
    check(Math.abs(shape(s,'shape:arrow').props.labelPosition - .7) < 1e-8 && shape(s,'shape:arrow').x === 200, '标签没有沿路径移动')
    await click(500,450); await click(500,450); await until(s => s.textEditing?.id === 'shape:arrow', '复用文字编辑')
    contents.insertText('Native arrow label'); await flush(); await key('Escape'); s = await until(s => !s.textEditing && s.revision === '2', '标签文字保存')
    check(JSON.stringify(shape(s,'shape:arrow').props.richText).includes('Native arrow label'), '标签文字没有保存')
    await remember('label-position-and-text')

    await load(); await click(350,450); await click(600,450); await click(600,450)
    s = await until(s => s.revision === '1', '双击端帽')
    check(shape(s,'shape:arrow').props.arrowheadEnd === 'none' && !s.textEditing, '双击端点误进文字或端帽未切换')
    await remember('double-endcap')

    await load(); await click(950,570); await drag([950,575],[1000,575])
    s = await until(s => s.revision === '1', '折肘中柄')
    check(Math.abs(shape(s,'shape:elbow').props.elbowMidPoint - .6356852103120759) < 1e-9, '折肘中柄数值不符')
    await remember('elbow-middle')

    await load('connection-editing','&controlSnapping=1'); await click(350,650)
    await drag([400,650],[400,750]); s = await until(s => s.revision === '1', '线条中柄加点')
    check(points(shape(s,'shape:line')).length === 3, '线条中柄没有新增顶点')
    await mouse('mouseDown',600,650); await mouse('mouseMove',203,653)
    s = await state(); check(points(shape(s,'shape:line')).at(-1).x === 0 && s.overlays.some(o => o.kind === 'snap'), '控制点没有吸附或缺少指示')
    await mouse('mouseMove',207,653); s = await state()
    check(points(shape(s,'shape:line')).at(-1).x === 0, '半径内顶点没有优先吸附')
    await mouse('mouseMove',208,653); s = await state()
    check(Math.abs(points(shape(s,'shape:line')).at(-1).x - 7.6) < 1e-8, '顶点范围外没有吸到非邻接段')
    await key('Escape'); await mouse('mouseUp',203,653)
    s = await state(); check(s.revision === '1' && points(shape(s,'shape:line')).at(-1).x === 400 && !s.overlays.some(o => o.kind === 'snap'), 'Esc未撤掉吸附预览')
    await writeFile(join(output,'connections.png'), (await contents.capturePage()).toPNG())
    await remember('line-control-snap-cancel')
    await writeFile(join(output,'connections.json'), JSON.stringify({ samples, nativeInput: true }, null, 2))
    return { cases: samples.map(s => s.label), nativeInput: true }
  } finally { clearInterval(painting); if (attached && contents.debugger.isAttached()) contents.debugger.detach() }
}
