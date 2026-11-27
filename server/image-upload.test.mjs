import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { decodeImageUpload } from './image-upload.mjs'
import { decodeReference } from './image-provider.mjs'
import { rasterFiles, animatedImage } from '../tools/renderer-preview/image-fixtures.js'
import { fixture } from './test-helpers.mjs'

const files = { ...rasterFiles, gif: { name: 'animation.gif', mimeType: 'image/gif', base64: animatedImage.split(',')[1] } }
const data = file => `data:${file.mimeType};base64,${file.base64}`
test('六种真实栅格容器按字节识别，动画标志和像素上限独立于生成参考图', () => {
  for (const type of ['png', 'jpeg', 'webp', 'gif', 'apng', 'avif']) {
    const file = files[type], result = decodeImageUpload(data(file))
    assert.equal(result.mimeType, file.mimeType, type)
    assert.deepEqual([result.w, result.h], type === 'gif' ? [2, 2] : [320, 180], type)
    assert.equal(result.isAnimated, ['gif', 'apng'].includes(type), type)
    assert.deepEqual(result.bytes, Buffer.from(file.base64, 'base64'))
  }
  assert.equal(decodeImageUpload(data({ ...files.apng, mimeType: 'image/png' })).mimeType, 'image/apng')
  for (const type of ['gif', 'apng', 'avif']) assert.throws(() => decodeReference(data(files[type])))
})
test('显式导入用途才接六格式；资源响应MIME正确、不改画板版本', async t => {
  const { workspace, api, base } = await fixture(t), { id } = await workspace.open(), before = await workspace.read(id)
  for (const type of ['png', 'jpeg', 'webp', 'gif', 'apng', 'avif']) {
    const file = files[type]
    const result = await api(`/api/canvas/reference?conversation=${id}`, 'POST', { purpose: 'file-import', dataUrl: data(file) })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.mimeType, file.mimeType)
    assert.deepEqual(await readFile(result.body.assetPath), Buffer.from(file.base64, 'base64'))
    const response = await fetch(base + result.body.src)
    assert.equal(response.headers.get('content-type'), file.mimeType)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.status, 200)
  }
  assert.equal((await api(`/api/canvas/reference?conversation=${id}`, 'POST', { dataUrl: data(files.gif) })).status, 400)
  assert.deepEqual(await workspace.read(id), before)
})
const trailing = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex')
for (const type of ['jpeg', 'png', 'gif']) test(`${type}结束标记后的附加数据不影响导入，保存原始字节`, async t => {
  const { workspace, api } = await fixture(t), { id } = await workspace.open()
  const bytes = Buffer.concat([Buffer.from(files[type].base64, 'base64'), trailing])
  const dataUrl = data({ ...files[type], base64: bytes.toString('base64') })
  const decoded = decodeImageUpload(dataUrl)
  assert.deepEqual([decoded.w, decoded.h], type === 'gif' ? [2, 2] : [320, 180])
  assert.deepEqual(decoded.bytes, bytes)
  const result = await api(`/api/canvas/reference?conversation=${id}`, 'POST', { purpose: 'file-import', dataUrl })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.deepEqual(await readFile(result.body.assetPath), bytes)
})
test('单独的尾随数据或结束标记没有合法图片结构，WebP仍严格核对RIFF长度', () => {
  for (const type of ['jpeg', 'png', 'gif']) {
    const ending = Buffer.from(files[type].base64, 'base64').subarray(type === 'png' ? -12 : type === 'jpeg' ? -2 : -1)
    for (const bytes of [trailing, Buffer.concat([ending, trailing])]) assert.throws(() => decodeImageUpload(data({ ...files[type], base64: bytes.toString('base64') })))
  }
  const bytes = Buffer.concat([Buffer.from(files.webp.base64, 'base64'), trailing])
  assert.throws(() => decodeImageUpload(data({ ...files.webp, base64: bytes.toString('base64') })))
})
test('损坏、截断、伪装、SVG、超限和非法用途失败不保存文件', async t => {
  const { workspace, api } = await fixture(t), { id } = await workspace.open()
  const bad = [data({ ...files.png, mimeType: 'image/jpeg' }), 'data:image/png;base64,@@@@', 'data:image/svg+xml;base64,PHN2Zy8+',
    ...['png', 'jpeg', 'webp', 'gif', 'apng', 'avif'].map(type => data({ ...files[type], base64: Buffer.from(files[type].base64, 'base64').subarray(0, 25).toString('base64') }))]
  for (const dataUrl of bad) assert.equal((await api(`/api/canvas/reference?conversation=${id}`, 'POST', { purpose: 'file-import', dataUrl })).status, 400, dataUrl.slice(0, 50))
  assert.equal((await api(`/api/canvas/reference?conversation=${id}`, 'POST', { purpose: 'anything', dataUrl: data(files.png) })).status, 400)
  assert.deepEqual(await readdir(await workspace.assetsDir(id)).catch(() => []), [])
  const huge = Buffer.from(files.png.base64, 'base64'); huge.writeUInt32BE(20000, 16)
  assert.throws(() => decodeImageUpload(data({ ...files.png, base64: huge.toString('base64') })))
  assert.throws(() => decodeImageUpload(`data:image/png;base64,${Buffer.alloc(20 * 1024 * 1024 + 1).toString('base64')}`), /20 MB/)
})
