import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { fixture } from './test-helpers.mjs'
import { createCanvasMedia } from './canvas-media.mjs'
import { rasterFiles } from '../tools/renderer-preview/image-fixtures.js'

const dataUrl = `data:image/png;base64,${rasterFiles.png.base64}`
const input = src => ({ type: 'insert_image', image: { src, w: 320, h: 180, name: 'synthetic', mimeType: 'image/png', isAnimated: false }, args: {} })
async function setup(t) {
  const f = await fixture(t), { id } = await f.workspace.open(), media = createCanvasMedia(f.workspace)
  const begin = async actor => (await media.reference(id, { purpose: 'file-import-begin' }, actor)).importToken
  const upload = (importToken, actor = 'ui:A') => media.reference(id, { purpose: 'file-import', dataUrl, importToken }, actor)
  const abort = (importToken, actor = 'ui:A') => media.reference(id, { purpose: 'file-import-abort', importToken }, actor)
  return { ...f, id, media, begin, upload, abort }
}
test('后续坏文件失败：只清本次上传，不改变快照、版本和既有素材', async t => {
  const f = await setup(t), before = await f.workspace.read(f.id)
  const existing = await f.media.reference(f.id, { purpose: 'file-import', dataUrl })
  const token = await f.begin('ui:A'), created = await f.upload(token)
  await assert.rejects(f.media.reference(f.id, { purpose: 'file-import', importToken: token, dataUrl: 'data:image/png;base64,eA==' }, 'ui:A'))
  assert.equal((await f.abort(token)).remaining, 0)
  await assert.rejects(access(created.assetPath), { code: 'ENOENT' })
  await access(existing.assetPath); assert.deepEqual(await f.workspace.read(f.id), before)
})

test('提交成功丢回执后撤销再取消：资源永久保留，重做不缺图', async t => {
  const f = await setup(t), token = await f.begin('ui:A'), created = await f.upload(token), before = await f.workspace.read(f.id)
  const saved = await f.workspace.submitCommands(f.id, before.revision, 'ui:A', () => [input(created.src)])
  const undone = await f.workspace.undo(f.id, saved.revision, 'ui:A')
  const cleanup = await f.abort(token)
  assert.equal(cleanup.remaining, 0)
  await access(created.assetPath)
  const redone = await f.workspace.redo(f.id, undone.revision, 'ui:A')
  assert.ok(Object.values(redone.snapshot.store).some(r => r.typeName === 'asset' && r.props.src === created.src))
})
test('取消先完成再放行迟到提交：新命名空间失效地址不得落入画板', async t => {
  const f = await setup(t), token = await f.begin('ui:A'), created = await f.upload(token), before = await f.workspace.read(f.id)
  let entered, release
  const enteredPromise = new Promise(r => { entered = r }), gate = new Promise(r => { release = r })
  const pending = (async () => { entered(); await gate; return f.workspace.submitCommands(f.id, before.revision, 'ui:A', () => [input(created.src)]) })()
  await enteredPromise
  try { await f.abort(token) } finally { release() }
  await assert.rejects(pending, e => e.status === 409)
  assert.deepEqual(await f.workspace.read(f.id), before)
})
test('提交先获得画板锁，取消随后到达：不死锁且成功素材不删', async t => {
  const f = await setup(t), token = await f.begin('ui:A'), created = await f.upload(token), before = await f.workspace.read(f.id)
  let entered, release
  const enteredPromise = new Promise(r => { entered = r }), gate = new Promise(r => { release = r })
  const pending = f.workspace.submitCommands(f.id, before.revision, 'ui:A', async () => { entered(); await gate; return [input(created.src)] })
  await enteredPromise
  const cancel = f.abort(token); release()
  const saved = await pending
  assert.equal((await cancel).remaining, 0); await access(created.assetPath)
  assert.ok(saved.snapshot.store)
})

