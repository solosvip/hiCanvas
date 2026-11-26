import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture } from './test-helpers.mjs'

test('HTTP 批次中途写入无效记录，即使后续修复也拒绝，内容和版本均不变', async t => {
  const { workspace, api } = await fixture(t)
  const { id } = await workspace.open()
  const initial = await workspace.read(id)
  const path = `/api/canvas/operations?conversation=${id}`
  const rejected = await api(path, 'POST', { expectedRevision: initial.revision, operations: [
    { type: 'create_shape', id: 'shape:batch', shapeType: 'geo' },
    { type: 'update', id: 'shape:batch', changes: { props: { w: 'invalid' } } },
    { type: 'update', id: 'shape:batch', changes: { props: { w: 300 } } }
  ] })
  assert.equal(rejected.status, 400)
  const after = await workspace.read(id)
  assert.equal(after.revision, initial.revision)
  assert.deepEqual(after.snapshot, initial.snapshot)

  const saved = await api(path, 'POST', { expectedRevision: initial.revision, operations: [{ type: 'create_shape', id: 'shape:batch', shapeType: 'geo' }] })
  assert.equal(saved.status, 200)
  assert.notEqual(saved.body.revision, initial.revision)
  assert.deepEqual(Object.keys(saved.body.changes.added), ['shape:batch'])
  assert.deepEqual(saved.body.changes.added['shape:batch'], saved.body.snapshot.store['shape:batch'])
  const conflict = await api(path, 'POST', { expectedRevision: initial.revision, operations: [{ type: 'delete', ids: ['shape:batch'] }] })
  assert.equal(conflict.status, 409)
  assert.equal((await workspace.read(id)).revision, saved.body.revision)
})

test('HTTP 返回的变化包含保存后的资源地址及更新、删除前后的完整记录', async t => {
  const { workspace, api } = await fixture(t)
  const { id } = await workspace.open()
  const initial = await workspace.read(id)
  const path = `/api/canvas/operations?conversation=${id}`
  const asset = { id: 'asset:receipt', typeName: 'asset', type: 'image', props: { name: '合成资源', src: '/assets/synthetic.png', w: 1, h: 1, mimeType: 'image/png', isAnimated: false }, meta: {} }
  const created = await api(path, 'POST', { expectedRevision: initial.revision, operations: [
    { type: 'put', record: asset }, { type: 'create_shape', id: 'shape:receipt', shapeType: 'geo' }
  ] })
  assert.equal(created.status, 200)
  assert.equal(created.body.changes.added[asset.id].props.src, `/c/${id}/assets/synthetic.png`)
  assert.deepEqual(created.body.changes.added[asset.id], created.body.snapshot.store[asset.id])
  const updated = await api(path, 'POST', { expectedRevision: created.body.revision, operations: [{ type: 'update', id: 'shape:receipt', changes: { x: 42 } }] })
  assert.equal(updated.status, 200)
  assert.deepEqual(updated.body.changes.updated['shape:receipt'], [created.body.snapshot.store['shape:receipt'], updated.body.snapshot.store['shape:receipt']])
  const duplicate = await api(path, 'POST', { expectedRevision: updated.body.revision, operations: [{ type: 'create_shape', id: 'shape:receipt', shapeType: 'geo' }] })
  assert.equal(duplicate.status, 400, '保持原有命令输入错误的 HTTP 状态；版本冲突仍为 409')
  const deleted = await api(path, 'POST', { expectedRevision: updated.body.revision, operations: [{ type: 'delete', ids: ['shape:receipt'] }] })
  assert.equal(deleted.status, 200)
  assert.deepEqual(deleted.body.changes.removed['shape:receipt'], updated.body.snapshot.store['shape:receipt'])
  assert.equal(deleted.body.snapshot.store['shape:receipt'], undefined)
  const legacySave = await api(`/api/canvas?conversation=${id}`, 'PUT', { expectedRevision: deleted.body.revision, snapshot: deleted.body.snapshot })
  assert.equal(legacySave.status, 200)
  assert.equal(legacySave.body.changes, undefined, '旧界面整份快照提交保留原接口')
})

test('资源地址归一化后内容未变，HTTP 回执不记虚假的更新', async t => {
  const { workspace, api } = await fixture(t)
  const { id } = await workspace.open()
  const initial = await workspace.read(id)
  const path = `/api/canvas/operations?conversation=${id}`
  const asset = { id: 'asset:equivalent', typeName: 'asset', type: 'image', props: { name: '合成资源', src: '/assets/synthetic.png', w: 1, h: 1, mimeType: 'image/png', isAnimated: false }, meta: {} }
  const first = await api(path, 'POST', { expectedRevision: initial.revision, operations: [{ type: 'put', record: asset }] })
  assert.equal(first.status, 200)
  const again = await api(path, 'POST', { expectedRevision: first.body.revision, operations: [{ type: 'put', record: asset }] })
  assert.equal(again.status, 200)
  assert.deepEqual(again.body.snapshot, first.body.snapshot)
  assert.deepEqual(again.body.changes, { added: {}, updated: {}, removed: {} })
})
