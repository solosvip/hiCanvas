import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMediaUploadAttempt } from './renderer-preview/media-upload-attempt.js'
import { createFlattenUpload } from './renderer-preview/flatten-upload.js'

test('准备SVG不申请租约，上传先登记，取消使用独立信号并携带同一凭证', async t => {
  const calls = [], abort = new AbortController()
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, ...options, body })
    return Response.json(body.purpose === 'file-import-begin' ? { importToken: 'synthetic-lease' } : { src: '/synthetic', remaining: 0 })
  })
  const attempt = createMediaUploadAttempt({ metadata: { conversationId: 'synthetic', actor: 'ui:flatten' }, fileCount: 1, signal: abort.signal })
  await attempt.request({ purpose: 'file-import-prepare', dataUrl: 'svg' })
  assert.equal(attempt.hasToken(), false)
  await attempt.request({ purpose: 'file-import', dataUrl: 'prepared' })
  abort.abort(); await attempt.abort()
  assert.deepEqual(calls.map(c => c.body.purpose), ['file-import-prepare', 'file-import-begin', 'file-import', 'file-import-abort'])
  assert.equal(calls[2].body.importToken, 'synthetic-lease')
  assert.equal(calls[3].body.importToken, 'synthetic-lease')
  assert.equal(calls[3].signal.aborted, false)
  assert.equal(calls[3].keepalive, true)
  assert.equal(calls[2].headers['x-hicanvas-actor'], 'ui:flatten')
})

test('租约回执迟到于取消也保留凭证供清理，不发送文件', async t => {
  const signal = new AbortController(), purposes = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body); purposes.push(body.purpose)
    if (body.purpose === 'file-import-begin') { signal.abort(); return Response.json({ importToken: 'late-lease' }) }
    assert.equal(body.importToken, 'late-lease'); return Response.json({ remaining: 0 })
  })
  const attempt = createMediaUploadAttempt({ metadata: { conversationId: 'synthetic' }, fileCount: 1, signal: signal.signal })
  await assert.rejects(attempt.request({ purpose: 'file-import', dataUrl: 'png' }))
  await attempt.abort()
  assert.deepEqual(purposes, ['file-import-begin', 'file-import-abort'])
})

test('扁平化宿主只接受本画板、类型与尺寸一致的静态图片回执', async t => {
  const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222'
  const rendered = { mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]), width: 100, height: 60 }
  let reply = { src: `/c/${id}/assets/synthetic-media-import-flat.png`, mimeType: 'image/png', w: 100, h: 60, isAnimated: false }
  const calls = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body)
    return Response.json(body.purpose === 'file-import-begin' ? { importToken: 'lease' } : reply)
  })
  const port = createFlattenUpload({ metadata: { persistent: true, conversationId: id }, document: {}, host: {}, format: 'png' })
  const good = await port.begin({ signal: new AbortController().signal }).upload(rendered)
  assert.equal(good.src, reply.src)
  for (const patch of [{ src: `/c/${other}/assets/a.png` }, { w: 101 }, { mimeType: 'image/svg+xml' }, { isAnimated: true }, { src: `/c/${id}/assets/%2e%2e/a.png` }, { src: `/c/${id}/assets/a.png?evil` }, { src: `/c/${id}/assets/synthetic.png` }, { src: `/c/${id}/assets/synthetic-media-import-flat.svg` }]) {
    reply = { ...good, ...patch }
    await assert.rejects(port.begin({ signal: new AbortController().signal }).upload(rendered), /回执/)
  }
  assert.ok(calls.filter(row => row.purpose === 'file-import').every(row => row.dataUrl === 'data:image/png;base64,iVBORw=='))
})
