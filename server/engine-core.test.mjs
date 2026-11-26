import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands, CanvasEditError } from '../engine/index.js'

const legacy = JSON.parse(await readFile(new URL('./fixtures/legacy-canvas.json', import.meta.url), 'utf8'))

test('编辑命令创建默认形状，返回新快照和按 ID 索引的新增记录', () => {
  const initial = createCanvasSnapshot()
  const before = structuredClone(initial)
  const result = executeCanvasCommands(initial, [{ type: 'create_shape', id: 'shape:new', shapeType: 'geo', text: '合成文字' }])
  const record = result.snapshot.store['shape:new']
  assert.equal(record.parentId, 'page:page')
  assert.equal(record.x, 0)
  assert.equal(record.props.w, 200)
  assert.equal(record.props.h, 120)
  assert.equal(record.props.geo, 'rectangle')
  assert.equal(record.props.richText.content[0].content[0].text, '合成文字')
  assert.deepEqual(Object.keys(result.changes.added), ['shape:new'])
  assert.deepEqual(result.changes.added['shape:new'], record)
  assert.deepEqual(result.changes.updated, {})
  assert.deepEqual(result.changes.removed, {})
  assert.deepEqual(initial, before, '执行成功也不修改传入的快照')
})

test('整条写入可以新增或替换文档记录，每次写入立即校验', () => {
  const initial = createCanvasSnapshot()
  const record = { id: 'user:synthetic', typeName: 'user', name: '合成人员', color: '#000000', imageUrl: '', meta: {} }
  const added = executeCanvasCommands(initial, [{ type: 'put', record }])
  assert.deepEqual(added.snapshot.store[record.id], record)
  const replacement = { ...record, name: '新名称' }
  const updated = executeCanvasCommands(added.snapshot, [{ type: 'put', record: replacement }])
  assert.deepEqual(updated.changes.updated[record.id], [record, replacement])
  for (const invalid of [{ ...record, color: 42 }, { id: 'camera:page:page', typeName: 'camera', x: 0, y: 0, z: 1, meta: {} }]) {
    assert.throws(() => executeCanvasCommands(initial, [{ type: 'put', record: invalid }, { type: 'put', record }]), error => error instanceof CanvasEditError && error.code === 'invalid-input')
  }
  assert.equal(initial.store[record.id], undefined)
})

test('更新合并属性并保留修改前后记录，禁止改 ID 和类型或写入坏属性', () => {
  const { snapshot: initial } = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', id: 'shape:existing', shapeType: 'geo', meta: { keep: true } }])
  const before = structuredClone(initial)
  const result = executeCanvasCommands(initial, [{ type: 'update', id: 'shape:existing', changes: { x: 25, props: { w: 400 }, meta: { next: true } } }])
  const updated = result.snapshot.store['shape:existing']
  assert.equal(updated.x, 25)
  assert.equal(updated.props.w, 400)
  assert.equal(updated.props.h, 120)
  assert.deepEqual(updated.meta, { keep: true, next: true })
  assert.deepEqual(result.changes.updated['shape:existing'], [before.store['shape:existing'], updated])
  for (const changes of [{ id: 'shape:other' }, { typeName: 'asset' }, { type: 'text' }, { props: { w: 'invalid' } }, null, []]) {
    assert.throws(() => executeCanvasCommands(initial, [{ type: 'update', id: 'shape:existing', changes }]), CanvasEditError)
  }
  assert.throws(() => executeCanvasCommands(initial, [{ type: 'update', id: 'shape:missing', changes: { x: 5 } }]), CanvasEditError)
  assert.deepEqual(initial, before)
})

test('删除递归包含子形状及连接绑定，记录完整旧值，错误 ID 则整批拒绝', () => {
  const before = structuredClone(legacy)
  const result = executeCanvasCommands(legacy, [{ type: 'delete', ids: ['shape:frame'] }])
  const removed = ['shape:frame', 'shape:group', 'shape:text', 'shape:geo', 'shape:image', 'shape:html', 'binding:synthetic']
  assert.deepEqual(Object.keys(result.changes.removed).sort(), removed.sort())
  for (const id of removed) {
    assert.equal(result.snapshot.store[id], undefined)
    assert.deepEqual(result.changes.removed[id], before.store[id])
  }
  assert.deepEqual(result.snapshot.store['shape:arrow'], before.store['shape:arrow'])
  assert.deepEqual(result.snapshot.store['asset:synthetic'], before.store['asset:synthetic'])
  for (const ids of [['shape:frame', 'shape:missing'], [1], null]) {
    assert.throws(() => executeCanvasCommands(legacy, [{ type: 'delete', ids }]), CanvasEditError)
  }
  assert.deepEqual(legacy, before)
})

