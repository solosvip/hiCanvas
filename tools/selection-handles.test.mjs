import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands, getShapeScalingCapabilities } from '../engine/index.js'
// Independently convert an observed selection box into native input points.
const framePoint = (f, p) => ({ x: f.x + p.x * Math.cos(f.rotation) - p.y * Math.sin(f.rotation), y: f.y + p.x * Math.sin(f.rotation) + p.y * Math.cos(f.rotation) })

async function fixture(extra = [], options = {}) {
  let current = executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:a', shapeType: 'geo', x: 20, y: 20, props: { w: 100, h: 80, fill: 'solid' } },
    ...extra,
  ]).snapshot
  const initial = current, commits = [], undo = []; let revision = 0, time = 0
  const reply = () => ({ snapshot: current, revision: String(revision) })
  const session = await createEditorSession({ actor: 'handles', transport: {
    read: async () => reply(), subscribe: () => () => {},
    commit: async request => { assert.equal(request.expectedRevision, String(revision)); commits.push(request); undo.push(current); current = executeCanvasCommands(current, request.commands).snapshot; revision++; return reply() },
    undo: async () => { current = undo.pop(); revision++; return reply() },
  } })
  const interaction = createCanvasInteraction({ session, edgeScrolling: false, ...options })
  const pointer = (type, x, y, modifiers = {}) => interaction.dispatch({ type: `pointer_${type}`, time: ++time, point: { x, y }, pointerId: 1, pointerType: 'mouse', button: 0, ...modifiers })
  const key = (key, modifiers = {}, type = 'key_down') => interaction.dispatch({ type, time: ++time, key, ...modifiers })
  const click = async (x, y, modifiers) => { pointer('down', x, y, modifiers); await pointer('up', x, y, modifiers) }
  return { initial, session, interaction, commits, pointer, key, click, current: () => current,
    remote: async commands => { current = executeCanvasCommands(current, commands).snapshot; revision++; await session.refresh() },
    close: () => { interaction.dispose(); session.dispose() } }
}
const closeTo = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)
const shape = f => f.session.store.get('shape:a')
const selection = f => f.interaction.state.get().overlays.find(o => o.kind === 'selection')

test('命令能力只读查询直接反映规则，未登记类型不出现缩放手柄', async () => {
  const f = await fixture([{ type: 'create_shape', id: 'shape:n', shapeType: 'embed', x: 300, y: 20 }])
  try {
    assert.deepEqual(getShapeScalingCapabilities(shape(f)), { canScale: true, lockAspectRatio: false })
    assert.ok(Object.isFrozen(getShapeScalingCapabilities(shape(f))))
    await f.click(340, 60)
    assert.equal(selection(f).handles.filter(h => h.kind === 'resize').length, 0)
    assert.ok(selection(f).handles.some(h => h.kind === 'rotate'))
    await f.click(50, 50, { shiftKey: true })
    assert.equal(selection(f).handles.filter(h => h.kind === 'resize').length, 0)
  } finally { f.close() }
})

