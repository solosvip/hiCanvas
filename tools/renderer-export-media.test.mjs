import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasSnapshot } from '../model/index.js'
import { executeCanvasCommands } from '../engine/index.js'
import { renderCanvasExport } from '../renderer/index.js'
import { rasterFiles, animatedImage } from './renderer-preview/image-fixtures.js'
import { createExternalExportFixture } from './renderer-preview/export-fixture.js'

test('外链图片不请求或分配，输出占位和一条提示且固定快照不变', async () => {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', shapeType: 'image', id: 'shape:img' }]).snapshot
  snapshot.store['shape:img'].props.assetId = 'asset:external'
  snapshot.store['asset:external'] = { id: 'asset:external', typeName: 'asset', type: 'image', props: { src: 'https://example.invalid/private.png' } }
  const before = structuredClone(snapshot)
  let requested = false
  const result = await renderCanvasExport(snapshot, { format: 'svg', readAsset: () => { requested = true; throw new Error('不应读取') } })
  assert.equal(result.status, 'complete'); assert.equal(result.blockedResources, 1); assert.equal(result.failedResources, 0)
  assert.equal(result.warnings.length, 1); assert.match(result.warnings[0], /外部图片.*占位/)
  const xml = new TextDecoder().decode(result.bytes)
  assert.match(xml, /data:image\/svg\+xml/); assert.doesNotMatch(xml, /example\.invalid/)
  assert.equal(requested, false); assert.deepEqual(snapshot, before)
})

test('外网、其他本机端口和内网地址一律只占位，不借导出读取', async () => {
  const snapshot = createExternalExportFixture()
  let calls = 0
  for (const src of ['https://export-observation.example.invalid/image.png', 'http://127.0.0.1:9/private', 'http://[::1]:9/private', 'http://169.254.169.254/latest/meta-data/', '//export-observation.example.invalid/image.png', 'ftp://synthetic.invalid/image.png', 'file:///synthetic-private.png', 'https://cowart.local@synthetic.invalid/image.png', 'http://cowart.local/api/health']) {
    snapshot.store['asset:external-image'].props.src = src
    const result = await renderCanvasExport(snapshot, { format: 'svg', ids: ['shape:external-image'], readAsset() { calls++; throw new Error('禁止读取') } })
    assert.equal(result.status, 'complete'); assert.equal(result.blockedResources, 1); assert.equal(result.warnings.length, 1)
  }
  assert.equal(calls, 0)
})

test('书签外链预览和图标在交给内容宿主前均换成占位', async () => {
  const snapshot = createExternalExportFixture(), before = structuredClone(snapshot)
  const previousFetch = globalThis.fetch, previousLocation = globalThis.location
  let registered, assetCalls = 0, externalCalls = 0
  globalThis.location = { origin: 'http://127.0.0.1:43300', search: '' }
  try {
    globalThis.fetch = async (url, init = {}) => {
      if (url.startsWith('data:')) return previousFetch(url, init)
      if (url === '/api/health') return Response.json({ contentHost: { port: 12345 } })
      if (url !== '/api/content-host/instances') { externalCalls++; throw new Error('禁止外部请求') }
      if (init.method === 'POST') {
        registered = JSON.parse(init.body).html
        return Response.json({ id: 'a'.repeat(48), url: `http://${'a'.repeat(48)}.localhost:12345/document.html`, revokeToken: 'b'.repeat(48), leaseMs: 1800000 })
      }
      return Response.json({ ok: true })
    }
    const document = { defaultView: { getComputedStyle: () => ({ getPropertyValue: () => '' }) }, createElement() { throw new Error('Synthetic iframe boundary reached') } }
    await assert.rejects(renderCanvasExport(snapshot, { format: 'svg', ids: ['shape:external-card'], document, readAsset() { assetCalls++; throw new Error('禁止素材请求') } }), error => /iframe boundary/.test(error.message) && error.blockedResources === 2)
    assert.equal((registered.match(/<img[^>]+src="data:image\/svg\+xml,/g) || []).length, 2)
    assert.doesNotMatch(registered, /export-observation\.example\.invalid/)
    assert.equal(assetCalls, 0); assert.equal(externalCalls, 0); assert.deepEqual(snapshot, before)
  } finally { globalThis.fetch = previousFetch; globalThis.location = previousLocation }
})

test('字体等待中超时或取消不返回半文件，失败后下一次输出可正常完成', async () => {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', id: 'shape:t', shapeType: 'text', text: 'Hello 中文' }]).snapshot
  const before = structuredClone(snapshot), never = () => new Promise(() => {})
  await assert.rejects(renderCanvasExport(snapshot, { format: 'svg', timeout: 10, readAsset: never }), /期限/)
  const controller = new AbortController()
  const pending = renderCanvasExport(snapshot, { format: 'svg', signal: controller.signal, readAsset: never })
  controller.abort(new Error('Synthetic cancellation'))
  await assert.rejects(pending, /cancellation/)
  assert.deepEqual(snapshot, before)
  await assert.rejects(renderCanvasExport(snapshot, { format: 'svg', readAsset: async () => ({ type: 'font/woff2', bytes: new Uint8Array() }) }), error => /数据无效/.test(error.message) && error.failedResources === 1)
})

test('超大PNG头在创建任何浏览器节点前拒绝，超长响应立即取消body', async () => {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', shapeType: 'image', id: 'shape:img' }]).snapshot
  snapshot.store['shape:img'].props.assetId = 'asset:img'
  snapshot.store['asset:img'] = { id: 'asset:img', typeName: 'asset', type: 'image', props: { src: 'data:image/png;base64,iVBORw0KGgo=' } }
  const header = new Uint8Array(24), view = new DataView(header.buffer)
  header.set([137,80,78,71,13,10,26,10]); header.set([73,72,68,82],12); view.setUint32(16,100000);view.setUint32(20,100000)
  let allocations = 0
  await assert.rejects(renderCanvasExport(snapshot, { format: 'svg', document: { createElement() { allocations++ } }, readAsset: async () => ({ type: 'image/png', bytes: header }) }), /上限/)
  assert.equal(allocations, 0)
  const previous = globalThis.fetch
  let cancelled = false
  try {
    globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'content-type': 'image/png', 'content-length': '64000001' } })
    await assert.rejects(renderCanvasExport(snapshot, { format: 'svg' }), /64MB/)
    assert.equal(cancelled, true)
  } finally { globalThis.fetch = previous }
})

