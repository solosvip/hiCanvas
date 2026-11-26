import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, CanvasEditError, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction } from '../engine/index.js'
import { createConnectionContext, getConnectionGeometry } from '../renderer/geometry.js'

const shape = (name, fields = {}) => ({ type: 'create_shape', id: `shape:${name}`, shapeType: 'geo', ...fields })
function initial(commands) { return executeCanvasCommands(createCanvasSnapshot(), commands).snapshot }
function binding(name, from, to, terminal = 'end') {
  return { type: 'put', record: { id: `binding:${name}`, typeName: 'binding', type: 'arrow', fromId: `shape:${from}`, toId: `shape:${to}`, props: { terminal, normalizedAnchor: { x: 0.2, y: 0.8 }, isExact: true, isPrecise: true, snap: 'edge' }, meta: { label: '原绑定' } } }
}

test('复制命令以画布位移放置副本，返回新 ID 对应表，原件和输入保持原样', () => {
  const snapshot = initial([shape('original', { x: 100, y: 200, rotation: 0.3, props: { w: 400 }, meta: { label: '原件' } })])
  const before = structuredClone(snapshot)
  const result = executeCanvasCommands(snapshot, [{ type: 'duplicate_shapes', ids: ['shape:original'], offset: { x: 50, y: -30 } }])
  const id = result.results[0].idMap['shape:original']
  assert.match(id, /^shape:[a-f0-9-]{36}$/)
  const copied = result.snapshot.store[id]
  assert.deepEqual(copied, { ...before.store['shape:original'], id, index: copied.index, x: 150, y: 170 })
  assert.ok(copied.index > before.store['shape:original'].index)
  assert.deepEqual(result.changes.added, { [id]: copied })
  assert.deepEqual(result.changes.updated, {})
  assert.deepEqual(result.changes.removed, {})
  assert.deepEqual(snapshot, before)
  result.results[0].idMap['shape:original'] = 'shape:editable-receipt'
  assert.ok(result.snapshot.store[id])
})

test('嵌套框及子孙只复制一次，内部绑定指向副本，外部绑定不复制，图片共用资源', () => {
  const asset = { id: 'asset:shared', typeName: 'asset', type: 'image', props: { name: 'synthetic.png', src: '/assets/synthetic.png', w: 800, h: 400, mimeType: 'image/png', isAnimated: false }, meta: {} }
  const snapshot = initial([
    { type: 'put', record: asset },
    shape('outer', { shapeType: 'frame', x: 100, y: 200, rotation: 0.4 }),
    shape('inner', { shapeType: 'frame', parentId: 'shape:outer', x: 20, y: 30, rotation: -0.2 }),
    shape('image', { shapeType: 'image', parentId: 'shape:inner', x: 50, props: { assetId: asset.id } }),
    shape('arrow', { shapeType: 'arrow', parentId: 'shape:outer', props: { start: { x: 10, y: 20 }, end: { x: 80, y: 90 } } }),
    shape('outside'), shape('incoming', { shapeType: 'arrow' }),
    binding('internal', 'arrow', 'image'), binding('outgoing', 'arrow', 'outside', 'start'), binding('incoming', 'incoming', 'image')
  ])
  const result = executeCanvasCommands(snapshot, [{ type: 'duplicate_shapes', ids: ['shape:inner', 'shape:outer', 'shape:outer', 'shape:image'], offset: { x: 60, y: 70 } }])
  const map = result.results[0].idMap, records = result.snapshot.store
  assert.deepEqual(Object.keys(map).sort(), ['shape:outer', 'shape:inner', 'shape:image', 'shape:arrow', 'binding:internal'].sort())
  assert.equal(new Set(Object.values(map)).size, 5)
  assert.equal(records[map['shape:outer']].parentId, 'page:page')
  assert.deepEqual([records[map['shape:outer']].x, records[map['shape:outer']].y], [160, 270])
  for (const name of ['inner', 'image', 'arrow']) {
    const old = snapshot.store[`shape:${name}`], copied = records[map[old.id]]
    const props = name === 'arrow' ? { ...old.props, start: getConnectionGeometry(old, createConnectionContext(snapshot)).path.at(0) } : old.props
    assert.deepEqual(copied, { ...old, id: map[old.id], parentId: map[old.parentId], props })
  }
  const copiedBinding = records[map['binding:internal']]
  assert.match(copiedBinding.id, /^binding:[a-f0-9-]{36}$/)
  assert.deepEqual(copiedBinding, { ...snapshot.store['binding:internal'], id: copiedBinding.id, fromId: map['shape:arrow'], toId: map['shape:image'] })
  assert.deepEqual(Object.values(records).filter(record => record.typeName === 'asset'), [asset])
  assert.deepEqual(Object.keys(result.changes.added).sort(), Object.values(map).sort())
  for (const [id, record] of Object.entries(snapshot.store)) assert.deepEqual(records[id], record)
})

