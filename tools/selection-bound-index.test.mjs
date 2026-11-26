import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession, createCanvasInteraction, executeCanvasCommands } from '../engine/index.js'
import { hitTestCanvas, createSpatialIndex } from '../renderer/geometry.js'
import { createConnectionGallery } from './renderer-preview/arrow-gallery.js'

async function setup(commands = [], before = []) {
  const initial = executeCanvasCommands(createCanvasSnapshot(), [
    ...before,
    { type: 'create_shape', id: 'shape:target', shapeType: 'geo', x: 400, y: 100, props: { w: 100, h: 80, fill: 'solid' } },
    { type: 'create_shape', id: 'shape:arrow', shapeType: 'arrow', x: 0, y: 200, props: { start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, arrowheadEnd: 'none' } },
    ...commands,
  ]).snapshot
  initial.store['binding:arrow'] = { id: 'binding:arrow', typeName: 'binding', type: 'arrow', fromId: 'shape:arrow', toId: 'shape:target', meta: {}, props: { terminal: 'end', normalizedAnchor: { x: .5, y: .5 }, isExact: true, isPrecise: true, snap: 'none' } }
  let current = initial, revision = 0
  const session = await createEditorSession({ actor: 'bound-index', transport: {
    read: async () => ({ snapshot: current, revision: String(revision) }), subscribe: () => () => {},
    commit: async () => { throw new Error('Selection must not commit') },
  } })
  const interaction = createCanvasInteraction({ session })
  let time = 0
  const pointer = (type, x, y, extra = {}) => interaction.dispatch({ type: `pointer_${type}`, time: ++time, point: { x, y }, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'move' ? 0 : 1, pressure: .5, ...extra })
  const remote = async records => {
    current = { ...current, store: { ...current.store, ...Object.fromEntries(records.map(record => [record.id, record])) } }
    revision++; await session.refresh()
  }
  return { initial, session, interaction, pointer, remote, close() { interaction.dispose(); session.dispose() } }
}

test('只移动绑定目标后，选择索引在新线身点中箭头，箭头记录保持不变', async () => {
  const f = await setup()
  try {
    const arrow = structuredClone(f.session.store.get('shape:arrow'))
    const target = f.session.store.get('shape:target')
    await f.remote([{ ...target, x: 900 }])
    // Exact center binding: page start (0,200), end (950,140), midpoint (475,170).
    assert.equal(hitTestCanvas(f.session.store.getStoreSnapshot(), { x: 475, y: 170 }), arrow.id, '共享连接几何在该处确实有线身')
    f.pointer('move', 475, 170)
    assert.equal(f.interaction.state.get().hoveredId, arrow.id)
    assert.deepEqual(f.session.store.get(arrow.id), arrow)
  } finally { f.close() }
})

test('初始绑定就按共享线身命中，不把记录中的未绑定线段当成可点区域', async () => {
  const f = await setup()
  try {
    // Exact center binding initially ends at page (450,140).
    f.pointer('move', 225, 170)
    assert.equal(f.interaction.state.get().hoveredId, 'shape:arrow')
    f.pointer('move', 100, 200)
    assert.equal(f.interaction.state.get().hoveredId, null)
  } finally { f.close() }
})


for (const [name, changes, point] of [
  ['移动', { x: 900 }, { x: 475, y: 170 }],
  ['缩放', { props: { w: 300, h: 160 } }, { x: 275, y: 190 }],
  ['旋转', { rotation: Math.PI / 2 }, { x: 180, y: 175 }],
]) test(`目标${name}后，点中及框选均按新的绑定箭头判断`, async () => {
  const f = await setup()
  try {
    const old = f.session.store.get('shape:target')
    await f.remote([{ ...old, ...changes, props: { ...old.props, ...changes.props } }])
    f.pointer('move', point.x, point.y)
    assert.equal(f.interaction.state.get().hoveredId, 'shape:arrow')
    f.pointer('down', point.x - 20, point.y - 20)
    f.pointer('move', point.x + 20, point.y + 20, { buttons: 1 })
    await f.pointer('up', point.x + 20, point.y + 20)
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:arrow'])
  } finally { f.close() }
})

test('移动目标的父画框后，跨框的箭头点中、框选和选择覆盖层同步', async () => {
  const f = await setup([{ type: 'update', id: 'shape:target', changes: { parentId: 'shape:frame' } }], [
    { type: 'create_shape', id: 'shape:frame', shapeType: 'frame', x: 500, y: 300, props: { w: 1500, h: 1500 } },
  ])
  try {
    await f.remote([{ ...f.session.store.get('shape:frame'), x: 1000 }])
    // Target center (1450,440), start (0,200), midpoint (725,320).
    f.pointer('move', 725, 320)
    assert.equal(f.interaction.state.get().hoveredId, 'shape:arrow')
    f.pointer('down', 705, 300); f.pointer('move', 745, 340, { buttons: 1 }); await f.pointer('up', 745, 340)
    assert.deepEqual(f.interaction.state.get().selectedIds, ['shape:arrow'])
    assert.deepEqual(f.interaction.state.get().overlays[0].bounds, { x: 0, y: 200, w: 1450, h: 240 })
  } finally { f.close() }
})

