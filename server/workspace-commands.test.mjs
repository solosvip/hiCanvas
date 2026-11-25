import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './test-helpers.mjs'

test('工作区只公开命令提交和旧界面整份提交，回执对应实际保存的记录', async t => {
  const { workspace } = await fixture(t), { id } = await workspace.open()
  const initial = await workspace.read(id)
  assert.equal(workspace.mutate, undefined)
  const asset = { id: 'asset:receipt', typeName: 'asset', type: 'image', props: { name: '合成', src: '/assets/synthetic.png', w: 1, h: 1, mimeType: 'image/png', isAnimated: false }, meta: {} }
  const saved = await workspace.submitCommands(id, initial.revision, 'test-session', async snapshot => {
    await Promise.resolve()
    assert.deepEqual(snapshot, initial.snapshot)
    return [{ type: 'put', record: asset }, { type: 'create_shape', id: 'shape:original', shapeType: 'geo' }, { type: 'duplicate_shapes', ids: ['shape:original'] }]
  })
  assert.equal(saved.actor, 'test-session')
  assert.equal(saved.previousRevision, initial.revision)
  assert.notEqual(saved.revision, initial.revision)
  assert.equal(saved.results.length, 3)
  assert.ok(saved.results[2].idMap['shape:original'])
  assert.equal(saved.snapshot.store[asset.id].props.src, `/c/${id}/assets/synthetic.png`)
  assert.deepEqual(saved.changes.added, Object.fromEntries(Object.keys(saved.changes.added).map(key => [key, saved.snapshot.store[key]])))
  const again = await workspace.submitCommands(id, saved.revision, 'test-session', () => [{ type: 'put', record: asset }])
  assert.deepEqual(again.changes, { added: {}, updated: {}, removed: {} })
  const legacy = await workspace.replaceLegacySnapshot(id, again.revision, again.snapshot)
  assert.equal(legacy.actor, 'legacy-ui')
  assert.equal(legacy.changes, undefined)
  assert.equal(legacy.results, undefined)
})

test('生成命令前先检查版本，失败事务不保存内容或版本', async t => {
  const { workspace } = await fixture(t), { id } = await workspace.open()
  const before = await workspace.read(id)
  let called = false
  for (const revision of [undefined, 'stale']) {
    await assert.rejects(workspace.submitCommands(id, revision, 'test', () => { called = true; return [] }), error => error.status === (revision ? 409 : 428))
  }
  assert.equal(called, false)
  await assert.rejects(workspace.submitCommands(id, before.revision, 'test', () => [
    { type: 'create_shape', id: 'shape:partial', shapeType: 'geo' },
    { type: 'update', id: 'shape:missing', changes: { x: 5 } },
  ]))
  assert.deepEqual(await workspace.read(id), before)
})

test('保存回执的快照与变化互不共享可变记录，修改回执也不影响已保存内容', async t => {
  const { workspace } = await fixture(t), { id } = await workspace.open()
  const before = await workspace.read(id)
  const saved = await workspace.submitCommands(id, before.revision, 'test', () => [{ type: 'create_shape', id: 'shape:result', shapeType: 'geo', meta: { note: '原注释' } }])
  const changes = structuredClone(saved.changes), snapshot = structuredClone(saved.snapshot)
  saved.snapshot.store['shape:result'].meta.note = '回执修改'
  assert.deepEqual(saved.changes, changes)
  saved.changes.added['shape:result'].x = 900
  assert.equal(saved.snapshot.store['shape:result'].x, snapshot.store['shape:result'].x)
  assert.deepEqual((await workspace.read(id)).snapshot, snapshot)
})

test('同步或异步生成命令的函数不能修改只读快照，任何深度的修改均不落盘', async t => {
  const { workspace } = await fixture(t), { id } = await workspace.open()
  const initial = await workspace.read(id)
  await workspace.submitCommands(id, initial.revision, 'test', () => [{ type: 'create_shape', id: 'shape:test', shapeType: 'geo', meta: { nested: { labels: ['保留'] } } }])
  const before = await workspace.read(id)
  for (const change of [
    snapshot => { snapshot.store['shape:test'].x = 99 },
    snapshot => { delete snapshot.store['shape:test'] },
    snapshot => { Object.assign(snapshot.store['shape:test'].props, { w: 999 }) },
    snapshot => { snapshot.store['shape:test'].meta.nested.labels.push('不许写入') },
    snapshot => { snapshot.store = {} },
  ]) {
    await assert.rejects(workspace.submitCommands(id, before.revision, 'test', async snapshot => {
      await Promise.resolve()
      change(snapshot)
      return [{ type: 'delete', ids: ['shape:test'] }]
    }), TypeError)
    assert.deepEqual(await workspace.read(id), before)
  }
})
