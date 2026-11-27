import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawFixture, points } from './draw-fixture.mjs'
import { getStrokeGeometry, hitTestCanvas } from '../renderer/geometry.js'

for (const tool of ['draw', 'highlight']) test(`${tool} 起手样式只取一次；Shift续段保持原ID和样式，新笔迹才取新默认`, async () => {
  const f = await drawFixture()
  try {
    f.interaction.setTool(tool)
    f.pointer('down', 100, 100, { shiftKey: true }); await f.pointer('up', 180, 100, { shiftKey: true })
    const first = f.shapes()[0]
    assert.equal(first.props.color, 'black', '旧版荧光笔存black，由渲染层映成黄色')
    await f.interaction.setStyles({ color: 'red', opacity: .25, size: 'xl', dash: 'dotted', fill: 'solid', font: 'mono' })
    f.pointer('down', 240, 160, { shiftKey: true }); await f.pointer('up', 240, 160, { shiftKey: true })
    const continued = f.shapes()[0]
    assert.equal(continued.id, first.id)
    assert.deepEqual([continued.props.color, continued.props.size, continued.opacity], ['black', 'm', 1])
    assert.equal(points(continued).length, 2)
    f.key('Shift', {}, 'up')
    f.pointer('down', 400, 300, { pointerType: 'pen', pressure: .4 })
    assert.equal((await f.interaction.setStyles({ color: 'blue' })).reason, 'pointer-gesture')
    f.pointer('move', 450, 320, { pointerType: 'pen', pressure: .8 })
    await f.pointer('up', 500, 300, { pointerType: 'pen', pressure: 0 })
    const fresh = f.shapes()[1]
    assert.notEqual(fresh.id, first.id)
    assert.deepEqual([fresh.props.color, fresh.props.size, fresh.opacity], ['red', 'xl', .25])
    assert.equal(Object.hasOwn(fresh.props, 'font'), false)
    if (tool === 'draw') assert.deepEqual([fresh.props.dash, fresh.props.fill], ['dotted', 'solid'])
    else assert.equal(Object.hasOwn(fresh.props, 'dash'), false)
    assert.deepEqual(points(fresh)[0].points.map(p => Math.round(p.z * 100) / 100), [.5, 1, 1])
    await f.session.undo(); assert.deepEqual(f.shapes(), [continued])
    await f.session.redo(); assert.deepEqual(f.shapes(), [continued, fresh])
  } finally { f.close() }
})

for (const tool of ['draw', 'highlight']) test(`${tool} 逐帧预览保存全部微小采样，松手仅一次提交，撤销重做整条笔画`, async () => {
  const f = await drawFixture()
  try {
    f.interaction.setTool(tool)
    f.pointer('down', 100, 100); assert.equal(f.shapes()[0].props.isComplete, false)
    for (const x of [100.05, 110, 140, 200]) f.pointer('move', x, 100 + (x - 100) / 2)
    assert.equal(points(f.shapes()[0])[0].points.length, 5)
    assert.equal(f.commits.length, 0); assert.equal(f.depth(), 0)
    await f.pointer('up', 220, 170)
    const shape = f.shapes()[0]
    assert.equal(shape.type, tool); assert.equal(shape.props.isComplete, true)
    assert.equal(points(shape)[0].points.length, 6)
    assert.ok(points(shape)[0].points.every(p => p.z === .5))
    assert.equal(f.commits.length, 1); assert.equal(f.commits[0].commands.length, 1); assert.equal(f.depth(), 1)
    assert.equal(f.state().mode, 'idle'); assert.deepEqual(f.state().selectedIds, [])
    assert.ok(!JSON.stringify(f.commits).includes('isPenMode'))
    assert.equal(hitTestCanvas(f.saved(), { x: 140, y: 120 }, f.state().camera), shape.id)
    await f.key('z', { metaKey: true }); assert.equal(f.shapes().length, 0)
    await f.key('z', { metaKey: true, shiftKey: true }); assert.deepEqual(f.shapes(), [shape])
  } finally { f.close() }
})

test('A03 单击留下圆点；触控笔压力编码进入已有几何，笔模式阻止鼠标笔画，退出后恢复', async () => {
  const f = await drawFixture()
  try {
    f.key('d'); f.pointer('down', 100, 100); await f.pointer('up', 100, 100)
    assert.equal(points(f.shapes()[0])[0].points.length, 1)
    assert.ok(getStrokeGeometry(f.shapes()[0]).bounds.w > 0)
    f.pointer('down', 200, 200, { pointerType: 'pen', pressure: .1 })
    for (const [i, pressure] of [.2, .3, .4, .8, 1].entries()) f.pointer('move', 220 + i * 20, 200, { pointerType: 'pen', pressure })
    await f.pointer('up', 300, 200, { pointerType: 'pen', pressure: 0 })
    const pen = f.shapes()[1]
    assert.equal(pen.props.isPen, true); assert.equal(f.state().isPenMode, true)
    assert.deepEqual(points(pen)[0].points.map(p => Math.round(p.z * 100) / 100), [.13, .25, .38, .5, 1, 1.25])
    f.pointer('down', 100, 300); await f.pointer('up', 200, 300); assert.equal(f.shapes().length, 2)
    f.interaction.setPenMode(false); f.pointer('down', 100, 300); await f.pointer('up', 200, 300)
    assert.equal(f.shapes().length, 3); assert.equal(f.commits.length, 3)
  } finally { f.close() }
})