test('A/B同内容并发、无凭证MCP上传和其他操作者引用：A只清未保护的自身文件', async t => {
  const f = await setup(t), [a, b] = await Promise.all([f.begin('ui:A'), f.begin('ui:B')])
  const [first, second] = await Promise.all([f.upload(a), f.upload(b, 'ui:B')])
  const third = await f.media.reference(f.id, { dataUrl }, 'mcp:other')
  assert.notEqual(first.src, second.src)
  await f.abort(a)
  await assert.rejects(access(first.assetPath), { code: 'ENOENT' }); await access(second.assetPath); await access(third.assetPath)
  const before = await f.workspace.read(f.id)
  await f.workspace.submitCommands(f.id, before.revision, 'mcp:other', () => [input(second.src)])
  await f.abort(b, 'ui:B'); await access(second.assetPath)
})
test('普通提交、MCP插图/既有assetUrl复用、生图结果写回和旧地址缺文件均不新增拒绝', async t => {
  const f = await setup(t)
  let current = await f.workspace.read(f.id)
  const ordinary = await f.workspace.submitCommands(f.id, current.revision, 'mcp:test', () => [{ type: 'create_shape', shapeType: 'geo' }])
  const image = await f.media.insertImage(f.id, { expectedRevision: ordinary.revision, dataUrl }, 'mcp:test')
  const reused = await f.media.insertImage(f.id, { expectedRevision: image.revision, assetUrl: image.assetUrl }, 'mcp:test')
  const keep = await readFile(image.assetPath)
  const token = await f.begin('ui:A'); await f.upload(token); await f.abort(token)
  assert.deepEqual(await readFile(image.assetPath), keep)
  const generated = await f.workspace.submitCommands(f.id, reused.revision, 'image-jobs', () => [input(image.assetUrl)])
  const legacy = await f.workspace.submitCommands(f.id, generated.revision, 'mcp:test', () => [input(`/c/${f.id}/assets/old-missing.png`)])
  assert.ok(legacy.snapshot.store)
})
test('版本冲突和命令拒绝都可清理，成功之前绝不消耗历史', async t => {
  const f = await setup(t), token = await f.begin('ui:A'), created = await f.upload(token), before = await f.workspace.read(f.id)
  await assert.rejects(f.workspace.submitCommands(f.id, 'stale', 'ui:A', () => [input(created.src)]), e => e.status === 409)
  await assert.rejects(f.workspace.submitCommands(f.id, before.revision, 'ui:A', () => [{ type: 'update', id: 'shape:missing', changes: { x: 4 } }]))
  await f.abort(token); await assert.rejects(access(created.assetPath), { code: 'ENOENT' })
  assert.deepEqual(await f.workspace.read(f.id), before)
})
test('凭证不跨actor/画板，编造和重复取消不扩展删除范围', async t => {
  const f = await setup(t), { id: other } = await f.workspace.open(), token = await f.begin('ui:A'), created = await f.upload(token)
  for (const [id, importToken, actor] of [[f.id, token, 'ui:B'], [other, token, 'ui:A'], [f.id, 'invented', 'ui:A']]) {
    await assert.rejects(f.media.reference(id, { purpose: 'file-import-abort', importToken }, actor), e => e.status === 403)
    await access(created.assetPath)
  }
  await f.abort(token); assert.equal((await f.abort(token)).remaining, 0)
  await assert.rejects(f.upload(token), e => e.status === 403)
})

test('租约到期清理失联窗口上传，迟到上传/提交均拒绝', async t => {
  const f = await setup(t), token = await f.begin('ui:A'), created = await f.upload(token), before = await f.workspace.read(f.id)
  // Drive the public cancellation-equivalent lease using a controlled clock.
  // This test starts its clock before creating the attempt below.
  await f.abort(token)
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  const leased = await f.begin('ui:A'), file = await f.upload(leased)
  t.mock.timers.tick(300001)
  // Flush the timer's real filesystem/SQLite operation without advancing lock retries.
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setImmediate(resolve))
    if (!(await access(file.assetPath).then(() => true, () => false))) break
  }
  await assert.rejects(access(file.assetPath), { code: 'ENOENT' })
  await assert.rejects(f.upload(leased))
  await assert.rejects(f.workspace.submitCommands(f.id, before.revision, 'ui:A', () => [input(created.src)]), e => e.status === 409)
})
test('每板8、工作区32个待定尝试上限，取消释放容量', async t => {
  const f = await setup(t), boards = [f.id]
  for (let i = 0; i < 3; i++) boards.push((await f.workspace.open()).id)
  const pending = []
  for (const id of boards) for (let i = 0; i < 8; i++) pending.push([id, (await f.media.reference(id, { purpose: 'file-import-begin' }, 'ui:A')).importToken])
  await assert.rejects(f.begin('ui:A'), e => e.status === 429)
  const extra = (await f.workspace.open()).id
  await assert.rejects(f.media.reference(extra, { purpose: 'file-import-begin' }, 'ui:A'), e => e.status === 429)
  for (const [id, importToken] of pending) await f.media.reference(id, { purpose: 'file-import-abort', importToken }, 'ui:A')
  await f.abort(await f.begin('ui:A'))
})

test('真实写盘失败在资源已上传后发生，回滚本次文件，既有快照仍可恢复', async t => {
  const f = await setup(t), token = await f.begin('ui:A'), file = await f.upload(token), before = await f.workspace.read(f.id)
  const { rename, mkdir, rm } = await import('node:fs/promises'), { join } = await import('node:path')
  const state = join(f.root, 'conversations', f.id, 'state.json'), saved = state + '.synthetic'
  try {
    await assert.rejects(f.workspace.submitCommands(f.id, before.revision, 'ui:A', async () => {
      await rename(state, saved); await mkdir(state)
      return [input(file.src)]
    }))
  } finally { await rm(state, { recursive: true, force: true }); await rename(saved, state) }
  await f.abort(token); await assert.rejects(access(file.assetPath), { code: 'ENOENT' })
  assert.deepEqual(await f.workspace.read(f.id), before)
})

