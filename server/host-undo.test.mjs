import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './test-helpers.mjs'
import { createConversations } from './conversations.mjs'
import { shape, update } from './fixtures/editor-session-fixture.mjs'

async function open(t) {
  const f = await fixture(t)
  const { body } = await f.api('/api/conversations/open', 'POST', { title: '合成撤销历史' })
  const id = body.conversation.id, query = `?conversation=${id}`
  const read = async () => (await f.api('/api/canvas' + query)).body
  const edit = async (actor, operations, expectedRevision) => f.api('/api/canvas/operations' + query, 'POST', { expectedRevision: expectedRevision ?? (await read()).revision, operations }, { 'x-hicanvas-actor': actor })
  const move = async (direction, actor, expectedRevision) => f.api('/api/canvas/' + direction + query, 'POST', { expectedRevision: expectedRevision ?? (await read()).revision, actor })
  return { ...f, id, query, read, edit, move }
}

test('本机服务单操作者撤销重做逐值还原，返回实际变化并持久保存', async t => {
  const f = await open(t), before = await f.read()
  const saved = await f.edit('ui:one', [shape('one', { x: 1.25, y: 6.125, rotation: .37 })])
  assert.equal(saved.status, 200)
  const undo = await f.move('undo', 'ui:one')
  assert.equal(undo.status, 200)
  assert.deepEqual(undo.body.snapshot, before.snapshot)
  assert.deepEqual(Object.keys(undo.body.changes.removed), ['shape:one'])
  assert.equal(undo.body.actor, 'ui:one')
  assert.notEqual(undo.body.revision, saved.body.revision)
  assert.deepEqual((await f.read()).snapshot, before.snapshot)
  const redo = await f.move('redo', 'ui:one')
  assert.equal(redo.status, 200)
  assert.deepEqual(redo.body.snapshot, saved.body.snapshot)
  const disk = JSON.parse(await readFile(join(f.root, 'conversations', f.id, 'state.json'), 'utf8'))
  assert.deepEqual(disk.snapshot, saved.body.snapshot)
  assert.equal(Object.hasOwn(disk, 'history'), false)
})

test('交错操作者各撤各的，同名操作者在其他画板没有历史', async t => {
  const f = await open(t)
  await f.edit('ui:A', [shape('A')]); await f.edit('ai:B', [shape('B')])
  const undoA = await f.move('undo', 'ui:A')
  assert.equal(undoA.status, 200)
  assert.equal(undoA.body.snapshot.store['shape:A'], undefined)
  assert.ok(undoA.body.snapshot.store['shape:B'])
  const undoB = await f.move('undo', 'ai:B')
  assert.equal(undoB.status, 200)
  assert.equal(undoB.body.snapshot.store['shape:B'], undefined)
  assert.equal((await f.move('redo', 'ui:A')).status, 200)
  const { body } = await f.api('/api/conversations/open', 'POST', { createNew: true })
  const current = (await f.api(`/api/canvas?conversation=${body.conversation.id}`)).body
  const other = await f.api(`/api/canvas/undo?conversation=${body.conversation.id}`, 'POST', { actor: 'ui:A', expectedRevision: current.revision })
  assert.equal(other.status, 409)
  assert.match(other.body.error, /没有可撤销/)
})

test('被其他操作者改过的记录拒绝撤销，拒绝后内容、版本和历史保持', async t => {
  const f = await open(t)
  await f.edit('ui:A', [shape('shared')])
  await f.edit('ai:B', [update('shared', { x: 99 })])
  const before = await f.read(), rejected = await f.move('undo', 'ui:A')
  assert.equal(rejected.status, 409)
  assert.match(rejected.body.error, /shape:shared.*修改|删除/)
  assert.deepEqual(await f.read(), before)
  assert.equal((await f.move('undo', 'ai:B')).status, 200)
  assert.equal((await f.move('undo', 'ui:A')).status, 200)
})

test('撤销及重做都检查预期版本；同时撤销只允许一项成功', async t => {
  const f = await open(t), stale = await f.read()
  await f.edit('ui:A', [shape('one')])
  const current = await f.read()
  for (const direction of ['undo', 'redo']) {
    assert.equal((await f.move(direction, 'ui:A', stale.revision)).status, 409)
    assert.equal((await f.api('/api/canvas/' + direction + f.query, 'POST', { actor: 'ui:A' })).status, 428)
  }
  assert.deepEqual(await f.read(), current)
  const replies = await Promise.all([f.move('undo', 'ui:A', current.revision), f.move('undo', 'ui:A', current.revision)])
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 409])
  const redo = await f.move('redo', 'ui:A')
  assert.equal(redo.status, 200)
  assert.deepEqual(redo.body.snapshot, current.snapshot)
})

test('新事务仅清除该操作者的重做；空事务不占用或清除历史', async t => {
  const f = await open(t)
  await f.edit('ui:A', [shape('A')]); await f.edit('ui:B', [shape('B')])
  await f.move('undo', 'ui:A'); await f.move('undo', 'ui:B')
  await f.edit('ui:A', [])
  assert.equal((await f.move('redo', 'ui:A')).status, 200)
  await f.move('undo', 'ui:A')
  await f.edit('ui:A', [shape('new-A')])
  assert.equal((await f.move('redo', 'ui:A')).status, 409)
  assert.equal((await f.move('redo', 'ui:B')).status, 200)
})