test('A36 Shift 直线按15度约束，松开后继续按Shift向同一笔迹接段，动态切回自由段', async () => {
  const f = await drawFixture()
  try {
    f.key('d'); f.pointer('down', 200, 200, { shiftKey: true }); f.pointer('move', 360, 250, { shiftKey: true })
    await f.pointer('up', 360, 250, { shiftKey: true })
    const first = f.shapes()[0], line = points(first)[0]
    assert.equal(line.type, 'straight'); assert.equal(line.points.length, 2)
    assert.ok(Math.abs(Math.atan2(line.points[1].y, line.points[1].x) - Math.PI / 12) < .001)
    f.pointer('down', 420, 320, { shiftKey: true }); await f.pointer('up', 420, 320, { shiftKey: true })
    assert.equal(f.shapes().length, 1); assert.equal(points(f.shapes()[0]).length, 2); assert.equal(f.commits.length, 2)
    f.key('Shift', {}, 'up')
    f.pointer('down', 500, 400); f.pointer('move', 520, 420)
    f.key('Shift', { shiftKey: true }); f.pointer('move', 550, 450, { shiftKey: true })
    f.key('Shift', {}, 'up'); f.pointer('move', 580, 460); await f.pointer('up', 600, 470)
    assert.deepEqual(points(f.shapes()[1]).map(s => s.type), ['free', 'straight', 'free'])
  } finally { f.close() }
})

test('A36 首尾闭合逐帧更新，不把直线或短点误判成闭合', async () => {
  const f = await drawFixture()
  try {
    f.key('d'); f.pointer('down', 100, 100)
    for (const [x, y] of [[200, 100], [200, 200], [100, 200], [105, 100]]) f.pointer('move', x, y)
    assert.equal(f.shapes()[0].props.isClosed, true)
    f.pointer('move', 120, 100); assert.equal(f.shapes()[0].props.isClosed, false)
    await f.pointer('up', 105, 100); assert.equal(f.shapes()[0].props.isClosed, true)
    f.pointer('down', 300, 300, { shiftKey: true }); await f.pointer('up', 350, 300, { shiftKey: true })
    assert.equal(f.shapes()[1].props.isClosed, false)
  } finally { f.close() }
})

for (const end of ['Escape', 'cancel', 'form', 'tool', 'camera', 'dispose']) test(`活动笔画通过 ${end} 取消，松开不提交也不增加撤销记录`, async () => {
  const f = await drawFixture()
  try {
    f.key('d'); f.pointer('down', 100, 100); await f.pointer('up', 200, 100)
    const saved = structuredClone(f.saved()), depth = f.depth()
    f.pointer('down', 100, 200); f.pointer('move', 200, 250)
    if (end === 'Escape') f.key('Escape')
    if (end === 'cancel') f.pointer('cancel', 200, 250)
    if (end === 'form') f.interaction.setInputContext({ owner: 'form' })
    if (end === 'tool') f.interaction.setTool('hand')
    if (end === 'camera') f.interaction.setCamera({ x: 10, y: 10, z: 2 })
    if (end === 'dispose') f.interaction.dispose()
    else await f.pointer('up', 200, 250)
    assert.deepEqual(f.session.store.getStoreSnapshot(), saved)
    assert.equal(f.depth(), depth); assert.equal(f.commits.length, 1)
    if (end !== 'dispose') {
      f.interaction.setInputContext({ owner: 'canvas' }); await f.key('z', { metaKey: true })
      assert.equal(f.shapes().length, 0, '取消不占撤销一步，下一次撤销移除之前完成的笔画')
    }
  } finally { f.close() }
})

test('松手后再按 Esc 保留已经完成的笔画和原撤销深度', async () => {
  const f = await drawFixture()
  try {
    f.key('d'); f.pointer('down', 100, 100); await f.pointer('up', 200, 100)
    const saved = structuredClone(f.saved()); f.key('Escape')
    assert.deepEqual(f.saved(), saved); assert.equal(f.depth(), 1); assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

for (const shiftKey of [false, true]) test(`触控笔停在原地改变压力仍更新圆点粗细，抬笔零压不抹去最后有效压力（Shift=${shiftKey}）`, async () => {
  const f = await drawFixture()
  try {
    f.key('d'); f.pointer('down', 100, 100, { pointerType: 'pen', pressure: .1, shiftKey })
    const width = getStrokeGeometry(f.shapes()[0]).bounds.w
    f.pointer('move', 100, 100, { pointerType: 'pen', pressure: 1, shiftKey })
    assert.ok(getStrokeGeometry(f.shapes()[0]).bounds.w > width * 2)
    await f.pointer('up', 100, 100, { pointerType: 'pen', pressure: 0, shiftKey })
    assert.ok(getStrokeGeometry(f.shapes()[0]).bounds.w > width * 2)
    assert.equal(f.commits.length, 1)
  } finally { f.close() }
})
