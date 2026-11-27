import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fixture } from './test-helpers.mjs'
import { svgPositive, svgAttacks, svg } from '../tools/renderer-preview/svg-fixtures.js'
import { sanitizeSvg } from './svg-sanitize.mjs'
import { rasterFiles } from '../tools/renderer-preview/image-fixtures.js'

const data = source => `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`
test('SVG准备只返回规范字节：成功、坏XML和伪装输入都不建素材、不改快照历史', async t => {
  const { workspace, api } = await fixture(t), { id } = await workspace.open(), before = await workspace.read(id)
  const path = `/api/canvas/reference?conversation=${id}`
  const result = await api(path, 'POST', { purpose: 'file-import-prepare', dataUrl: data(svgAttacks[0].source) })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.dataUrl, data(sanitizeSvg(svgAttacks[0].source).bytes))
  assert.equal(result.body.src, undefined); assert.equal(result.body.assetPath, undefined)
  assert.equal(result.body.mimeType, 'image/svg+xml'); assert.equal(result.body.isAnimated, false)
  assert.ok(result.body.warnings.length)
  for (const input of [data('<svg/>'), data('<svg'), 'https://svg-test.invalid/a', '/synthetic/canary', `data:image/png;base64,${rasterFiles.png.base64}`, data(Buffer.from(rasterFiles.png.base64, 'base64'))]) {
    assert.equal((await api(path, 'POST', { purpose: 'file-import-prepare', dataUrl: input })).status, 400)
  }
  assert.deepEqual(await readdir(await workspace.assetsDir(id)).catch(() => []), [])
  assert.deepEqual(await workspace.read(id), before)
})
test('最终上传重新净化，不信准备标记；保存规范SVG仍有既有响应隔离', async t => {
  const { workspace, api, base } = await fixture(t), { id } = await workspace.open(), before = await workspace.read(id)
  const path = `/api/canvas/reference?conversation=${id}`, source = svgAttacks[0].source
  const result = await api(path, 'POST', { purpose: 'file-import', dataUrl: data(source), sanitized: true, prepared: true })
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.mimeType, 'image/svg+xml')
  assert.deepEqual(await readFile(result.body.assetPath), sanitizeSvg(source).bytes)
  assert.match(result.body.src, /\.svg$/); assert.ok(result.body.warnings.length)
  const response = await fetch(base + result.body.src)
  assert.equal(response.headers.get('content-type'), 'image/svg+xml')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.match(response.headers.get('content-security-policy'), /sandbox/)
  assert.doesNotMatch(response.headers.get('content-security-policy'), /allow-same-origin/)
  assert.doesNotMatch(await response.text(), /<script|onload=/)
  for (const input of [data('<svg/>'), data(svg('<use href="#missing"/>')), data(svg('<image href="data:image/svg+xml;base64,PHN2Zy8+"/>'))]) assert.equal((await api(path, 'POST', { purpose: 'file-import', dataUrl: input })).status, 400)
  assert.equal((await readdir(await workspace.assetsDir(id))).length, 1)
  assert.deepEqual(await workspace.read(id), before)
})
test('SVG两用途沿用来源、客户端及画板存在校验；生成参考图仍拒绝SVG', async t => {
  const { workspace, api } = await fixture(t), { id } = await workspace.open(), path = `/api/canvas/reference?conversation=${id}`
  for (const purpose of ['file-import-prepare', 'file-import']) {
    for (const headers of [{ origin: 'https://svg-test.invalid' }, { 'x-hicanvas-client': '0' }]) assert.equal((await api(path, 'POST', { purpose, dataUrl: data(svgPositive) }, headers)).status, 403, JSON.stringify(headers))
    assert.equal((await api('/api/canvas/reference?conversation=00000000-0000-0000-0000-000000000000', 'POST', { purpose, dataUrl: data(svgPositive) })).status, 404)
  }
  assert.equal((await api(path, 'POST', { dataUrl: data(svgPositive) })).status, 400)
  assert.deepEqual(await readdir(await workspace.assetsDir(id)).catch(() => []), [])
})
test('密集CSS经过准备后最终上传仍成功，不因规范输出扩张出现两阶段分歧', async t => {
  const { workspace, api } = await fixture(t), { id } = await workspace.open(), path = `/api/canvas/reference?conversation=${id}`
  const source = svg('<rect/><style>rect{' + 'fill:r;'.repeat(8000) + '}</style>')
  const prepared = await api(path, 'POST', { purpose: 'file-import-prepare', dataUrl: data(source) })
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body))
  assert.deepEqual(await readdir(await workspace.assetsDir(id)).catch(() => []), [])
  const saved = await api(path, 'POST', { purpose: 'file-import', dataUrl: prepared.body.dataUrl })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  assert.deepEqual(await readFile(saved.body.assetPath), Buffer.from(prepared.body.dataUrl.split(',')[1], 'base64'))
})
