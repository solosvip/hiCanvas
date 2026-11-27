import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fixture } from './test-helpers.mjs'
import { decodeVideoUpload, maxVideoBytes } from './video-upload.mjs'

const data = (mime, bytes) => `data:${mime};base64,${bytes.toString('base64')}`
const mp4 = Buffer.from('000000186674797069736f6d0000020069736f6d6d703432', 'hex')
const mov = Buffer.from('0000001466747970717420200000000071742020', 'hex')
const webm = Buffer.from('1a45dfa380', 'hex')
test('视频上传独立保存资源：类型来自文件头，快照与版本不变，图片入口照常工作', async t => {
  const { workspace, api, base } = await fixture(t), { id } = await workspace.open()
  const before = await workspace.read(id)
  for (const [mime, bytes, extension] of [['video/mp4', mp4, 'mp4'], ['video/quicktime', mov, 'mov'], ['video/webm', webm, 'webm']]) {
    const result = await api(`/api/canvas/reference?conversation=${id}`, 'POST', { dataUrl: data(mime, bytes), fileName: '../../other.mp4' })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.match(result.body.src, new RegExp(`^/c/${id}/assets/[^/]+\\.${extension}$`))
    assert.equal(result.body.mimeType, mime)
    assert.deepEqual(await readFile(result.body.assetPath), bytes)
    const response = await fetch(base + result.body.src)
    assert.equal(response.headers.get('content-type'), mime)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
    const head = await fetch(base + result.body.src, { method: 'HEAD' })
    assert.equal((await head.arrayBuffer()).byteLength, 0)
    for (const [range, expected] of [['bytes=2-5', bytes.subarray(2, 6)], ['bytes=-3', bytes.subarray(-3)], ['bytes=3-', bytes.subarray(3)]]) {
      const partial = await fetch(base + result.body.src, { headers: { range } })
      assert.equal(partial.status, 206)
      assert.equal(partial.headers.get('accept-ranges'), 'bytes')
      assert.deepEqual(Buffer.from(await partial.arrayBuffer()), expected)
    }
    for (const range of ['bytes=1000-', 'bytes=4-2', 'bytes=-0', 'bytes=1-2,3-4', 'bytes=a-b']) {
      const invalid = await fetch(base + result.body.src, { headers: { range } })
      assert.equal(invalid.status, 416)
      assert.equal(invalid.headers.get('content-range'), `bytes */${bytes.length}`)
      assert.equal((await invalid.arrayBuffer()).byteLength, 0)
    }
    const partialHead = await fetch(base + result.body.src, { method: 'HEAD', headers: { range: 'bytes=0-1' } })
    assert.equal(partialHead.status, 206); assert.equal((await partialHead.arrayBuffer()).byteLength, 0)
  }
  assert.deepEqual(await workspace.read(id), before)
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  assert.equal((await api(`/api/canvas/reference?conversation=${id}`, 'POST', { dataUrl: png })).body.mimeType, 'image/png')
})
test('拒绝伪装视频、畸形数据和超限文件，失败不保存文件', async t => {
  const { workspace, api } = await fixture(t), { id } = await workspace.open()
  for (const dataUrl of [data('video/mp4', webm), data('video/webm', mp4), data('video/quicktime', mp4), data('video/avi', mp4), 'data:video/mp4;base64,@@@@']) {
    assert.equal((await api(`/api/canvas/reference?conversation=${id}`, 'POST', { dataUrl })).status, 400)
  }
  assert.deepEqual(await readdir(await workspace.assetsDir(id)).catch(() => []), [])
  assert.throws(() => decodeVideoUpload(data('video/mp4', Buffer.alloc(maxVideoBytes + 1))), /37 MB/)
})