test('单独／部分复制绑定箭头冻结外部可见端点，内部绑定改指副本，原记录与一次撤销保持完整', () => {
  const snapshot = initial([
    shape('a', { x: 100, y: 200, props: { w: 100, h: 80 } }), shape('b', { x: 450, y: 200, props: { w: 100, h: 80 } }),
    shape('arrow', { shapeType: 'arrow', x: 200, y: 240, props: { start: { x: 0, y: 0 }, end: { x: 250, y: 0 } } }),
    ...['start', 'end'].map((terminal, i) => ({ type: 'put', record: { id: `binding:${terminal}`, typeName: 'binding', type: 'arrow', fromId: 'shape:arrow', toId: `shape:${i ? 'b' : 'a'}`, props: { terminal, normalizedAnchor: { x: .5, y: .5 }, isExact: false, isPrecise: true, snap: 'none' }, meta: {} } })),
  ])
  for (const ids of [['shape:arrow'], ['shape:a', 'shape:arrow'], ['shape:a', 'shape:b', 'shape:arrow']]) {
    const result = executeCanvasCommands(snapshot, [{ type: 'duplicate_shapes', ids, offset: { x: 70, y: 40 } }]), map = result.results[0].idMap, copy = result.snapshot.store[map['shape:arrow']]
    assert.deepEqual(copy.props.end, ids.includes('shape:b') ? { x: 250, y: 0 } : { x: 236.5, y: 0 })
    const copiedBindings = Object.values(result.changes.added).filter(r => r.typeName === 'binding')
    assert.equal(copiedBindings.length, ids.length - 1)
    for (const r of copiedBindings) { assert.equal(r.fromId, copy.id); assert.ok(Object.values(map).includes(r.toId)) }
    assert.deepEqual(undoCanvasTransaction(result.snapshot, recordCanvasTransaction(undefined, 'copy', result.changes), 'copy').snapshot, snapshot)
    assert.deepEqual(snapshot.store['shape:arrow'].props.end, { x: 250, y: 0 })
  }
})

