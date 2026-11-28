import '../tools/test-sandbox.mjs'
import '../tools/renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot, normalizeBookmarkMetadata } from '../model/index.js'
import { executeCanvasCommands, recordCanvasTransaction, undoCanvasTransaction, redoCanvasTransaction } from '../engine/index.js'

const originalUrl = 'https://old.example.invalid/path#user-fragment'
const nextUrl = 'https://new.example.invalid/next#user-fragment'
const metadata = { title: '新的标题', description: '新的描述', url: 'https://new.example.invalid/canonical#discard' }
const empty = changes => ['added', 'updated', 'removed'].every(key => Object.keys(changes[key]).length === 0)
const run = (snapshot, command) => executeCanvasCommands(snapshot, [command])

function fixture({ shared = false, hidden = false, locked = false } = {}) {
  let snapshot = run(createCanvasSnapshot(), { type: 'insert_url', id: 'shape:bookmark', url: originalUrl }).snapshot
  const target = snapshot.store['shape:bookmark'], asset = snapshot.store[target.props.assetId]
  const oldAsset = { ...asset, meta: { synthetic: 'preserve' }, props: { ...asset.props, title: '旧标题', description: '旧描述', image: '/synthetic-old-image.png', favicon: '/synthetic-old-icon.png' } }
  const commands = [{ type: 'put', record: oldAsset }]
  if (shared) commands.push({ type: 'put', record: { ...target, id: 'shape:peer', index: 'a9', isLocked: true } })
  if (hidden || locked) commands.push({ type: 'update', id: target.id, changes: { ...(hidden && { opacity: 0 }), ...(locked && { isLocked: true }) } })
  snapshot = executeCanvasCommands(snapshot, commands).snapshot
  return { snapshot, target: snapshot.store[target.id], asset: snapshot.store[asset.id] }
}

function command(f, type = 'set_bookmark_metadata', extra = {}) {
  return { type, id: f.target.id, assetId: f.asset.id, sourceUrl: f.target.props.url,
    metadata: { title: '新标题', description: '新描述', url: originalUrl }, ...extra }
}

test('同址刷新仅改文字及资源规范网址，保留用户URL、图片、图标、几何和资源meta', () => {
  const f = fixture(), before = structuredClone(f.snapshot)
  const result = run(f.snapshot, command(f))
  assert.deepEqual(result.snapshot.store[f.target.id], f.target)
  assert.deepEqual(result.snapshot.store[f.asset.id], { ...f.asset, props: { ...f.asset.props,
    src: 'https://old.example.invalid/path', title: '新标题', description: '新描述' } })
  assert.deepEqual(f.snapshot, before)
  assert.equal(Object.keys(result.changes.added).length, 0)
})

test('共用资源只重绑当前书签，锁定的另一张卡及旧资源保持；一次undo/redo完整恢复', () => {
  const f = fixture({ shared: true }), result = run(f.snapshot, command(f))
  const current = result.snapshot.store[f.target.id]
  assert.notEqual(current.props.assetId, f.asset.id)
  assert.equal(Object.keys(result.changes.added).length, 1)
  assert.deepEqual(result.snapshot.store[f.asset.id], f.asset)
  assert.deepEqual(result.snapshot.store['shape:peer'], f.snapshot.store['shape:peer'])
  assert.equal(result.snapshot.store[current.props.assetId].props.image, f.asset.props.image)
  let history = recordCanvasTransaction(null, 'ui:bookmarks', result.changes)
  const undone = undoCanvasTransaction(result.snapshot, history, 'ui:bookmarks')
  assert.deepEqual(undone.snapshot, f.snapshot)
  const redone = redoCanvasTransaction(undone.snapshot, undone.history, 'ui:bookmarks')
  assert.deepEqual(redone.snapshot, result.snapshot)
})

for (const shared of [false, true]) test(`改网址同时替换文字并清掉旧图片/图标，一次undo恢复全部（共用=${shared}）`, () => {
  const f = fixture({ shared }), result = run(f.snapshot, command(f, 'set_bookmark_url', { url: nextUrl, metadata }))
  const target = result.snapshot.store[f.target.id], asset = result.snapshot.store[target.props.assetId]
  assert.deepEqual({ ...target, props: f.target.props }, f.target)
  assert.equal(target.props.url, nextUrl)
  assert.deepEqual(asset.props, { ...f.asset.props, title: metadata.title, description: metadata.description,
    src: 'https://new.example.invalid/canonical', image: '', favicon: '' })
  if (shared) {
    assert.notEqual(asset.id, f.asset.id)
    assert.deepEqual(result.snapshot.store[f.asset.id], f.asset)
  }
  const history = recordCanvasTransaction(null, 'ui:bookmarks', result.changes)
  const undone = undoCanvasTransaction(result.snapshot, history, 'ui:bookmarks')
  assert.deepEqual(undone.snapshot, f.snapshot)
  assert.deepEqual(redoCanvasTransaction(undone.snapshot, undone.history, 'ui:bookmarks').snapshot, result.snapshot)
})

