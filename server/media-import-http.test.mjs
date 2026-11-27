import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readdir, chmod, readFile } from 'node:fs/promises'
import { fixture } from './test-helpers.mjs'
import { rasterFiles } from '../tools/renderer-preview/image-fixtures.js'
import { svgAttacks } from '../tools/renderer-preview/svg-fixtures.js'

const png = `data:image/png;base64,${rasterFiles.png.base64}`
test('真实HTTP：上传落盘但调用方丢掉回执，凭证取消仍清掉文件；旧素材/并发成功资源仍可读', async t => {
  const { workspace, api, base } = await fixture(t), { id } = await workspace.open(), path = `/api/canvas/reference?conversation=${id}`
  const call = (body, actor = 'ui:A', headers = {}) => api(path, 'POST', body, { 'x-hicanvas-actor': actor, ...headers })
  const before = await workspace.read(id), old = await call({ purpose: 'file-import', dataUrl: png })
  const start = await call({ purpose: 'file-import-begin' }), importToken = start.body.importToken
  assert.equal(start.status, 200)
  const saved = await call({ purpose: 'file-import', dataUrl: png, importToken })
  assert.equal(saved.status, 200); assert.match(saved.body.src, /-media-import-/)
  assert.equal((await fetch(base + saved.body.src)).status, 200)
  for (const headers of [{ origin: 'https://synthetic.invalid' }, { 'x-hicanvas-client': '0' }]) assert.equal((await call({ purpose: 'file-import-abort', importToken }, 'ui:A', headers)).status, 403)
  assert.equal((await call({ purpose: 'file-import-abort', importToken }, 'ui:B')).status, 403)
  const canceled = await call({ purpose: 'file-import-abort', importToken })
  assert.equal(canceled.status, 200); assert.equal(canceled.body.remaining, 0)
  assert.equal((await fetch(base + saved.body.src)).status, 404)
  assert.equal((await fetch(base + old.body.src)).status, 200)
  assert.deepEqual(await workspace.read(id), before)
  assert.equal((await call({ purpose: 'file-import', importToken, dataUrl: png })).status, 403)
})
test('SVG准备始终零落盘，最终带凭证仍净化，取消不会留下脚本资产', async t => {
  const { workspace, api } = await fixture(t), { id } = await workspace.open(), path = `/api/canvas/reference?conversation=${id}`
  const call = body => api(path, 'POST', body, { 'x-hicanvas-actor': 'ui:A' })
  const prepared = await call({ purpose: 'file-import-prepare', dataUrl: `data:image/svg+xml;base64,${Buffer.from(svgAttacks[0].source).toString('base64')}` })
  assert.equal(prepared.status, 200)
  assert.deepEqual(await readdir(await workspace.assetsDir(id)).catch(() => []), [])
  const { body: { importToken } } = await call({ purpose: 'file-import-begin' })
  const saved = await call({ purpose: 'file-import', importToken, dataUrl: prepared.body.dataUrl })
  assert.equal(saved.status, 200); assert.doesNotMatch(await readFile(saved.body.assetPath, 'utf8'), /<script/)
  await call({ purpose: 'file-import-abort', importToken })
  await assert.rejects(access(saved.body.assetPath), { code: 'ENOENT' })
})
test('真实清理EACCES返回有界状态，不扩大删除范围，权限恢复后同清单重试', async t => {
  const { workspace, api } = await fixture(t), { id } = await workspace.open(), path = `/api/canvas/reference?conversation=${id}`
  const call = body => api(path, 'POST', body, { 'x-hicanvas-actor': 'ui:A' })
  const { body: { importToken } } = await call({ purpose: 'file-import-begin' })
  const created = await call({ purpose: 'file-import', importToken, dataUrl: png }), dir = await workspace.assetsDir(id)
  await chmod(dir, 0o500)
  let result
  try { result = await call({ purpose: 'file-import-abort', importToken }) } finally { await chmod(dir, 0o700) }
  assert.equal(result.status, 200); assert.equal(result.body.remaining, 1); assert.equal(result.body.cleanupFailed, 1)
  assert.equal((await call({ purpose: 'file-import-abort', importToken })).body.remaining, 0)
  await assert.rejects(access(created.body.assetPath), { code: 'ENOENT' })
})