test('已挂载视频等待画面期间换源或卸载必须失败，保持同一实例才输出', async () => {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', shapeType: 'video', id: 'shape:video' }]).snapshot
  snapshot.store['shape:video'].props.assetId = 'asset:video'
  snapshot.store['asset:video'] = { id: 'asset:video', typeName: 'asset', type: 'video', props: { src: '/assets/original.mp4' } }
  for (const change of ['source', 'disconnect', 'none']) {
    let src = '/assets/original.mp4', draws = 0
    const video = Object.assign(new EventTarget(), { isConnected: true, readyState: 1, videoWidth: 320, videoHeight: 180, currentTime: .5, paused: true,
      getAttribute: () => src, closest: () => ({ dataset: { shapeId: 'shape:video' } }) })
    const document = { createElement: () => ({ getContext: () => ({ drawImage() { draws++ } }), toDataURL: () => 'data:image/png;base64,AA==' }) }
    const task = renderCanvasExport(snapshot, { format: 'svg', host: { querySelectorAll: () => [video] }, document })
    if (change === 'source') src = '/assets/replacement.mp4'
    if (change === 'disconnect') video.isConnected = false
    video.readyState = 2; video.dispatchEvent(new Event('loadeddata'))
    if (change === 'none') { assert.equal((await task).status, 'complete'); assert.equal(draws, 1) }
    else { await assert.rejects(task, error => /更换/.test(error.message) && error.failedResources === 1); assert.equal(draws, 0) }
    assert.equal(video.currentTime, .5); assert.equal(video.paused, true)
  }
})

test('内容实例的释放请求或响应体卡住也有期限，原始输出失败仍可见', async () => {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', shapeType: 'embed', id: 'shape:page', props: { url: 'data:text/html,synthetic' }, meta: { cowartHtmlDraft: true } }]).snapshot
  const previousFetch = globalThis.fetch, previousLocation = globalThis.location
  globalThis.location = { origin: 'http://127.0.0.1:43300', search: '' }
  try {
    for (const stuck of ['headers', 'body']) {
      let releaseSignal, aborted = false, timer
      globalThis.fetch = async (url, init = {}) => {
        if (url.startsWith('data:')) return new Response('synthetic')
        if (url === '/api/health') return Response.json({ contentHost: { port: 12345 } })
        if (init.method === 'POST') return Response.json({ id: 'a'.repeat(48), url: `http://${'a'.repeat(48)}.localhost:12345/document.html`, revokeToken: 'b'.repeat(48), leaseMs: 1800000 })
        assert.equal(init.method, 'DELETE'); releaseSignal = init.signal
        releaseSignal.addEventListener('abort', () => { aborted = true }, { once: true })
        if (stuck === 'headers') return new Promise(() => {})
        return { ok: true, json: () => new Promise(() => {}) }
      }
      const start = performance.now()
      try {
        const task = renderCanvasExport(snapshot, { format: 'svg', document: { createElement() { throw new Error('Synthetic iframe setup failure') } } })
        await assert.rejects(Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cleanup leaked')), 3500) })]), /iframe setup failure/)
        assert.ok(releaseSignal instanceof AbortSignal); assert.equal(aborted, true)
        assert.ok(performance.now() - start < 3000)
      } finally { clearTimeout(timer) }
    }
  } finally { globalThis.fetch = previousFetch; globalThis.location = previousLocation }
})

test('正常PNG/JPEG/WebP/GIF/APNG/AVIF均可通过解码前的尺寸预检', async () => {
  const snapshot = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', shapeType: 'image', id: 'shape:img' }]).snapshot
  snapshot.store['shape:img'].props.assetId = 'asset:img'
  const files = { ...rasterFiles, gif: { mimeType: 'image/gif', base64: animatedImage.split(',')[1] } }
  for (const type of ['png', 'jpeg', 'webp', 'gif', 'apng', 'avif']) {
    const file = files[type]
    snapshot.store['asset:img'] = { id: 'asset:img', typeName: 'asset', type: 'image', props: { src: `data:${file.mimeType};base64,${file.base64}` } }
    let decodes = 0
    const document = { createElement: tag => tag === 'img'
      ? { naturalWidth: 320, naturalHeight: 180, async decode() { decodes++ }, removeAttribute() {} }
      : { getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/png;base64,AA==' } }
    const result = await renderCanvasExport(snapshot, { document, format: 'svg' })
    assert.equal(result.status, 'complete', type); assert.equal(decodes, 1, type)
  }
})
