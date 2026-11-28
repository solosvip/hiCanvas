import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as engine from '../engine/index.js'
import { createCanvasSnapshot } from '../model/index.js'

const link = { type: 'set_shape_link', id: 'shape:target', url: 'https://example.invalid/new' }
function initial() {
  return engine.executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:parent', shapeType: 'frame' },
    { type: 'create_shape', id: 'shape:target', shapeType: 'geo', parentId: 'shape:parent' },
    { type: 'create_shape', id: 'shape:other', shapeType: 'geo' },
  ]).snapshot
}
function capture(snapshot, commands = [link]) {
  return engine.captureRecordBasis(snapshot, engine.getRecordDependencies(snapshot, commands))
}
const changed = (snapshot, id, changes) => engine.executeCanvasCommands(snapshot, [{ type: 'update', id, changes }]).snapshot
function check(snapshot, basis, commands = [link]) {
  return engine.assertRecordBasis(snapshot, basis, engine.getRecordDependencies(snapshot, commands))
}

test('大量成员条件不能放大整板枚举次数', () => {
  const snapshot = initial(), basis = capture(snapshot)
  basis.memberships = Array.from({ length: 1000 }, (_, i) => ({ kind: 'children', id: `shape:absent-${i}`, ids: [] }))
  let enumerations = 0
  const store = new Proxy(snapshot.store, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target) } })
  assert.doesNotThrow(() => check({ ...snapshot, store }, basis))
  assert.ok(enumerations <= 3, `只核对成员集合却遍历整板${enumerations}次`)
})

test('相关记录前置条件允许无关对象更新，拒绝目标任意属性变化且不改输入', () => {
  const snapshot = initial(), before = structuredClone(snapshot), basis = capture(snapshot)
  assert.doesNotThrow(() => check(changed(snapshot, 'shape:other', { x: 123 }), basis))
  assert.throws(() => check(changed(snapshot, 'shape:target', { x: 456 }), basis), { code: 'conflict' })
  assert.deepEqual(snapshot, before)
})

test('显式新建页面可跨无关更新，图片描述/嵌入互转可捕获祖先和资源', () => {
  const snapshot = initial(), pageId = snapshot.store['shape:parent'].parentId
  const commands = [{ type: 'insert_url', pageId, id: 'shape:new', url: 'https://youtu.be/demo', source: 'dialog', serviceId: 'G13' }]
  const basis = capture(snapshot, commands)
  assert.doesNotThrow(() => check(changed(snapshot, 'shape:other', { y: 50 }), basis, commands))
  const occupied = engine.executeCanvasCommands(snapshot, [{ type: 'create_shape', id: 'shape:new', shapeType: 'geo' }]).snapshot
  assert.throws(() => check(occupied, basis, commands), { code: 'conflict' })
  assert.throws(() => capture(snapshot, [{ type: 'insert_url', url: 'https://youtu.be/demo' }]))
  const inserted = engine.executeCanvasCommands(snapshot, [{ type: 'insert_image', image: { src: '/assets/test.png', w: 10, h: 10, mimeType: 'image/png' } }])
  const id = inserted.results[0].shapeId, assetId = inserted.snapshot.store[id].props.assetId
  const alt = [{ type: 'set_image_alt_text', id, altText: '新的描述' }], imageBasis = capture(inserted.snapshot, alt)
  assert.ok(imageBasis.records.some(([key]) => key === assetId))
  assert.throws(() => check(changed(inserted.snapshot, assetId, { props: { name: '远端资源名' } }), imageBasis, alt), { code: 'conflict' })
  const embedded = engine.executeCanvasCommands(snapshot, [{ type: 'insert_url', url: 'https://youtu.be/demo' }])
  const convert = [{ type: 'convert_url_shape', id: embedded.results[0].shapeId, to: 'bookmark' }]
  assert.doesNotThrow(() => capture(embedded.snapshot, convert))
})

test('共享书签引用和Slides成员新增不能绕过原有记录值检查', () => {
  const inserted = engine.executeCanvasCommands(initial(), [{ type: 'insert_url', url: 'https://youtu.be/demo' }])
  const id = inserted.results[0].shapeId
  const bookmark = engine.executeCanvasCommands(inserted.snapshot, [{ type: 'convert_url_shape', id, to: 'bookmark' }]).snapshot
  const commands = [{ type: 'convert_url_shape', id, to: 'embed' }], basis = capture(bookmark, commands)
  const source = bookmark.store[id]
  const shared = engine.executeCanvasCommands(bookmark, [{ type: 'put', record: { ...source, id: 'shape:shared', index: 'a9' } }]).snapshot
  assert.throws(() => check(shared, basis, commands), { code: 'conflict' })
  const slides = engine.executeCanvasCommands(initial(), [
    { type: 'create_shape', id: 'shape:deck', shapeType: 'frame', meta: { cowartAiSlides: true } },
    { type: 'create_shape', id: 'shape:slide', shapeType: 'image', parentId: 'shape:deck' },
  ]).snapshot
  const alt = [{ type: 'set_image_alt_text', id: 'shape:slide', altText: '新描述' }], original = capture(slides, alt)
  const added = engine.executeCanvasCommands(slides, [{ type: 'create_shape', id: 'shape:new-slide', shapeType: 'image', parentId: 'shape:deck' }]).snapshot
  assert.throws(() => check(added, original, alt), { code: 'conflict' })
  // A shared resource user's unrelated property is not the reference relation.
  const withSharedBasis = capture(shared, commands)
  assert.doesNotThrow(() => check(changed(shared, 'shape:shared', { opacity: .5 }), withSharedBasis, commands))
})

for (const modify of [
  basis => { basis.records = basis.records.filter(([id]) => id !== 'shape:parent') },
  basis => { basis.records.push(basis.records[0]) },
  basis => { basis.version = 9 },
  basis => { basis.records[0][1] = undefined },
  basis => { basis.extra = true },
]) test('伪造/不完整/重复或非文档基线明确拒绝', () => {
  const snapshot = initial(), basis = capture(snapshot)
  modify(basis)
  assert.throws(() => check(snapshot, basis), error => error.code === 'invalid-record-basis')
})
test('未知动作和不支持的资源写入拒绝，删除祖先/目标仍冲突', () => {
  const snapshot = initial(), basis = capture(snapshot)
  for (const type of ['put', 'paste_content', 'insert_image', 'flatten_shapes']) assert.throws(() => capture(snapshot, [{ type }]), { code: 'unsupported-record-basis' })
  const deleted = engine.executeCanvasCommands(snapshot, [{ type: 'delete', ids: ['shape:parent'] }]).snapshot
  assert.throws(() => check(deleted, basis), { code: 'conflict' })
  assert.throws(() => check(changed(snapshot, 'shape:parent', { rotation: .2 }), basis), { code: 'conflict' })
})
test('结构键顺序不同不误报；基线和命令总量/字节超限拒绝', () => {
  const snapshot = initial(), basis = capture(snapshot)
  basis.records = basis.records.map(([id, value]) => [id, value && Object.fromEntries(Object.entries(value).reverse())])
  assert.doesNotThrow(() => check(snapshot, basis))
  const huge = structuredClone(basis); huge.records = Array.from({ length: 20001 }, () => huge.records[0])
  assert.throws(() => check(snapshot, huge), { code: 'limit' })
  const commands = [{ ...link, url: 'x'.repeat(50 * 1024 * 1024) }]
  assert.throws(() => check(snapshot, basis, commands), { code: 'limit' })
})
