import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction } from '../engine/index.js'
import { shapeToPagePoint, getConnectionGeometry } from '../renderer/geometry.js'

const shape = (id, shapeType = 'geo', extra = {}) => ({ type: 'create_shape', id: `shape:${id}`, shapeType, ...extra })
const board = commands => executeCanvasCommands(createCanvasSnapshot(), commands).snapshot
const flatten = (ids, extra = {}) => ({ type: 'flatten_shapes', ids: ids.map(id => `shape:${id}`), id: 'shape:flat', assetId: 'asset:flat', bounds: { x: 10, y: 20, w: 300, h: 150 }, image: { src: '/c/11111111-1111-4111-8111-111111111111/assets/synthetic-media-import-flat.png', w: 600, h: 300, mimeType: 'image/png', isAnimated: false }, ...extra })
const records = snapshot => Object.fromEntries(Object.entries(snapshot.store).filter(([, r]) => r.typeName !== 'asset'))

test('扁平化在一次事务中替换，撤销和重做逐字段恢复源项及绑定', () => {
  const source = board([shape('left'), shape('right', 'geo', { x: 250 })])
  const result = executeCanvasCommands(source, [flatten(['right', 'left'])])
  assert.equal(result.results[0].shapeId, 'shape:flat')
  assert.equal(result.snapshot.store['shape:left'], undefined)
  assert.equal(result.snapshot.store['shape:right'], undefined)
  assert.equal(result.snapshot.store['shape:flat'].index, source.store['shape:left'].index)
  assert.deepEqual(result.snapshot.store['shape:flat'].props, { w: 300, h: 150, assetId: 'asset:flat', crop: null, playing: true, url: '', flipX: false, flipY: false, altText: '' })
  const history = recordCanvasTransaction(undefined, 'flatten-actor', result.changes)
  const undo = undoCanvasTransaction(result.snapshot, history, 'flatten-actor')
  assert.deepEqual(records(undo.snapshot), records(source))
  const redo = redoCanvasTransaction(undo.snapshot, undo.history, 'flatten-actor')
  assert.deepEqual(redo.snapshot, result.snapshot)
})

test('有未选兄弟时组和兄弟不变，全选时沿既有规则解组并保留页面变换及撤销', () => {
  const initial = [shape('a', 'geo', { x: 40, y: 50 }), shape('b', 'geo', { x: 340, y: 70 }), shape('sibling', 'geo', { x: 700 }), { type: 'group_shapes', ids: ['shape:a', 'shape:b', 'shape:sibling'], groupId: 'shape:group' }, { type: 'update', id: 'shape:group', changes: { rotation: .4, opacity: .5 } }]
  const source = board(initial), result = executeCanvasCommands(source, [flatten(['a', 'b'])])
  assert.deepEqual(result.snapshot.store['shape:group'], source.store['shape:group'])
  assert.deepEqual(result.snapshot.store['shape:sibling'], source.store['shape:sibling'])
  assert.equal(result.snapshot.store['shape:flat'].parentId, 'shape:group')
  const all = board(initial.slice(0, 2).concat([{ type: 'group_shapes', ids: ['shape:a', 'shape:b'], groupId: 'shape:group' }, initial.at(-1)]))
  const origin = shapeToPagePoint(all, 'shape:group', { x: 10, y: 20 })
  const merged = executeCanvasCommands(all, [flatten(['a', 'b'])])
  assert.equal(merged.snapshot.store['shape:group'], undefined)
  const image = merged.snapshot.store['shape:flat']
  const actual = shapeToPagePoint(merged.snapshot, image.id, { x: 0, y: 0 })
  assert.ok(Math.abs(actual.x - origin.x) < 1e-8 && Math.abs(actual.y - origin.y) < 1e-8)
  assert.equal(image.rotation, .4)
  assert.equal(image.opacity, .5)
  assert.ok(image.index > all.store['shape:group'].index)
  assert.deepEqual(records(undoCanvasTransaction(merged.snapshot, recordCanvasTransaction(undefined, 'actor', merged.changes), 'actor').snapshot), records(all))
})

test('坏图片回执、锁与不连续选择整次拒绝，不留下资产或部分替换', () => {
  const source = board([shape('a'), shape('middle'), shape('b')]), before = structuredClone(source)
  for (const patch of [{ image: { src: 'https://example.com/a.png', w: 600, h: 300, mimeType: 'image/png' } }, { bounds: { x: NaN, y: 20, w: 300, h: 150 } }, { image: { ...flatten([]).image, w: 599 } }]) {
    assert.throws(() => executeCanvasCommands(source, [flatten(['a', 'middle'], patch)]))
    assert.deepEqual(source, before)
  }
  assert.throws(() => executeCanvasCommands(source, [flatten(['a', 'b'])]), /夹有未选/)
  const locked = executeCanvasCommands(source, [{ type: 'toggle_lock', ids: ['shape:a'] }]).snapshot
  assert.throws(() => executeCanvasCommands(locked, [flatten(['a', 'middle'])]), /锁定/)
})

test('外部箭头只解绑被替换端，固定可见端点，撤销恢复两端绑定', () => {
  const binding = (terminal, target) => ({ type: 'put', record: { id: `binding:${terminal}`, typeName: 'binding', type: 'arrow', fromId: 'shape:arrow', toId: `shape:${target}`, props: { terminal, normalizedAnchor: { x: .5, y: .5 }, isExact: true, isPrecise: true, snap: 'none' }, meta: {} } })
  const source = board([shape('a'), shape('b', 'geo', { x: 600 }), shape('arrow', 'arrow', { x: 10, y: 10 }), binding('start', 'a'), binding('end', 'b')])
  const endpoint = getConnectionGeometry(source.store['shape:arrow'], source).path.at(0)
  const result = executeCanvasCommands(source, [flatten(['a'])])
  assert.deepEqual(result.snapshot.store['shape:arrow'].props.start, endpoint)
  assert.equal(result.snapshot.store['binding:start'], undefined)
  assert.deepEqual(result.snapshot.store['binding:end'], source.store['binding:end'])
  const undo = undoCanvasTransaction(result.snapshot, recordCanvasTransaction(undefined, 'actor', result.changes), 'actor')
  assert.deepEqual(records(undo.snapshot), records(source))
})

test('嵌套单子组解散只继承被解散层的透明度，保留有兄弟的外组', () => {
  const source = board([shape('outer', 'group'), shape('inner', 'group', { parentId: 'shape:outer' }), shape('a', 'geo', { parentId: 'shape:inner' }), shape('b', 'geo', { parentId: 'shape:inner' }), shape('sibling', 'geo', { parentId: 'shape:outer' }), { type: 'update', id: 'shape:outer', changes: { opacity: .5 } }, { type: 'update', id: 'shape:inner', changes: { opacity: .25 } }])
  const result = executeCanvasCommands(source, [flatten(['a', 'b'])])
  assert.equal(result.snapshot.store['shape:inner'], undefined)
  assert.equal(result.snapshot.store['shape:flat'].parentId, 'shape:outer')
  assert.equal(result.snapshot.store['shape:flat'].opacity, .25)
  assert.deepEqual(result.snapshot.store['shape:outer'], source.store['shape:outer'])
  assert.deepEqual(result.snapshot.store['shape:sibling'], source.store['shape:sibling'])
})