test('500条无关记录不重建：目标及其箭头各更新一次，并清除旧网格和外框', async () => {
  const f = await setup()
  try {
    const records = Object.values(f.initial.store), target = f.initial.store['shape:target']
    for (let i = 0; i < 500; i++) records.push({ ...target, id: `shape:unrelated-${i}`, x: 10000 + i * 200, y: 3000 })
    const index = createSpatialIndex(records), next = { ...target, x: -500, y: -100 }
    assert.equal(index.getUpdateStats().totalUpdates, 0)
    index.applyChanges({ updated: { [target.id]: [target, next] } })
    const stats = index.getUpdateStats()
    assert.deepEqual(new Set(stats.updatedIds), new Set([target.id, 'shape:arrow']))
    assert.equal(stats.totalUpdates, 2)
    assert.deepEqual(index.getBounds('shape:arrow'), { x: -450, y: -60, w: 450, h: 260 })
    assert.equal(index.hitTest({ x: -225, y: 70 }), 'shape:arrow')
    assert.ok(index.query({ x: -230, y: 65, w: 10, h: 10 }).includes('shape:arrow'))
    assert.ok(!index.query({ x: 440, y: 135, w: 20, h: 10 }).includes('shape:arrow'))
    assert.throws(() => stats.updatedIds.push('shape:fake'), TypeError)
    assert.equal(index.getUpdateStats().totalUpdates, 2)
  } finally { f.close() }
})

test('绑定换目标、解绑、删目标及删箭头后，旧外框和依赖都清除', async () => {
  const f = await setup()
  try {
    const records = Object.values(f.initial.store), target = f.initial.store['shape:target'], binding = f.initial.store['binding:arrow']
    const other = { ...target, id: 'shape:other', x: 1000 }
    const index = createSpatialIndex([...records, other]), nextBinding = { ...binding, toId: other.id }
    index.applyChanges({ updated: { [binding.id]: [binding, nextBinding] } })
    assert.deepEqual(index.getUpdateStats().updatedIds, ['shape:arrow'])
    assert.equal(index.getBounds('shape:arrow').w, 1050)
    index.applyChanges({ updated: { [target.id]: [target, { ...target, x: 800 }] } })
    assert.deepEqual(index.getUpdateStats().updatedIds, [target.id], '旧目标不再通知箭头')
    index.applyChanges({ removed: { [nextBinding.id]: nextBinding } })
    assert.deepEqual(index.getUpdateStats().updatedIds, ['shape:arrow'])
    assert.deepEqual(index.getBounds('shape:arrow'), { x: 0, y: 200, w: 200, h: 0 })
    assert.ok(!index.query({ x: 1040, y: 135, w: 20, h: 10 }).includes('shape:arrow'))
    index.applyChanges({ updated: { [other.id]: [other, { ...other, x: 2000 }] } })
    assert.deepEqual(index.getUpdateStats().updatedIds, [other.id], '解绑后没有残留通知')
    const arrow = f.initial.store['shape:arrow']
    index.applyChanges({ removed: { [arrow.id]: arrow } })
    assert.equal(index.getBounds(arrow.id), null)
    assert.deepEqual(index.getUpdateStats().removedIds, [arrow.id])
    assert.ok(!index.query({ x: 0, y: 190, w: 210, h: 20 }).includes(arrow.id))
    const missingTargetIndex = createSpatialIndex(records)
    missingTargetIndex.applyChanges({ removed: { [target.id]: target } })
    assert.deepEqual(missingTargetIndex.getUpdateStats().updatedIds, [arrow.id])
    assert.deepEqual(missingTargetIndex.getUpdateStats().removedIds, [target.id])
    assert.deepEqual(missingTargetIndex.getBounds(arrow.id), { x: 0, y: 200, w: 200, h: 0 })
    assert.ok(!missingTargetIndex.query({ x: 440, y: 135, w: 20, h: 10 }).includes(arrow.id))
  } finally { f.close() }
})


test('同一事务移动双端目标时，绑定箭头去重后只更新一次', async () => {
  const f = await setup()
  try {
    const target = f.initial.store['shape:target'], binding = f.initial.store['binding:arrow']
    const other = { ...target, id: 'shape:start-target', x: -500 }
    const start = { ...binding, id: 'binding:start', toId: other.id, props: { ...binding.props, terminal: 'start' } }
    const index = createSpatialIndex([...Object.values(f.initial.store), other, start])
    index.applyChanges({ updated: {
      [target.id]: [target, { ...target, x: 900 }], [other.id]: [other, { ...other, x: -1000 }],
    } })
    assert.deepEqual(new Set(index.getUpdateStats().updatedIds), new Set([target.id, other.id, 'shape:arrow']))
    assert.equal(index.getUpdateStats().totalUpdates, 3)
    assert.deepEqual(index.getBounds('shape:arrow'), { x: -950, y: 140, w: 1900, h: 0 })
    assert.equal(index.hitTest({ x: 100, y: 140 }), 'shape:arrow')
  } finally { f.close() }
})

test('组成员改变外框时更新绑定到组和该成员的箭头，不动兄弟的箭头', () => {
  const { snapshot } = createConnectionGallery('bindings')
  const group = snapshot.store['shape:binding-frame']
  group.type = 'group'; group.props = {}
  snapshot.store['binding:connection-0'].toId = group.id
  const index = createSpatialIndex(Object.values(snapshot.store)), child = snapshot.store['shape:target-3']
  const before = index.getBounds('shape:bound-0'), unrelated = index.getBounds('shape:bound-1')
  index.applyChanges({ updated: { [child.id]: [child, { ...child, x: child.x + 200 }] } })
  assert.deepEqual(new Set(index.getUpdateStats().updatedIds), new Set([child.id, 'shape:bound-0', 'shape:bound-3']))
  assert.notDeepEqual(index.getBounds('shape:bound-0'), before)
  assert.deepEqual(index.getBounds('shape:bound-1'), unrelated)
})