function pose(records, id) {
  const record = records[id]
  if (records[record.parentId]?.typeName === 'page') return { x: record.x, y: record.y, rotation: record.rotation }
  const parent = pose(records, record.parentId)
  return { x: parent.x + Math.cos(parent.rotation) * record.x - Math.sin(parent.rotation) * record.y, y: parent.y + Math.sin(parent.rotation) * record.x + Math.cos(parent.rotation) * record.y, rotation: parent.rotation + record.rotation }
}
function close(actual, expected) { for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} 应接近 ${expected[key]}`) }

test('不同旋转父容器内的副本统一按画布坐标平移，各组在同级最上方且保留原顺序', () => {
  const snapshot = initial([
    shape('parent', { shapeType: 'frame', x: 100, y: 200, rotation: Math.PI / 2 }),
    shape('nested', { shapeType: 'group', parentId: 'shape:parent', rotation: 0.3 }),
    shape('a', { parentId: 'shape:nested', x: 10, y: 30 }), shape('b', { parentId: 'shape:nested', x: 80 }),
    shape('top', { parentId: 'shape:nested' }), shape('page-a'), shape('page-b'), shape('page-top')
  ])
  const offset = { x: 40, y: -25 }
  const result = executeCanvasCommands(snapshot, [{ type: 'duplicate_shapes', ids: ['shape:b', 'shape:page-b', 'shape:page-a', 'shape:a'], offset }])
  const map = result.results[0].idMap, records = result.snapshot.store
  for (const [id, copied] of Object.entries(map)) {
    const before = pose(snapshot.store, id), after = pose(records, copied)
    close(after, { x: before.x + offset.x, y: before.y + offset.y, rotation: before.rotation })
    assert.equal(records[copied].parentId, snapshot.store[id].parentId)
  }
  for (const prefix of ['', 'page-']) {
    const a = records[map[`shape:${prefix}a`]], b = records[map[`shape:${prefix}b`]]
    assert.ok(snapshot.store[`shape:${prefix}top`].index < a.index)
    assert.ok(a.index < b.index)
  }
})

test('复制幻灯片框时内部归属改指副本，单独复制子页和来源追踪仍保留原引用', () => {
  const snapshot = initial([
    shape('slides', { shapeType: 'frame', meta: { cowartAiSlides: true } }),
    shape('slide', { shapeType: 'frame', parentId: 'shape:slides', meta: { cowartAiHtml: true, cowartAiSlidesParentShapeId: 'shape:slides', sourceShapeId: 'shape:slides', label: '合成子页' } })
  ])
  for (const ids of [['shape:slides'], ['shape:slide']]) {
    const result = executeCanvasCommands(snapshot, [{ type: 'duplicate_shapes', ids }])
    const map = result.results[0].idMap, copied = result.snapshot.store[map['shape:slide']]
    assert.equal(copied.meta.cowartAiSlidesParentShapeId, map['shape:slides'] || 'shape:slides')
    assert.equal(copied.meta.cowartAiSlidesParentShapeId, copied.parentId)
    assert.equal(copied.meta.sourceShapeId, 'shape:slides')
    assert.equal(copied.meta.label, '合成子页')
    assert.deepEqual(result.snapshot.store['shape:slide'], snapshot.store['shape:slide'])
  }
})

test('未给位移时使用固定默认间距，显式零位移仍可复制且每次 ID 独立', () => {
  const snapshot = initial([shape('original', { x: 5, y: 8 })])
  const run = offset => executeCanvasCommands(snapshot, [{ type: 'duplicate_shapes', ids: ['shape:original'], ...(offset && { offset }) }])
  const first = run(), second = run(), zero = run({ x: 0, y: 0 })
  const copied = result => result.snapshot.store[result.results[0].idMap['shape:original']]
  assert.equal(copied(first).x - 5, copied(first).y - 8)
  assert.ok(copied(first).x > 5)
  assert.equal(copied(second).x, copied(first).x)
  assert.equal(copied(second).y, copied(first).y)
  assert.notEqual(copied(second).id, copied(first).id)
  assert.deepEqual([copied(zero).x, copied(zero).y], [5, 8])
})

test('复制事务可按操作者完整撤销与重做，别人改了副本则拒绝旧撤销', () => {
  const snapshot = initial([shape('frame', { shapeType: 'frame' }), shape('child', { parentId: 'shape:frame' }), shape('arrow', { shapeType: 'arrow', parentId: 'shape:frame' }), binding('inside', 'arrow', 'child')])
  const result = executeCanvasCommands(snapshot, [{ type: 'duplicate_shapes', ids: ['shape:frame'] }])
  const history = recordCanvasTransaction(undefined, 'AI甲', result.changes)
  const undone = undoCanvasTransaction(result.snapshot, history, 'AI甲')
  assert.deepEqual(undone.snapshot, snapshot)
  assert.deepEqual(redoCanvasTransaction(undone.snapshot, undone.history, 'AI甲').snapshot, result.snapshot)
  const copiedId = result.results[0].idMap['shape:child']
  const other = executeCanvasCommands(result.snapshot, [{ type: 'update', id: copiedId, changes: { x: 99 } }])
  const nextHistory = recordCanvasTransaction(history, 'U', other.changes)
  const before = structuredClone({ snapshot: other.snapshot, history: nextHistory })
  assert.throws(() => undoCanvasTransaction(other.snapshot, nextHistory, 'AI甲'), error => error instanceof CanvasEditError && error.code === 'conflict')
  assert.deepEqual({ snapshot: other.snapshot, history: nextHistory }, before)
})

test('无效 ID、位移、写入溢出或后续失败时拒绝整批复制，原画板不变', () => {
  const snapshot = initial([shape('original', { x: 1e308 }), shape('valid')]), before = structuredClone(snapshot)
  for (const fields of [{ ids: [] }, { ids: null }, { ids: ['shape:missing'] }, { ids: ['page:page'] }, { ids: ['shape:valid', 5] }, { offset: null }, { offset: {} }, { offset: { x: '5', y: 0 } }, { offset: { x: Infinity, y: 0 } }, { offset: { x: 1e308, y: 0 } }]) {
    assert.throws(() => executeCanvasCommands(snapshot, [{ type: 'duplicate_shapes', ids: ['shape:original'], ...fields }]), error => error instanceof CanvasEditError && error.code === 'invalid-input')
  }
  assert.throws(() => executeCanvasCommands(snapshot, [{ type: 'duplicate_shapes', ids: ['shape:valid'] }, { type: 'update', id: 'shape:missing', changes: { x: 1 } }]), CanvasEditError)
  assert.deepEqual(snapshot, before)
})
