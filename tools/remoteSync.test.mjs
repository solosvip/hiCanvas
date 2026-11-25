import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createCanvasStore, createCanvasSnapshot } from '../model/index.js'
import { applyRemoteCanvasSnapshot } from '../src/editor/remoteSync.js'

test('远端删除当前页时同步删除旧页面和形状，并切换到仍存在的页面', () => {
  const snapshot = createCanvasSnapshot()
  const oldPage = Object.values(snapshot.store).find(r => r.typeName === 'page')
  const store = createCanvasStore()
  store.put(Object.values(snapshot.store))
  store.put([{ ...oldPage, id: 'page:next', name: '保留页', index: 'a2' }])
  let currentPage = oldPage.id
  let applying = false
  const merge = store.mergeRemoteChanges.bind(store)
  store.mergeRemoteChanges = callback => merge(() => { applying = true; try { callback() } finally { applying = false } })
  const editor = { store, getCurrentPageId: () => currentPage, setCurrentPage: id => { assert.equal(applying, false, '页面会话状态要在批处理结束后才能使用'); assert.ok(store.get(id)); currentPage = id } }
  const remote = store.getStoreSnapshot()
  delete remote.store[oldPage.id]
  const result = applyRemoteCanvasSnapshot(editor, remote)
  assert.equal(result.skippedRecords.length, 0)
  assert.equal(store.get(oldPage.id), undefined)
  assert.equal(currentPage, 'page:next')
  assert.equal(store.getStoreSnapshot().store[oldPage.id], undefined, '后续保存不会复活已删除页面')
})

test('界面同步经共享模型载入旧快照，保留形状、资源、绑定和元数据', async () => {
  const legacy = JSON.parse(await readFile(new URL('../server/fixtures/legacy-canvas.json', import.meta.url), 'utf8'))
  const store = createCanvasStore()
  store.loadStoreSnapshot(createCanvasSnapshot())
  const editor = { store, getCurrentPageId: () => 'page:page' }
  const result = applyRemoteCanvasSnapshot(editor, legacy)
  assert.ok(result.changedRecords > 0)
  assert.deepEqual(result.skippedRecords, [])
  assert.deepEqual(store.getStoreSnapshot(), legacy)

  const before = store.getStoreSnapshot()
  const damaged = structuredClone(legacy)
  delete damaged.store['asset:synthetic']
  const rejected = applyRemoteCanvasSnapshot(editor, damaged)
  assert.equal(rejected.changedRecords, 0)
  assert.ok(rejected.skippedRecords.some(record => record.id === 'shape:image'))
  assert.deepEqual(store.getStoreSnapshot(), before, '损坏的远端快照不能部分覆盖当前画板')
})