test('明确仅保存网址允许本机链接，但新卡不继承旧信息；此命令没有抓取能力', () => {
  const f = fixture(), url = 'http://127.0.0.1/local#saved-as-data'
  const result = run(f.snapshot, command(f, 'set_bookmark_url', { url, metadata: null }))
  const target = result.snapshot.store[f.target.id], asset = result.snapshot.store[target.props.assetId]
  assert.equal(target.props.url, url)
  assert.deepEqual(asset.props, { src: 'http://127.0.0.1/local', title: '', description: '', image: '', favicon: '' })
})

for (const state of [{ hidden: true }, { locked: true }]) test(`隐藏或锁定书签不能写回：${JSON.stringify(state)}`, () => {
  const f = fixture(state), before = structuredClone(f.snapshot)
  assert.throws(() => run(f.snapshot, command(f)))
  assert.deepEqual(f.snapshot, before)
})

test('坏目标/资源/原URL/DTO整批拒绝，前面的合法命令也不泄漏到输入', () => {
  const f = fixture(), before = structuredClone(f.snapshot)
  for (const extra of [
    { id: 'shape:missing' }, { assetId: 'asset:missing' }, { sourceUrl: nextUrl },
    { metadata: { ...metadata, url: 'javascript:alert(1)' } },
    { metadata: { ...metadata, html: '<script>untrusted</script>' } },
  ]) {
    assert.throws(() => executeCanvasCommands(f.snapshot, [
      { type: 'create_shape', shapeType: 'geo', id: 'shape:must-not-leak' }, command(f, 'set_bookmark_metadata', extra),
    ]))
    assert.deepEqual(f.snapshot, before)
  }
})

test('全空刷新或最终信息完全相同时没有净变化；空字段不清掉原来的非空文字', () => {
  const f = fixture()
  const noInfo = run(f.snapshot, command(f, 'set_bookmark_metadata', { metadata: { title: '', description: '', url: nextUrl } }))
  assert.ok(empty(noInfo.changes)); assert.deepEqual(noInfo.snapshot, f.snapshot)
  const same = run(f.snapshot, command(f, 'set_bookmark_metadata', { metadata: { title: f.asset.props.title, description: f.asset.props.description, url: originalUrl } }))
  const normalized = run(same.snapshot, command(f, 'set_bookmark_metadata', { metadata: { title: f.asset.props.title, description: f.asset.props.description, url: originalUrl } }))
  assert.ok(empty(normalized.changes))
  const partial = run(f.snapshot, command(f, 'set_bookmark_metadata', { metadata: { title: '', description: '新描述', url: originalUrl } }))
  assert.equal(partial.snapshot.store[f.asset.id].props.title, f.asset.props.title)
})

test('同网址无操作仍校验命令DTO，坏数据不能让整批其他写入通过', () => {
  const f = fixture(), before = structuredClone(f.snapshot)
  assert.throws(() => executeCanvasCommands(f.snapshot, [
    { type: 'create_shape', shapeType: 'geo', id: 'shape:must-not-leak' },
    command(f, 'set_bookmark_url', { url: originalUrl, metadata: { ...metadata, html: '<script>untrusted</script>' } }),
  ]))
  assert.deepEqual(f.snapshot, before)
  assert.ok(empty(run(f.snapshot, command(f, 'set_bookmark_url', { url: originalUrl, metadata: null })).changes))
})

test('DTO统一复用HTTP网址规范化，并只为书签删除fragment', () => {
  assert.deepEqual(normalizeBookmarkMetadata({ title: '  合成 标题  ', description: '合成\n描述', url: 'HTTPS://EXAMPLE.INVALID/path#part' }),
    { title: '合成 标题', description: '合成 描述', url: 'https://example.invalid/path' })
  for (const url of ['https://user:secret@example.invalid/', 'javascript:alert(1)', '//example.invalid/']) {
    assert.throws(() => normalizeBookmarkMetadata({ title: '', description: '', url }))
  }
})