test('逐帧角点缩放无累积误差，一次保存；Esc/取消恢复，撤销一次回起点', async () => {
  const f = await fixture()
  try {
    await f.click(50, 50)
    f.pointer('down', 120, 100); f.pointer('move', 140, 120); f.pointer('move', 170, 140)
    closeTo(shape(f).props.w, 150); closeTo(shape(f).props.h, 120)
    assert.equal(f.commits.length, 0)
    await f.pointer('up', 170, 140)
    assert.equal(f.commits.length, 1)
    await f.key('z', { metaKey: true })
    assert.deepEqual(f.current(), f.initial)
    f.pointer('down', 120, 100); f.pointer('move', 170, 140); f.key('Escape'); await f.pointer('up', 170, 140)
    assert.deepEqual(f.session.store.getStoreSnapshot(), f.initial)
    f.pointer('down', 120, 100); f.pointer('move', 170, 140); f.pointer('cancel', 170, 140)
    assert.deepEqual(f.session.store.getStoreSnapshot(), f.initial)
    assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

test('Shift 等比、Alt 中心、修饰键中途松开重新按住均从原几何计算', async () => {
  const f = await fixture()
  try {
    await f.click(50, 50)
    f.pointer('down', 120, 100); f.pointer('move', 170, 120, { shiftKey: true, altKey: true })
    closeTo(shape(f).props.w, 200); closeTo(shape(f).props.h, 160)
    closeTo(shape(f).x, -30); closeTo(shape(f).y, -20)
    f.key('Shift', { altKey: true }, 'key_up')
    closeTo(shape(f).props.w, 200); closeTo(shape(f).props.h, 120)
    f.key('Alt', {}, 'key_up')
    closeTo(shape(f).props.w, 150); closeTo(shape(f).props.h, 100)
    await f.pointer('up', 170, 120)
    assert.equal(f.commits.length, 1)
  } finally { f.close() }
})

test('混选含图片时整份选择等比，组展开缩放，框缩边界保留子记录', async () => {
  for (const grouped of [false, true]) {
    const f = await fixture([
      { type: 'create_shape', id: 'shape:b', shapeType: 'image', x: 220, y: 20, props: { w: 100, h: 80 } },
      ...(grouped ? [{ type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }] : []),
    ])
    try {
      await f.click(50, 50); if (!grouped) await f.click(250, 50, { shiftKey: true })
      f.pointer('down', 320, 100); f.pointer('move', 470, 120); await f.pointer('up', 470, 120)
      closeTo(shape(f).props.w, 150); closeTo(shape(f).props.h, 120)
      closeTo(f.session.store.get('shape:b').props.w, 150)
      assert.equal(f.commits.length, 1)
    } finally { f.close() }
  }
  const f = await fixture([
    { type: 'create_shape', id: 'shape:f', shapeType: 'frame', x: 300, y: 200, props: { w: 200, h: 160 } },
    { type: 'update', id: 'shape:a', changes: { parentId: 'shape:f' } },
  ])
  try {
    const before = shape(f)
    await f.click(450, 300)
    f.pointer('down', 500, 360); f.pointer('move', 550, 400); await f.pointer('up', 550, 400)
    assert.deepEqual(shape(f), before)
    closeTo(f.session.store.get('shape:f').props.w, 250)
  } finally { f.close() }
})

test('旋转后的形状及旋转父框内形状沿选择局部轴缩放，保持对角锚点', async () => {
  for (const nested of [false, true]) {
    const extra = nested ? [
      { type: 'create_shape', id: 'shape:f', shapeType: 'frame', x: 300, y: 200, rotation: Math.PI / 6, props: { w: 500, h: 500 } },
      { type: 'update', id: 'shape:a', changes: { parentId: 'shape:f' } },
    ] : [{ type: 'update', id: 'shape:a', changes: { rotation: Math.PI / 6 } }]
    const f = await fixture(extra)
    try {
      const x = nested ? 327 : 47, y = nested ? 275 : 75
      await f.click(x, y)
      assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:a'])
      const frame = selection(f), from = framePoint({ ...frame.bounds, rotation: frame.rotation }, { x: 100, y: 80 })
      const to = framePoint({ ...frame.bounds, rotation: frame.rotation }, { x: 150, y: 120 })
      f.pointer('down', from.x, from.y); f.pointer('move', (from.x + to.x) / 2, (from.y + to.y) / 2); await f.pointer('up', to.x, to.y)
      closeTo(shape(f).props.w, 150); closeTo(shape(f).props.h, 120)
      closeTo(shape(f).x, 20); closeTo(shape(f).y, 20)
      closeTo(shape(f).rotation, nested ? 0 : Math.PI / 6)
      assert.equal(f.commits.length, 1)
    } finally { f.close() }
  }
})

test('单个、多选、组及框内的旋转逐帧吸附15度，一次保存且选择框同步转向', async () => {
  for (const kind of ['single', 'multi', 'group', 'nested']) {
    const f = await fixture([
      ...(['multi', 'group'].includes(kind) ? [{ type: 'create_shape', id: 'shape:b', shapeType: 'geo', x: 220, y: 20, props: { w: 100, h: 80, fill: 'solid' } }] : []),
      ...(kind === 'group' ? [{ type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }] : []),
      ...(kind === 'nested' ? [
        { type: 'create_shape', id: 'shape:f', shapeType: 'frame', x: 300, y: 200, rotation: Math.PI / 6, props: { w: 500, h: 500 } },
        { type: 'update', id: 'shape:a', changes: { parentId: 'shape:f' } },
      ] : []),
    ])
    try {
      await f.click(kind === 'nested' ? 327 : 50, kind === 'nested' ? 275 : 50)
      if (kind === 'multi') await f.click(250, 50, { shiftKey: true })
      const overlay = selection(f), frame = { ...overlay.bounds, rotation: overlay.rotation }, initialAngle = frame.rotation
      const from = framePoint(frame, { x: frame.w + 7, y: frame.h + 7 }), center = framePoint(frame, { x: frame.w / 2, y: frame.h / 2 })
      const end = angle => ({ x: center.x + (from.x - center.x) * Math.cos(angle) - (from.y - center.y) * Math.sin(angle), y: center.y + (from.x - center.x) * Math.sin(angle) + (from.y - center.y) * Math.cos(angle) })
      const middle = end(Math.PI / 12), to = end(Math.PI / 6)
      f.pointer('down', from.x, from.y); f.pointer('move', middle.x, middle.y, { shiftKey: true })
      closeTo(selection(f).rotation, initialAngle + Math.PI / 12)
      await f.pointer('up', to.x, to.y, { shiftKey: true })
      const rotated = f.session.store.get(kind === 'group' ? 'shape:g' : 'shape:a')
      closeTo(rotated.rotation, Math.PI / 6)
      closeTo(selection(f).rotation, initialAngle + Math.PI / 6)
      assert.equal(f.commits.length, 1)
      await f.key('z', { metaKey: true })
      assert.deepEqual(f.current(), f.initial)
    } finally { f.close() }
  }
})

test('手柄冲突不覆盖远端目标或新增组成员，无关记录更新保留；帧内不取完整快照', async () => {
  const f = await fixture([{ type: 'create_shape', id: 'shape:b', shapeType: 'geo', x: 220, y: 20 }])
  try {
    await f.click(50, 50)
    f.pointer('down', 120, 100)
    await f.remote([{ type: 'update', id: 'shape:a', changes: { x: 40 } }])
    assert.throws(() => f.pointer('move', 170, 140), error => error.code === 'conflict')
    closeTo(shape(f).x, 40); assert.equal(f.commits.length, 0)
    await f.click(70, 50); f.pointer('down', 140, 100)
    await f.remote([{ type: 'update', id: 'shape:b', changes: { x: 300 } }])
    const original = f.session.store.getStoreSnapshot
    f.session.store.getStoreSnapshot = () => { throw new Error('禁止指针帧整份快照') }
    f.pointer('move', 160, 110); f.pointer('move', 190, 140)
    f.session.store.getStoreSnapshot = original
    await f.pointer('up', 190, 140)
    closeTo(shape(f).props.w, 150); closeTo(f.current().store['shape:b'].x, 300)
  } finally { f.close() }
  const g = await fixture([
    { type: 'create_shape', id: 'shape:b', shapeType: 'geo', x: 220, y: 20 },
    { type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' },
  ])
  try {
    await g.click(50, 50); const b = selection(g).bounds
    g.pointer('down', b.x + b.w, b.y + b.h)
    await g.remote([{ type: 'create_shape', id: 'shape:remote', shapeType: 'geo', parentId: 'shape:g', x: 400, y: 20 }])
    assert.throws(() => g.pointer('move', b.x + b.w + 50, b.y + b.h + 50), error => error.code === 'conflict')
    assert.ok(g.session.store.get('shape:remote')); assert.equal(g.commits.length, 0)
  } finally { g.close() }
})

test('边线拉伸、文字侧边改换行宽度，角点等比缩小取较大倍率', async () => {
  const f = await fixture()
  try {
    await f.click(50, 50)
    f.pointer('down', 120, 60); await f.pointer('up', 150, 60)
    closeTo(shape(f).props.w, 130); closeTo(shape(f).props.h, 80)
    await f.key('z', { metaKey: true })
    f.pointer('down', 120, 100); await f.pointer('up', 70, 84, { shiftKey: true })
    closeTo(shape(f).props.w, 80); closeTo(shape(f).props.h, 64)
  } finally { f.close() }
  const text = await fixture([
    { type: 'delete', ids: ['shape:a'] },
    { type: 'create_shape', id: 'shape:a', shapeType: 'text', x: 20, y: 20, text: 'A line of synthetic text', props: { w: 200, autoSize: false } },
  ])
  try {
    await text.click(50, 35)
    const b = selection(text).bounds, before = shape(text)
    text.pointer('down', b.x + b.w, b.y + b.h / 2); await text.pointer('up', b.x + b.w + 100, b.y + b.h / 2)
    closeTo(shape(text).props.w, 300); closeTo(shape(text).props.scale, before.props.scale)
    assert.equal(shape(text).props.autoSize, false)
  } finally { text.close() }
})

test('负局部坐标箭头的选择框/旋转中心正确，带growY形状往返不生成事务', async () => {
  const arrow = await fixture([
    { type: 'delete', ids: ['shape:a'] },
    { type: 'create_shape', id: 'shape:a', shapeType: 'arrow', x: 200, y: 200, props: { start: { x: -50, y: -30 }, end: { x: 100, y: 80 } } },
  ])
  try {
    await arrow.click(225, 225)
    const o = selection(arrow)
    assert.deepEqual(o.bounds, { x: 150, y: 170, w: 150, h: 110 })
    assert.ok(o.handles.every(h => h.kind === 'rotate'))
    const from = { x: 307, y: 287 }, center = { x: 225, y: 225 }
    arrow.pointer('down', from.x, from.y)
    await arrow.pointer('up', center.x - (from.y - center.y), center.y + (from.x - center.x), { shiftKey: true })
    closeTo(shape(arrow).rotation, Math.PI / 2)
    closeTo(selection(arrow).bounds.x, 280); closeTo(selection(arrow).bounds.y, 150)
  } finally { arrow.close() }
  const grown = await fixture([{ type: 'update', id: 'shape:a', changes: { props: { growY: 40 } } }])
  try {
    await grown.click(50, 50)
    grown.pointer('down', 120, 140); grown.pointer('move', 150, 160); grown.pointer('move', 120, 140); await grown.pointer('up', 120, 140)
    assert.equal(grown.commits.length, 0)
    assert.deepEqual(grown.current(), grown.initial)
  } finally { grown.close() }
})

test('混合朝向多选旋转后，无关远端记录变化保留选择框坐标轴', async () => {
  const f = await fixture([
    { type: 'create_shape', id: 'shape:b', shapeType: 'geo', x: 220, y: 20, rotation: Math.PI / 6, props: { w: 100, h: 80, fill: 'solid' } },
    { type: 'create_shape', id: 'shape:c', shapeType: 'geo', x: 600, y: 20 },
  ])
  try {
    await f.click(50, 50); await f.click(250, 70, { shiftKey: true })
    const o = selection(f), frame = { ...o.bounds, rotation: o.rotation }, from = framePoint(frame, { x: frame.w + 7, y: frame.h + 7 }), center = framePoint(frame, { x: frame.w / 2, y: frame.h / 2 })
    const dx = from.x - center.x, dy = from.y - center.y, angle = Math.PI / 6
    f.pointer('down', from.x, from.y); await f.pointer('up', center.x + dx * Math.cos(angle) - dy * Math.sin(angle), center.y + dx * Math.sin(angle) + dy * Math.cos(angle), { shiftKey: true })
    const before = selection(f)
    await f.remote([{ type: 'update', id: 'shape:c', changes: { x: 650 } }])
    assert.deepEqual(selection(f), before)
  } finally { f.close() }
})

test('宿主传入的命中尺寸取代默认值，屏幕边界内外、旋转区域和配置复制均受守卫', async () => {
  const metrics = { cornerHit: 3, edgeHit: 2, rotationOffset: 20, rotationRadius: 2 }
  const f = await fixture([], { handleMetrics: metrics })
  try {
    metrics.cornerHit = 99
    await f.click(50, 50)
    f.pointer('move', 17, 17); assert.equal(f.interaction.state.get().handleCursor, 'nwse-resize')
    f.pointer('move', 16, 16); assert.equal(f.interaction.state.get().handleCursor, null)
    f.pointer('move', 70, 18); assert.equal(f.interaction.state.get().handleCursor, 'ns-resize')
    f.pointer('move', 70, 17); assert.equal(f.interaction.state.get().handleCursor, null)
    f.pointer('move', -2, 0); assert.equal(f.interaction.state.get().handleCursor, 'crosshair')
    f.pointer('move', -3, 0); assert.equal(f.interaction.state.get().handleCursor, null)
    f.interaction.setCamera({ x: 0, y: 0, z: 2 })
    f.pointer('move', 37, 37); assert.equal(f.interaction.state.get().handleCursor, 'nwse-resize')
    f.pointer('move', 36, 36); assert.equal(f.interaction.state.get().handleCursor, null)
    assert.throws(() => createCanvasInteraction({ session: f.session, handleMetrics: { edgeHit: 0 } }), /有限正数/)
    assert.throws(() => createCanvasInteraction({ session: f.session, handleMetrics: null }), /数值配置/)
  } finally { f.close() }
})

test('命令忽略的零高度箭头仍有选择框，不提供无效变换手柄', async () => {
  const f = await fixture([
    { type: 'delete', ids: ['shape:a'] },
    { type: 'create_shape', id: 'shape:a', shapeType: 'arrow', x: 200, y: 200, props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, arrowheadStart: 'none', arrowheadEnd: 'none' } },
  ])
  try {
    await f.click(250, 200)
    assert.deepEqual(selection(f).bounds, { x: 200, y: 200, w: 100, h: 0 })
    assert.equal(selection(f).handles.length, 0)
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('局部零高度但页面外框非零的旋转箭头仍可使用现有旋转命令', async () => {
  const f = await fixture([
    { type: 'delete', ids: ['shape:a'] },
    { type: 'create_shape', id: 'shape:a', shapeType: 'arrow', x: 200, y: 200, rotation: Math.PI / 4, props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, arrowheadStart: 'none', arrowheadEnd: 'none' } },
  ])
  try {
    await f.click(230, 230)
    const o = selection(f), frame = { ...o.bounds, rotation: o.rotation }
    assert.ok(o.handles.some(h => h.kind === 'rotate')); assert.ok(o.handles.every(h => h.kind !== 'resize'))
    const from = framePoint(frame, { x: frame.w + 7, y: frame.h + 7 }), center = framePoint(frame, { x: frame.w / 2, y: frame.h / 2 }), dx = from.x - center.x, dy = from.y - center.y, angle = Math.PI / 6
    f.pointer('down', from.x, from.y); await f.pointer('up', center.x + dx * Math.cos(angle) - dy * Math.sin(angle), center.y + dx * Math.sin(angle) + dy * Math.cos(angle), { shiftKey: true })
    closeTo(shape(f).rotation, Math.PI / 4 + Math.PI / 6)
    assert.equal(f.commits.length, 1)
  } finally { f.close() }
})