test('编辑批次不导出循环父子关系、缺失父形状或悬空资源与绑定', () => {
  const before = structuredClone(legacy)
  for (const command of [
    { type: 'update', id: 'shape:frame', changes: { parentId: 'shape:group' } },
    { type: 'update', id: 'shape:geo', changes: { parentId: 'shape:missing' } },
    { type: 'delete', ids: ['asset:synthetic'] },
    { type: 'put', record: { ...legacy.store['binding:synthetic'], toId: 'shape:missing' } }
  ]) {
    assert.throws(() => executeCanvasCommands(legacy, [command]), CanvasEditError)
  }
  assert.deepEqual(legacy, before)
})

test('变化记录只含批次净变化，返回值可修改且与命令、旧快照互不影响', () => {
  const command = { type: 'create_shape', id: 'shape:mutable', shapeType: 'geo', meta: { label: '原始' } }
  const result = executeCanvasCommands(legacy, [command])
  result.snapshot.store['shape:mutable'].meta.label = '快照已改'
  assert.equal(result.changes.added['shape:mutable'].meta.label, '原始')
  result.changes.added['shape:mutable'].meta.label = '变化已改'
  command.meta.label = '命令可改'
  assert.equal(legacy.store['shape:mutable'], undefined)
  const cancelled = executeCanvasCommands(legacy, [
    { type: 'update', id: 'shape:geo', changes: { x: 999 } },
    { type: 'update', id: 'shape:geo', changes: { x: legacy.store['shape:geo'].x } },
    { type: 'create_shape', id: 'shape:temporary', shapeType: 'text' },
    { type: 'delete', ids: ['shape:temporary'] }
  ])
  assert.deepEqual(cancelled.snapshot, legacy)
  assert.deepEqual(cancelled.changes, { added: {}, updated: {}, removed: {} })
})

test('新建形状沿用全部默认类型，拒绝无效父形状、重复 ID 和无效属性', () => {
  for (const shapeType of ['geo', 'text', 'arrow', 'image', 'embed', 'frame', 'group']) {
    const result = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', shapeType }])
    const [record] = Object.values(result.changes.added)
    assert.match(record.id, /^shape:[a-f0-9-]{36}$/)
    assert.equal(record.type, shapeType)
    assert.equal(record.parentId, 'page:page')
  }
  const child = executeCanvasCommands(legacy, [{ type: 'create_shape', shapeType: 'text', parentId: 'shape:group', text: '嵌套' }])
  assert.equal(Object.values(child.changes.added)[0].parentId, 'shape:group')
  for (const fields of [{ parentId: 'shape:missing' }, { parentId: 'asset:synthetic' }, { id: 'shape:geo' }, { id: 'asset:invalid' }, { shapeType: 'unsupported' }, { props: { w: 'invalid' } }]) {
    assert.throws(() => executeCanvasCommands(legacy, [{ type: 'create_shape', shapeType: 'geo', ...fields }]), error => error instanceof CanvasEditError && error.code === 'invalid-input')
  }
})

test('批次命令数量与类型无效时抛编辑层错误，失败后可安全再次执行', () => {
  const initial = structuredClone(legacy)
  for (const commands of [null, [], Array(20001).fill({ type: 'delete', ids: [] }), [null], [{ type: 'constructor' }]]) {
    assert.throws(() => executeCanvasCommands(initial, commands), CanvasEditError)
  }
  assert.throws(() => executeCanvasCommands(initial, [
    { type: 'delete', ids: ['shape:frame'] },
    { type: 'update', id: 'shape:missing', changes: { x: 1 } }
  ]), CanvasEditError)
  assert.deepEqual(initial, legacy)
  const result = executeCanvasCommands(initial, [{ type: 'update', id: 'shape:geo', changes: { x: 100 } }])
  assert.equal(result.snapshot.store['shape:geo'].x, 100)
})

test('更新和删除只接受快照文档记录，不能访问 Store 自动创建的会话记录', () => {
  const initial = createCanvasSnapshot()
  for (const id of ['camera:page:page', 'pointer:pointer', 'instance:instance']) {
    for (const command of [{ type: 'update', id, changes: { meta: { touched: true } } }, { type: 'delete', ids: [id] }]) {
      assert.throws(() => executeCanvasCommands(initial, [command]), CanvasEditError)
    }
  }
})

test('编辑层只允许原有的一张画布，不能新增、删除或替换内部 page', () => {
  const initial = createCanvasSnapshot()
  const page = initial.store['page:page']
  const extra = { ...page, id: 'page:extra', index: 'a2' }
  for (const commands of [
    [{ type: 'put', record: extra }],
    [{ type: 'delete', ids: [page.id] }],
    [{ type: 'put', record: extra }, { type: 'delete', ids: [page.id] }]
  ]) {
    assert.throws(() => executeCanvasCommands(initial, commands), CanvasEditError)
  }
  const multi = structuredClone(initial)
  multi.store[extra.id] = extra
  assert.throws(() => executeCanvasCommands(multi, [{ type: 'update', id: page.id, changes: { name: '不应执行' } }]), CanvasEditError)
})