test('其他操作者先保护批次第一项，批次仍可继续第二项；失败只删尚未保护项', async t => {
  const f = await setup(t), token = (await f.media.reference(f.id, { purpose: 'file-import-begin', fileCount: 2 }, 'ui:A')).importToken
  const first = await f.upload(token), before = await f.workspace.read(f.id)
  await f.workspace.submitCommands(f.id, before.revision, 'mcp:other', () => [input(first.src)])
  const second = await f.upload(token)
  await f.abort(token)
  await access(first.assetPath); await assert.rejects(access(second.assetPath), { code: 'ENOENT' })
})
test('第二项已进入上传队列时首项先被保护，不会写出无租约的迟到文件', async t => {
  const f = await setup(t), token = (await f.media.reference(f.id, { purpose: 'file-import-begin', fileCount: 2 }, 'ui:A')).importToken
  const first = await f.upload(token), before = await f.workspace.read(f.id)
  let entered, release
  const gate = new Promise(r => { release = r }), reached = new Promise(r => { entered = r })
  const save = f.workspace.submitCommands(f.id, before.revision, 'mcp:other', async () => { entered(); await gate; return [input(first.src)] })
  await reached
  const pending = f.upload(token)
  release(); await save
  const second = await pending
  await f.abort(token)
  await access(first.assetPath); await assert.rejects(access(second.assetPath), { code: 'ENOENT' })
})

test('另一画板不能保存待定文件；来源保存失败并清理后，两板都无空引用', async t => {
  const f = await setup(t), { id: other } = await f.workspace.open(), token = await f.begin('ui:A'), file = await f.upload(token)
  const before = await f.workspace.read(other)
  await assert.rejects(f.workspace.submitCommands(other, before.revision, 'mcp:B', () => [input(file.src)]), e => e.status === 400 && /另一个画板/.test(e.message))
  await assert.rejects(f.workspace.submitCommands(f.id, 'stale', 'ui:A', () => [input(file.src)]))
  await f.abort(token)
  await assert.rejects(access(file.assetPath), { code: 'ENOENT' })
  assert.deepEqual(await f.workspace.read(other), before)
  assert.equal(Object.values((await f.workspace.read(f.id)).snapshot.store).filter(r => r.typeName === 'shape').length, 0)
  await assert.rejects(f.workspace.submitCommands(other, before.revision, 'mcp:B', () => [input(file.src)]), e => e.status === 400)
})
test('来源租约过期时跨板待定引用未写入，清理后也不接受迟到跨板引用', async t => {
  const f = await setup(t), { id: other } = await f.workspace.open(), before = await f.workspace.read(other)
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  const token = await f.begin('ui:A'), file = await f.upload(token)
  await assert.rejects(f.workspace.submitCommands(other, before.revision, 'mcp:B', () => [input(file.src)]), e => e.status === 400)
  t.mock.timers.tick(300001)
  for (let i = 0; i < 100; i++) { await new Promise(r => setImmediate(r)); if (!(await access(file.assetPath).then(() => true, () => false))) break }
  await assert.rejects(access(file.assetPath), { code: 'ENOENT' }); assert.deepEqual(await f.workspace.read(other), before)
  await assert.rejects(f.workspace.submitCommands(other, before.revision, 'mcp:B', () => [input(file.src)]), e => e.status === 400)
})
test('已保存媒体的跨板引用也沿既有门禁拒绝；来源撤销和迟到取消仍保留文件', async t => {
  const f = await setup(t), { id: other } = await f.workspace.open(), token = await f.begin('ui:A'), file = await f.upload(token)
  const saved = await f.workspace.submitCommands(f.id, (await f.workspace.read(f.id)).revision, 'ui:A', () => [input(file.src)])
  const before = await f.workspace.read(other)
  await assert.rejects(f.workspace.submitCommands(other, before.revision, 'mcp:B', () => [input(file.src)]), e => e.status === 400)
  await f.workspace.undo(f.id, saved.revision, 'ui:A'); await f.abort(token); await access(file.assetPath)
  assert.deepEqual(await f.workspace.read(other), before)
})

test('批次数量需1到100整数，超出已声明数量不写文件；完整保存即释放待定容量', async t => {
  const f = await setup(t)
  for (const fileCount of [0, -1, 101, 1.5, '1', null]) await assert.rejects(f.media.reference(f.id, { purpose: 'file-import-begin', fileCount }, 'ui:A'), e => e.status === 400)
  for (let i = 0; i < 10; i++) {
    const token = (await f.media.reference(f.id, { purpose: 'file-import-begin', fileCount: 1 }, 'ui:A')).importToken
    const file = await f.upload(token)
    await assert.rejects(f.upload(token), e => e.status === 413)
    // A rejected surplus upload does not finish or orphan the original file.
    await f.abort(token); await assert.rejects(access(file.assetPath), { code: 'ENOENT' })
    const success = (await f.media.reference(f.id, { purpose: 'file-import-begin', fileCount: 1 }, 'ui:A')).importToken
    const saved = await f.upload(success)
    await f.workspace.submitCommands(f.id, (await f.workspace.read(f.id)).revision, 'ui:A', () => [input(saved.src)])
    await f.abort(success); await access(saved.assetPath)
  }
})
