import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { creationFixture } from './creation-test-fixture.mjs'
import { shapeToPagePoint } from '../renderer/geometry.js'

const frame = (id = 'f', extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'frame', x: 220, y: 180, props: { w: 360, h: 260, name: id }, ...extra })
const shape = (id = 'a', extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType: 'geo', x: 100, y: 100, props: { w: 120, h: 80, fill: 'solid' }, ...extra })
const record = (f, id) => f.session.store.get(`shape:${id}`)
const world = (f, id) => shapeToPagePoint({ store: Object.fromEntries(f.previewShapes().map(r => [r.id, r])) }, `shape:${id}`, { x: 0, y: 0 })
const close = (a, b) => { for (const key of Object.keys(b)) assert.ok(Math.abs(a[key] - b[key]) < 1e-6, `${key}: ${a[key]} != ${b[key]}`) }
const localPoint = (f, p) => ({ x: f.x + p.x * Math.cos(f.rotation || 0) - p.y * Math.sin(f.rotation || 0), y: f.y + p.x * Math.sin(f.rotation || 0) + p.y * Math.cos(f.rotation || 0) })
const handles = { top_left: [0, 0], top: [.5, 0], top_right: [1, 0], right: [1, .5], bottom_right: [1, 1], bottom: [.5, 1], bottom_left: [0, 1], left: [0, .5] }

test('拖入按指针而非中心，逐帧跨框/出框不漂移，一次严格提交及一次撤销', async () => {
  const f = await creationFixture({ commands: [frame('target', { x: 400, y: 200 }), shape()] })
  try {
    f.pointer('down', 205, 130)
    // Shape center is inside, but the pointer remains outside the target.
    f.pointer('move', 770, 270)
    assert.equal(record(f, 'a').parentId, 'page:page')
    f.pointer('move', 405, 270)
    assert.equal(record(f, 'a').parentId, 'shape:target')
    close(world(f, 'a'), { x: 300, y: 240 })
    f.pointer('move', 790, 270)
    assert.equal(record(f, 'a').parentId, 'page:page')
    f.pointer('move', 460, 270)
    close(world(f, 'a'), { x: 355, y: 240 })
    assert.equal(f.commits.length, 0)
    await f.pointer('up', 460, 270)
    assert.equal(f.commits.length, 1)
    assert.ok(f.commits[0].commands.some(c => c.type === 'reparent_shapes'))
    await f.session.undo(); assert.deepEqual(f.current(), f.initial)
  } finally { f.close() }
})