test('每操作者最多100条，丢最旧的；重建服务不恢复内存历史', async t => {
  const f = await open(t)
  await f.edit('seed', [shape('limit')])
  let state = await f.read()
  for (let x = 1; x <= 101; x++) state = await f.workspace.submitCommands(f.id, state.revision, 'ui:limit', () => [update('limit', { x })])
  for (let i = 0; i < 100; i++) state = await f.workspace.undo(f.id, state.revision, 'ui:limit')
  assert.equal(state.snapshot.store['shape:limit'].x, 1)
  await assert.rejects(f.workspace.undo(f.id, state.revision, 'ui:limit'), /没有可撤销/)
  const restarted = createConversations(f.root), reopened = await restarted.read(f.id)
  assert.deepEqual(reopened.snapshot, state.snapshot)
  await assert.rejects(restarted.undo(f.id, reopened.revision, 'seed'), /没有可撤销/)
})

test('撤销入口要求非空操作者，历史不能由调用方传入', async t => {
  const f = await open(t)
  await f.edit('ui:A', [shape('protected')])
  for (const actor of [undefined, '', ' ', 1, {}, []]) {
    const before = await f.read()
    const response = await f.api('/api/canvas/undo' + f.query, 'POST', { actor, expectedRevision: before.revision, history: { actors: [] } })
    assert.equal(response.status, 400)
    assert.deepEqual(await f.read(), before)
  }
  assert.equal((await f.move('undo', 'ui:A')).status, 200)
})

test('写盘失败不记录新事务，也不清空已有重做', async t => {
  const f = await open(t)
  await f.edit('ui:A', [shape('saved')]); await f.move('undo', 'ui:A')
  const before = await f.read(), file = join(f.root, 'conversations', f.id, 'state.json'), backup = file + '.synthetic-backup'
  let moved = false
  try {
    await assert.rejects(f.workspace.submitCommands(f.id, before.revision, 'ui:A', async () => {
      // 只移动本测试隔离目录的合成状态，制造原子替换失败；不依赖用户权限或磁盘空间。
      await rename(file, backup); moved = true; await mkdir(file)
      return [shape('failed')]
    }), error => ['EISDIR', 'ENOTDIR', 'ENOTEMPTY', 'EEXIST'].includes(error.code))
  } finally {
    if (moved) { await rm(file, { recursive: true, force: true }); await rename(backup, file) }
  }
  assert.deepEqual(await f.read(), before)
  const redo = await f.move('redo', 'ui:A')
  assert.equal(redo.status, 200)
  assert.ok(redo.body.snapshot.store['shape:saved'])
  assert.equal(redo.body.snapshot.store['shape:failed'], undefined)
  assert.equal((await f.move('undo', 'ui:A')).status, 200)
  assert.equal((await f.move('undo', 'ui:A')).status, 409)
})

test('媒体写入和网页编辑自动记历史，撤销重做使用最终保存的本机资源地址', async t => {
  const f = await open(t), before = await f.read(), headers = { 'x-hicanvas-actor': 'ui:media' }
  const html = await f.api('/api/canvas/html' + f.query, 'POST', { expectedRevision: before.revision, htmlContent: '<html>合成初稿</html>' }, headers)
  assert.equal(html.status, 200)
  const saved = await f.read()
  assert.equal((await f.move('undo', 'ui:media')).status, 200)
  assert.deepEqual((await f.read()).snapshot, before.snapshot)
  assert.equal((await f.move('redo', 'ui:media')).status, 200)
  assert.deepEqual((await f.read()).snapshot, saved.snapshot)
  const edited = await f.api('/api/html-draft' + f.query, 'PUT', { expectedRevision: (await f.read()).revision, draftShapeId: html.body.shapeId, htmlContent: '<html>合成第二稿</html>' }, headers)
  assert.equal(edited.status, 200)
  assert.equal((await f.move('undo', 'ui:media')).status, 200)
  assert.deepEqual((await f.read()).snapshot, saved.snapshot)
  assert.equal(await readFile(html.body.assetPath, 'utf8'), '<html>合成初稿</html>')
  const current = await f.read()
  const image = await f.api('/api/canvas/image' + f.query, 'POST', { expectedRevision: current.revision, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }, headers)
  assert.equal(image.status, 200)
  const imageSaved = await f.read()
  assert.equal((await f.move('undo', 'ui:media')).status, 200)
  assert.deepEqual((await f.read()).snapshot, current.snapshot)
  assert.equal((await f.move('redo', 'ui:media')).status, 200)
  assert.deepEqual((await f.read()).snapshot, imageSaved.snapshot)
})

test('旧界面整份快照不生成撤销历史，修改过的记录仍受冲突保护', async t => {
  const f = await open(t)
  await f.edit('ui:A', [shape('legacy')])
  const before = await f.read(), snapshot = structuredClone(before.snapshot)
  snapshot.store['shape:legacy'].x = 75
  const saved = await f.api('/api/canvas' + f.query, 'PUT', { expectedRevision: before.revision, snapshot })
  assert.equal(saved.status, 200)
  const noHistory = await f.move('undo', 'legacy-ui')
  assert.equal(noHistory.status, 409)
  assert.match(noHistory.body.error, /没有可撤销/)
  assert.equal((await f.move('undo', 'ui:A')).status, 409)
  assert.deepEqual((await f.read()).snapshot, snapshot)
})
