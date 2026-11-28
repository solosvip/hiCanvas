import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fixture } from './test-helpers.mjs'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
async function filesAt(dir) { return readdir(dir).catch(error => { if (error.code === 'ENOENT') return []; throw error }) }

test('图片只预演返回放置结果，不保存资源或画板，预计位置与执行相同', async t => {
  const { workspace, api } = await fixture(t)
  const { id } = await workspace.open()
  const before = await workspace.read(id)
  const dir = await workspace.assetsDir(id)
  const files = await filesAt(dir)
  const args = { expectedRevision: before.revision, dataUrl: png, x: 75, y: 90, displayWidth: 320, displayHeight: 180 }
  const preview = await api(`/api/canvas/image?conversation=${id}`, 'POST', { ...args, dryRun: true })
  assert.equal(preview.status, 200)
  assert.equal(preview.body.dryRun, true)
  assert.equal(preview.body.revision, before.revision)
  assert.deepEqual(await workspace.read(id), before)
  assert.deepEqual(await filesAt(dir), files)
  const actual = await api(`/api/canvas/image?conversation=${id}`, 'POST', args)
  assert.equal(actual.status, 200)
  assert.deepEqual(actual.body.bounds, preview.body.bounds)
  assert.equal(actual.body.shapeRecord.type, preview.body.shapeRecord.type)
  assert.equal(actual.body.replacedAiImageHolder, preview.body.replacedAiImageHolder)
  assert.notEqual(actual.body.revision, before.revision)
  assert.deepEqual(await readFile(actual.body.assetPath), Buffer.from(png.split(',')[1], 'base64'))
})

test('网页预演与执行的目标替换结果相同，预演不产生文件或新版本', async t => {
  const { workspace, api } = await fixture(t)
  const { id } = await workspace.open()
  let current = await workspace.read(id)
  const created = await api(`/api/canvas/operations?conversation=${id}`, 'POST', { expectedRevision: current.revision, operations: [{ type: 'create_shape', id: 'shape:holder', shapeType: 'frame', x: 120, y: 230, rotation: 0.2, props: { w: 700, h: 450 }, meta: { cowartAiDraftHolder: true } }] })
  assert.equal(created.status, 200)
  current = await workspace.read(id)
  const dir = await workspace.assetsDir(id), files = await filesAt(dir)
  const args = { expectedRevision: current.revision, draftShapeId: 'shape:holder', htmlContent: '<html><body>预演稿</body></html>' }
  const preview = await api(`/api/canvas/html?conversation=${id}`, 'POST', { ...args, dryRun: true })
  assert.equal(preview.status, 200)
  assert.equal(preview.body.dryRun, true)
  assert.equal(preview.body.revision, current.revision)
  assert.deepEqual(await workspace.read(id), current)
  assert.deepEqual(await filesAt(dir), files)
  const actual = await api(`/api/canvas/html?conversation=${id}`, 'POST', args)
  assert.equal(actual.status, 200)
  for (const field of ['bounds', 'pageId', 'replacedAiDraftHolder', 'replacedAiImageHolder', 'updatedExistingHtmlDraft']) assert.deepEqual(actual.body[field], preview.body[field])
  assert.equal(actual.body.shapeRecord.rotation, preview.body.shapeRecord.rotation)
  assert.equal(actual.body.shapeRecord.meta.cowartHtmlDraftContentHash, preview.body.shapeRecord.meta.cowartHtmlDraftContentHash)
  assert.equal(actual.body.contentHash, actual.body.shapeRecord.meta.cowartHtmlDraftContentHash)
  assert.equal(await readFile(actual.body.assetPath, 'utf8'), args.htmlContent)
})

test('放图中途校验失败不改变画板或版本，本次图片资源零新增', async t => {
  const { workspace, api } = await fixture(t)
  const { id } = await workspace.open()
  const current = await workspace.read(id)
  const created = await api(`/api/canvas/operations?conversation=${id}`, 'POST', { expectedRevision: current.revision, operations: [
    { type: 'create_shape', id: 'shape:holder', shapeType: 'frame', x: 1e308, meta: { cowartAiImageHolder: true } },
    { type: 'create_shape', id: 'shape:annotation', shapeType: 'text', parentId: 'shape:holder', text: '不能丢' },
    { type: 'create_shape', id: 'shape:overflow', shapeType: 'text', parentId: 'shape:holder', x: 1e308, text: '平移后溢出，必须拒绝整批' }
  ] })
  assert.equal(created.status, 200)
  const before = await workspace.read(id), dir = await workspace.assetsDir(id), files = await filesAt(dir)
  const failed = await api(`/api/canvas/image?conversation=${id}`, 'POST', { expectedRevision: before.revision, dataUrl: png, anchorShapeId: 'shape:holder' })
  assert.equal(failed.status, 400)
  assert.deepEqual(await workspace.read(id), before, '占位框删除、标注移动和资源记录应一起撤回')
  const orphans = (await filesAt(dir)).filter(file => !files.includes(file))
  assert.equal(orphans.length, 0, '无效图片在资源写入之前拒绝，不留下本次孤儿文件')
})

test('目标已删返回原 409，参数无效返回原 400，版本冲突与预演均不写文件', async t => {
  const { workspace, api } = await fixture(t)
  const { id } = await workspace.open(), before = await workspace.read(id)
  const dir = await workspace.assetsDir(id)
  for (const [route, content] of [['html', { htmlContent: '<html>合成</html>' }], ['image', { dataUrl: png }]]) {
    const baseArgs = { expectedRevision: before.revision, ...content }
    for (const dryRun of [false, true]) {
      const missing = await api(`/api/canvas/${route}?conversation=${id}`, 'POST', { ...baseArgs, dryRun, draftShapeId: 'shape:deleted' })
      assert.equal(missing.status, 409)
      assert.equal(missing.body.error, '目标框已被删除；结果未插入其他位置。')
      const conflict = await api(`/api/canvas/${route}?conversation=${id}`, 'POST', { ...baseArgs, dryRun, expectedRevision: 'stale' })
      assert.equal(conflict.status, 409)
      assert.equal(conflict.body.storage, 'revision-conflict')
      assert.equal(conflict.body.revision, before.revision)
      const invalid = await api(`/api/canvas/${route}?conversation=${id}`, 'POST', { ...baseArgs, dryRun, displayWidth: 0 })
      assert.equal(invalid.status, 400)
      assert.equal(invalid.body.error, '内容宽高必须有效。')
    }
  }
  assert.deepEqual(await workspace.read(id), before)
  assert.equal((await filesAt(dir)).length, 1, '仅HTML旧分支的实际无效放置请求留一个文件；图片失败、预演、冲突和目标已删不落盘')
})