test('多选只使用指针下的一个框，仅相交根收纳，前层可用框优先', async () => {
  const f = await creationFixture({ commands: [frame('back', { x: 400, y: 200 }), frame('front', { x: 400, y: 200 }), frame('other', { x: 400, y: 550 }), shape(), shape('b', { y: 450 })] })
  try {
    await f.click(140, 130); await f.click(140, 480, { shiftKey: true })
    f.pointer('down', 140, 130); f.pointer('move', 460, 270)
    assert.equal(record(f, 'a').parentId, 'shape:front')
    assert.equal(record(f, 'b').parentId, 'page:page')
    f.key('Escape'); assert.deepEqual(f.session.store.getStoreSnapshot(), f.initial)
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('锁定目标不收纳；移动框圈住静止对象不收纳；祖先和自身锁不移动', async () => {
  const f = await creationFixture({ commands: [frame('target', { x: 400, y: 200 }), shape(), { type: 'toggle_lock', ids: ['shape:target'] }] })
  try {
    f.pointer('down', 140, 130); await f.pointer('up', 460, 270)
    assert.equal(record(f, 'a').parentId, 'page:page')
    await f.session.undo()
    await f.remote([{ type: 'toggle_lock', ids: ['shape:target'] }])
    f.pointer('down', 700, 400); await f.pointer('up', 400, 200)
    assert.equal(record(f, 'a').parentId, 'page:page')
  } finally { f.close() }
  for (const locked of ['a', 'f']) {
    const g = await creationFixture({ commands: [frame(), shape('a', { parentId: 'shape:f', x: 40, y: 40 }), { type: 'toggle_lock', ids: [`shape:${locked}`] }] })
    try {
      const before = record(g, 'a'); g.pointer('down', 290, 250); await g.pointer('up', 700, 600)
      assert.deepEqual(record(g, 'a'), before)
    } finally { g.close() }
  }
})

test('Alt从已换父的预览切换副本/原件，Esc清掉副本且组生命周期完整恢复', async () => {
  const f = await creationFixture({ commands: [frame('target', { x: 400, y: 200 }), shape(), shape('b', { x: 240 }), { type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }] })
  try {
    f.pointer('down', 140, 130); f.pointer('move', 460, 270)
    assert.equal(record(f, 'g').parentId, 'shape:target')
    f.key('Alt', { altKey: true })
    const copy = f.interaction.state.get().selectedIds[0]
    assert.notEqual(copy, 'shape:g'); assert.equal(f.session.store.get(copy).parentId, 'shape:target')
    assert.equal(record(f, 'g').parentId, 'page:page'); close(world(f, 'a'), { x: 100, y: 100 })
    f.key('Alt', {}, 'key_up')
    assert.equal(f.session.store.has(copy), false); assert.equal(record(f, 'g').parentId, 'shape:target')
    f.key('Escape'); assert.deepEqual(f.session.store.getStoreSnapshot(), f.initial)
    assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

test('进入组后拖动一个孩子保持组归属，不触发自动解组', async () => {
  const f = await creationFixture({ commands: [shape(), shape('b', { x: 260 }), { type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }] })
  try {
    await f.click(140, 130); f.key('Enter')
    f.pointer('down', 140, 130); await f.pointer('up', 160, 150)
    assert.equal(record(f, 'a').parentId, 'shape:g'); assert.ok(record(f, 'g'))
    close(world(f, 'a'), { x: 120, y: 120 })
    await f.session.undo(); assert.deepEqual(f.current(), f.initial)
  } finally { f.close() }
})

test('换父提交只重试无关远端变化，更新目标层序并保留后台结果，一次撤销', async () => {
  const f = await creationFixture({ commands: [frame('target', { x: 400, y: 200 }), shape(), shape('other', { x: 850, y: 500 })] })
  try {
    f.pointer('down', 140, 130); f.pointer('move', 460, 270)
    await f.remote([{ type: 'update', id: 'shape:other', changes: { meta: { imageJob: 'done' } } }, shape('newSibling', { parentId: 'shape:target', x: 10, y: 10 })], false)
    const remote = f.current()
    await f.pointer('up', 460, 270)
    assert.equal(f.commits.length, 2)
    assert.equal(record(f, 'a').parentId, 'shape:target')
    assert.ok(record(f, 'a').index > record(f, 'newSibling').index)
    assert.equal(record(f, 'other').meta.imageJob, 'done')
    await f.session.undo(); assert.deepEqual(f.current(), remote)
  } finally { f.close() }
})

test('后代、原父级或子树成员远端更改也拒绝；持续无关冲突最多三次尝试', async () => {
  for (const target of ['b', 'source', 'newChild']) {
    const f = await creationFixture({ commands: [frame('target', { x: 600, y: 200 }), frame('source', { x: 50, y: 30, props: { w: 400, h: 400 } }), shape('a', { parentId: 'shape:source', x: 30, y: 40 }), shape('b', { parentId: 'shape:source', x: 180, y: 40 }), { type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:g' }] })
    try {
      f.pointer('down', 110, 100); f.pointer('move', 680, 280)
      await f.remote(target === 'newChild' ? [shape('newChild', { parentId: 'shape:g', x: 10, y: 10, meta: { remote: true } })] : [{ type: 'update', id: `shape:${target}`, changes: { meta: { remote: true } } }], false)
      await assert.rejects(f.pointer('up', 680, 280), e => e.code === 'conflict')
      assert.equal(record(f, target).meta.remote, true)
      assert.equal(record(f, 'g').parentId, 'shape:source')
      assert.equal(f.commits.length, 1)
    } finally { f.close() }
  }
  let f, revision = 0
  f = await creationFixture({ commands: [frame('target', { x: 400, y: 200 }), shape(), shape('other', { x: 850, y: 500 })], beforeCommit: async () => {
    await f.remote([{ type: 'update', id: 'shape:other', changes: { meta: { revision: ++revision } } }], false)
  } })
  try {
    f.pointer('down', 140, 130); f.pointer('move', 460, 270)
    await assert.rejects(f.pointer('up', 460, 270), e => e.code === 'conflict')
    assert.equal(f.commits.length, 3); assert.equal(record(f, 'a').parentId, 'page:page')
    assert.equal(record(f, 'other').meta.revision, 3)
  } finally { f.close() }
})

test('远端锁目标或过期版本在共享写入口整次拒绝，界面不自动重放到锁框', async () => {
  for (const refresh of [false, true]) {
    const f = await creationFixture({ commands: [frame('target', { x: 400, y: 200 }), shape()] })
    try {
      f.pointer('down', 140, 130); f.pointer('move', 460, 270)
      await f.remote([{ type: 'toggle_lock', ids: ['shape:target'] }], refresh)
      if (refresh) assert.throws(() => f.pointer('up', 460, 270), e => e.code === 'conflict')
      else await assert.rejects(f.pointer('up', 460, 270), e => e.code === 'conflict')
      assert.equal(f.current().store['shape:a'].parentId, 'page:page')
      assert.equal(f.current().store['shape:target'].isLocked, true)
      assert.equal(f.commits.length, refresh ? 0 : 1)
    } finally { f.close() }
  }
})

for (const [handle, [hx, hy]] of Object.entries(handles)) for (const rotation of [0, .37]) test(`裁框${handle} 旋转${rotation}：锁子跟随，未锁子画布姿态固定，键切换/Esc/撤销完整`, async () => {
  const f = await creationFixture({ commands: [frame('f', { rotation }), shape('a', { parentId: 'shape:f', x: 60, y: 60 }), shape('locked', { parentId: 'shape:f', x: 200, y: 100 }), { type: 'toggle_lock', ids: ['shape:locked'] }] })
  try {
    const at = localPoint(record(f, 'f'), { x: 320, y: 220 })
    await f.click(at.x, at.y)
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:f'])
    const a = world(f, 'a'), locked = structuredClone(record(f, 'locked')), startFrame = record(f, 'f')
    const from = localPoint(startFrame, { x: hx * 360, y: hy * 260 })
    const to = localPoint(startFrame, { x: hx * 360 + (hx === .5 ? 0 : 44), y: hy * 260 + (hy === .5 ? 0 : 32) })
    f.pointer('down', from.x, from.y); f.pointer('move', to.x, to.y)
    assert.deepEqual(record(f, 'a').x, 60)
    f.key('Meta', { metaKey: true }); close(world(f, 'a'), a)
    assert.deepEqual(record(f, 'locked'), locked)
    f.key('Meta', {}, 'key_up'); assert.equal(record(f, 'a').x, 60)
    f.key('Meta', { metaKey: true }); close(world(f, 'a'), a)
    await f.pointer('up', to.x, to.y, { metaKey: true })
    assert.equal(f.commits.length, 1); await f.session.undo(); assert.deepEqual(f.current(), f.initial)
    f.pointer('down', from.x, from.y, { metaKey: true }); f.pointer('move', to.x, to.y, { metaKey: true })
    close(world(f, 'a'), a); f.key('Escape'); assert.deepEqual(f.session.store.getStoreSnapshot(), f.initial)
  } finally { f.close() }
})

for (const enabled of [false, true]) for (const grid of [false, true]) test(`同一个Mod先算吸附再裁框，对象${enabled}网格${grid}`, async () => {
  const f = await creationFixture({ snapping: { enabled, grid }, commands: [frame(), shape('a', { parentId: 'shape:f', x: 60, y: 60 }), shape('guide', { x: 253, y: 500, props: { w: 100, h: 80 } })] })
  try {
    await f.click(540, 400)
    const before = world(f, 'a')
    f.pointer('down', 220, 310); f.pointer('move', 247, 310)
    close(record(f, 'f'), { x: enabled ? 253 : grid ? 250 : 247 })
    f.key('Meta', { metaKey: true })
    close(record(f, 'f'), { x: enabled ? 247 : 253 }); close(world(f, 'a'), before)
    const guides = f.interaction.state.get().overlays.find(o => o.kind === 'snap-guides')
    assert.equal(Boolean(guides?.lines.length), !enabled)
    f.key('Escape'); assert.deepEqual(f.session.store.getStoreSnapshot(), f.initial)
  } finally { f.close() }
})

for (const [handle, x, y, expected] of [['left', 220, 310, { x: 280, y: 180, w: 300, h: 260 }], ['bottom_right', 580, 440, { x: 220, y: 180, w: 420, h: 300 }]]) test(`第二击按住拖动${handle}转普通缩框，不执行适配`, async () => {
  const f = await creationFixture({ commands: [frame(), shape('a', { parentId: 'shape:f', x: 60, y: 60 })] })
  try {
    await f.click(550, 420); await f.click(x, y)
    f.pointer('down', x, y); f.pointer('move', x + 60, y + 40)
    await f.pointer('up', x + 60, y + 40)
    close(record(f, 'f'), { x: expected.x, y: expected.y }); close(record(f, 'f').props, { w: expected.w, h: expected.h })
    assert.deepEqual(record(f, 'a'), f.initial.store['shape:a'])
    assert.equal(f.commits.length, 1); await f.session.undo(); assert.deepEqual(f.current(), f.initial)
  } finally { f.close() }
})

for (const [handle, [hx, hy]] of Object.entries(handles)) test(`真实两次点击${handle}：单轴或双轴适配，锁子不移，一次撤销全还原`, async () => {
  const f = await creationFixture({ commands: [frame(), shape('a', { parentId: 'shape:f', x: -30, y: -20 }), shape('b', { parentId: 'shape:f', x: 220, y: 160, props: { w: 100, h: 70 } }), { type: 'toggle_lock', ids: ['shape:b'] }] })
  try {
    await f.click(550, 420)
    const before = world(f, 'a'), b = world(f, 'b'), x = 220 + hx * 360, y = 180 + hy * 260
    await f.click(x, y); await f.click(x, y)
    const fitted = record(f, 'f')
    close(fitted.props, { w: hx === .5 ? 360 : 370, h: hy === .5 ? 260 : 270 })
    close(world(f, 'a'), before); close(world(f, 'b'), b)
    assert.equal(f.commits.length, 1); await f.session.undo(); assert.deepEqual(f.current(), f.initial)
  } finally { f.close() }
})

test('裁框冲突不覆盖远端孩子，普通缩框允许无关子项更新且指针帧不读整份快照', async () => {
  const f = await creationFixture({ commands: [frame(), shape('a', { parentId: 'shape:f', x: 60, y: 60 })] })
  try {
    await f.click(540, 400); f.pointer('down', 220, 310)
    await f.remote([{ type: 'update', id: 'shape:a', changes: { x: 80 } }])
    const snapshot = f.session.store.getStoreSnapshot
    f.session.store.getStoreSnapshot = () => { throw new Error('禁止指针帧全板快照') }
    f.pointer('move', 250, 310); assert.equal(record(f, 'a').x, 80)
    assert.throws(() => f.key('Meta', { metaKey: true }), e => e.code === 'conflict')
    f.session.store.getStoreSnapshot = snapshot
    assert.equal(record(f, 'a').x, 80); assert.equal(f.commits.length, 0)
  } finally { f.close() }
})

for (const zoom of [.5, 2]) test(`旋转父链及嵌套子框，Alt中心裁框在${zoom}倍视角保持整个子树画布位置`, async () => {
  const f = await creationFixture({ camera: { x: 0, y: 0, z: zoom }, commands: [
    frame('outer', { x: 50, y: 20, rotation: -.2, props: { w: 900, h: 700 } }),
    frame('f', { parentId: 'shape:outer', x: 220, y: 180, rotation: .37 }),
    frame('nested', { parentId: 'shape:f', x: 40, y: 50, props: { w: 150, h: 120 } }),
    shape('a', { parentId: 'shape:nested', x: 20, y: 20 }),
    { type: 'toggle_lock', ids: ['shape:a'] },
  ] })
  try {
    const snapshot = { store: Object.fromEntries(f.previewShapes().map(r => [r.id, r])) }
    const p = v => ({ x: v.x * zoom, y: v.y * zoom })
    const at = p(shapeToPagePoint(snapshot, 'shape:f', { x: 320, y: 220 }))
    await f.click(at.x, at.y)
    const before = world(f, 'a'), nested = world(f, 'nested')
    const from = p(shapeToPagePoint(snapshot, 'shape:f', { x: 0, y: 130 }))
    const to = p(shapeToPagePoint(snapshot, 'shape:f', { x: 44, y: 130 }))
    f.pointer('down', from.x, from.y, { metaKey: true, altKey: true }); f.pointer('move', to.x, to.y, { metaKey: true, altKey: true })
    close(world(f, 'a'), before); close(world(f, 'nested'), nested)
    await f.pointer('up', to.x, to.y, { metaKey: true, altKey: true })
    await f.session.undo(); assert.deepEqual(f.current(), f.initial)
  } finally { f.close() }
})
