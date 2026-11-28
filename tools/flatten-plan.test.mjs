import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands } from '../engine/index.js'
import { shapeToPagePoint, getConnectionGeometry } from '../renderer/geometry.js'
import { flattenPlan } from '../engine/flatten-plan.js'

const shape = (id, shapeType = 'geo', extra = {}) => ({ type: 'create_shape', id: 'shape:' + id, shapeType, ...extra })
const snapshot = commands => executeCanvasCommands(createCanvasSnapshot(), commands).snapshot

test('扁平化在原父级坐标系输出，保持原快照和祖先的旋转、透明、裁剪记录', () => {
  const source = snapshot([shape('frame', 'frame', { x: 500, y: 300, rotation: Math.PI / 2 }), shape('left', 'geo', { parentId: 'shape:frame', x: 20, y: 30 }), shape('right', 'geo', { parentId: 'shape:frame', x: 340, y: 50 }), { type: 'update', id: 'shape:frame', changes: { opacity: .5 } }])
  const before = structuredClone(source), plan = flattenPlan(source, ['shape:right', 'shape:left'])
  assert.deepEqual(plan.ids, ['shape:left', 'shape:right'])
  assert.equal(plan.parentId, 'shape:frame')
  assert.equal(plan.index, source.store['shape:left'].index)
  assert.deepEqual(shapeToPagePoint(plan.renderSnapshot, 'shape:left', { x: 0, y: 0 }), { x: 20, y: 30 })
  assert.deepEqual(shapeToPagePoint(source, 'shape:left', { x: 0, y: 0 }), { x: 470, y: 320 })
  assert.deepEqual(plan.renderSnapshot.store['shape:frame'], before.store['shape:frame'])
  assert.deepEqual(source, before)
})

test('同父远距合成一图，重复和父子选择归一，整框包含后代且锁一项整次拒绝', () => {
  const source = snapshot([shape('a'), shape('b', 'geo', { x: 3000 }), shape('frame', 'frame', { y: 500 }), shape('inside', 'geo', { parentId: 'shape:frame' })])
  assert.deepEqual(flattenPlan(source, ['shape:b', 'shape:a', 'shape:b']).ids, ['shape:a', 'shape:b'])
  const container = flattenPlan(source, ['shape:inside', 'shape:frame'])
  assert.deepEqual(container.ids, ['shape:frame']); assert.deepEqual(new Set(container.allIds), new Set(['shape:frame', 'shape:inside']))
  assert.throws(() => flattenPlan(source, ['shape:a', 'shape:inside']), /分开扁平化/)
  assert.throws(() => flattenPlan(source, ['shape:a', 'shape:frame']), /夹有未选/)
  const locked = structuredClone(source); locked.store['shape:inside'].isLocked = true
  assert.throws(() => flattenPlan(locked, ['shape:frame']), /后代或父级已锁定/)
  locked.store['shape:inside'].isLocked = false; locked.store['shape:frame'].isLocked = true
  assert.throws(() => flattenPlan(locked, ['shape:inside']), /锁定/)
  assert.deepEqual(flattenPlan(source, []), { status: 'unavailable', reason: 'empty-selection' })
  assert.throws(() => flattenPlan(source, ['shape:missing']), /仍然存在/)
  assert.deepEqual(flattenPlan(snapshot([shape('image', 'image')]), ['shape:image']), { status: 'unavailable', reason: 'already-image' })
})

test('选中绑定箭头保留当前路线，不让未选绑定目标进入渲染，源绑定不变', () => {
  const source = snapshot([shape('target', 'geo', { x: 500 }), shape('arrow', 'arrow', { x: 10, y: 20 }), { type: 'put', record: { id: 'binding:end', typeName: 'binding', type: 'arrow', fromId: 'shape:arrow', toId: 'shape:target', props: { terminal: 'end', normalizedAnchor: { x: .5, y: .5 }, isExact: true, isPrecise: true, snap: 'none' }, meta: {} } }])
  const before = structuredClone(source), endpoint = getConnectionGeometry(source.store['shape:arrow'], source).path.at(1)
  const plan = flattenPlan(source, ['shape:arrow'])
  assert.deepEqual(getConnectionGeometry(plan.renderSnapshot.store['shape:arrow'], plan.renderSnapshot).path.at(1), endpoint)
  assert.notEqual(plan.renderSnapshot.store['binding:end'].toId, 'shape:target')
  assert.deepEqual(plan.allIds, ['shape:arrow']); assert.deepEqual(source, before)
})

for (const kind of ['arc', 'elbow']) test(`${kind}非精确绑定的曲线/肘线、箭头头部和标签保持同一局部几何`, () => {
  const source = snapshot([shape('frame', 'frame', { x: 250, y: 150, rotation: .35 }), shape('target', 'geo', { x: 800, y: 500, rotation: .6 }), shape('arrow', 'arrow', { parentId: 'shape:frame', x: 30, y: 40, rotation: .2, text: '曲线中文', props: { kind, bend: 85 } }), { type: 'put', record: { id: 'binding:end', typeName: 'binding', type: 'arrow', fromId: 'shape:arrow', toId: 'shape:target', props: { terminal: 'end', normalizedAnchor: { x: .1, y: .8 }, isExact: false, isPrecise: true, snap: 'none' }, meta: {} } }])
  const plan = flattenPlan(source, ['shape:arrow']), before = getConnectionGeometry(source.store['shape:arrow'], source), after = getConnectionGeometry(plan.renderSnapshot.store['shape:arrow'], plan.renderSnapshot)
  assert.ok(Math.abs(before.path.length - after.path.length) < 1e-8)
  for (let n = 0; n <= 20; n++) { const a = before.path.at(n / 20), b = after.path.at(n / 20); assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-7) }
  assert.ok(Math.abs(before.label.bounds.x - after.label.bounds.x) < 1e-7)
  assert.deepEqual(plan.allIds, ['shape:arrow'])
})
