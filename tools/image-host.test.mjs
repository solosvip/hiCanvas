import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMediaUpload } from './renderer-preview/media-upload.js'
import { createCanvasSnapshot } from '../model/index.js'
import { createEditorSession } from '../engine/index.js'
import { memoryTransport } from './renderer-preview/transport.js'
import { rasterFiles, animatedImage } from './renderer-preview/image-fixtures.js'
import { decodeImageUpload } from '../server/image-upload.mjs'
import { decodeVideoUpload } from '../server/video-upload.mjs'
import { createPreviewClipboard } from './renderer-preview/clipboard.js'
import { createCanvasInteraction } from '../engine/index.js'
import { setImmediate as turn } from 'node:timers/promises'

class Reader {
  readAsDataURL(file) { void file.arrayBuffer().then(data => { this.result = `data:${file.type};base64,${Buffer.from(data).toString('base64')}`; this.onload() }) }
  abort() { this.onabort?.() }
}
async function setup(t, mode = '') {
  const reader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader')
  Object.defineProperty(globalThis, 'FileReader', { value: Reader, configurable: true })
  t.after(() => { if (reader) Object.defineProperty(globalThis, 'FileReader', reader); else delete globalThis.FileReader })
  const saved = new Map(), errors = [], requests = [], decodedSources = [], snapshot = createCanvasSnapshot()
  let count = 0, state = { selectedIds: [], camera: { x: 0, y: 0, z: 1 } }, release
  const session = await createEditorSession({ transport: memoryTransport(snapshot), actor: 'image-host' })
  const interaction = { state: { get: () => state } }
  const gate = new Promise(resolve => { release = resolve })
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const args = JSON.parse(options.body); requests.push(args)
    if (mode === 'wait') await gate
    if (mode === '503' && ++count === 2) return Response.json({ error: '合成上传失败' }, { status: 503 })
    const image = args.purpose === 'file-import' ? decodeImageUpload(args.dataUrl) : decodeVideoUpload(args.dataUrl), src = `/c/synthetic/assets/${saved.size}.${image.extension}`
    saved.set(src, image)
    return Response.json({ src, mimeType: image.mimeType, isAnimated: image.isAnimated })
  })
  const doc = { createElement: tag => ({ videoWidth: 320, videoHeight: 180, load() {},
    set src(value) { if (tag === 'video') { queueMicrotask(() => this.onloadedmetadata?.()); return }; decodedSources.push(value); const item = value.startsWith('data:') ? decodeImageUpload(value) : saved.get(value); this.naturalWidth = item.w; this.naturalHeight = item.h; queueMicrotask(() => mode === 'decode-fail' ? this.onerror?.() : this.onload?.()) }, removeAttribute() {},
  }) }
  const upload = createMediaUpload({ session, interaction, document: doc, metadata: { persistent: true, conversationId: 'synthetic', viewState: { currentPageId: Object.values(snapshot.store).find(r => r.typeName === 'page').id } }, onError: error => errors.push(error.message) })
  const samples = { ...rasterFiles, gif: { base64: animatedImage.split(',')[1], name: 'animated.gif', mimeType: 'image/gif' } }
  const files = keys => keys.map(key => new File([Buffer.from(samples[key].base64, 'base64')], samples[key].name, { type: samples[key].mimeType }))
  t.after(() => { release(); upload.dispose(); session.dispose() })
  return { upload, errors, requests, decodedSources, saved, files, session, release, select: () => { state = { ...state, selectedIds: ['shape:changed'] } }, shapes: () => session.store.allRecords().filter(r => r.typeName === 'shape') }
}
test('宿主上传六格式实际字节，专用用途，元数据交公共事务；过滤SVG后剩余一次提交', async t => {
  const f = await setup(t)
  const svg = new File(['<svg/>'], 'unsupported.svg', { type: 'image/svg+xml' })
  assert.equal(await f.upload.importFiles([...f.files(['png', 'portrait', 'avif', 'apng', 'jpeg', 'webp', 'gif']), svg], { x: 550, y: 420 }), true)
  assert.equal(f.shapes().length, 7)
  assert.equal(f.requests.length, 7)
  assert.equal(f.decodedSources.length, 7)
  assert.ok(f.decodedSources.every(src => src.startsWith('data:image/')))
  assert.ok(f.shapes().every(shape => f.saved.has(f.session.store.get(shape.props.assetId).props.src)))
  assert.ok(f.requests.every(request => request.purpose === 'file-import'))
  assert.match(f.errors[0], /SVG.*过滤/)
  await f.session.undo(); assert.equal(f.shapes().length, 0)
})
for (const mode of ['503', 'decode-fail']) test(`支持项${mode}导致整批不落形状`, async t => {
  const f = await setup(t, mode)
  assert.equal(await f.upload.importFiles(f.files(['png', 'portrait']), { x: 550, y: 420 }), false)
  assert.equal(f.shapes().length, 0)
  assert.equal(f.session.state.get().revision, '0')
  assert.match(f.errors[0], mode === '503' ? /上传失败/ : /损坏/)
  if (mode === 'decode-fail') { assert.equal(f.requests.length, 0); assert.equal(f.saved.size, 0) }
})
for (const action of ['dispose', 'selection']) test(`异步上传期间${action}不提交、不碰已销毁视图`, async t => {
  const f = await setup(t, 'wait'), promise = f.upload.importFiles(f.files(['png']), { x: 0, y: 0 })
  if (action === 'dispose') f.upload.dispose(); else f.select()
  f.release(); assert.equal(await promise, false)
  assert.equal(f.shapes().length, 0)
  if (action === 'dispose') assert.equal(f.errors.length, 0)
  else assert.match(f.errors[0], /选择已变化/)
})
test('超出单批数量在任何上传前拒绝，伪装SVG不是栅格文件', async t => {
  const f = await setup(t), files = Array.from({ length: 101 }, () => f.files(['png'])[0])
  assert.equal(await f.upload.importFiles(files, { x: 0, y: 0 }), false)
  assert.equal(f.requests.length, 0); assert.match(f.errors[0], /100/)
  const disguised = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'fake.png', { type: 'image/png' })
  assert.equal(await f.upload.importFiles([disguised], { x: 0, y: 0 }), false)
  assert.equal(f.requests.length, 0); assert.equal(f.shapes().length, 0); assert.match(f.errors[1], /损坏|格式/)
})
test('共用文件宿主一批接图片和WebM，不丢视频类型；一次撤销', async t => {
  const f = await setup(t), webm = new File([Buffer.from('1a45dfa380', 'hex')], 'synthetic.webm', { type: 'video/webm' })
  assert.equal(await f.upload.importFiles([...f.files(['png']), webm], { x: 550, y: 420 }), true)
  assert.deepEqual(f.shapes().map(s => s.type), ['image', 'video'])
  assert.equal(f.session.store.get(f.shapes()[1].props.assetId).props.mimeType, 'video/webm')
  await f.session.undo(); assert.equal(f.shapes().length, 0)
})
test('公开剪贴板适配器：文件与HTML共存只调用一次文件回调，表单/组字/忙状态不拦粘贴', async t => {
  const snapshot = createCanvasSnapshot(), session = await createEditorSession({ transport: memoryTransport(snapshot), actor: 'file-paste' })
  const document = new EventTarget(); document.defaultView = {}
  const host = { ownerDocument: document }, adapter = createPreviewClipboard({ host, transport: {}, sandbox: true })
  const interaction = createCanvasInteraction({ session, clipboard: adapter.port, viewport: { w: 1280, h: 800 } })
  const calls = [], detach = adapter.attach(interaction, { onFiles: (files, point) => { calls.push({ files, point }) } })
  t.after(() => { detach(); interaction.dispose(); session.dispose() })
  const file = new File(['synthetic'], 'synthetic.png', { type: 'image/png' })
  function paste() {
    const event = new Event('paste', { cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files: [file], types: ['Files', 'text/html'], getData: () => '<p>不得创建这段HTML</p>' } })
    document.dispatchEvent(event); return event
  }
  assert.equal(paste().defaultPrevented, true); await turn()
  assert.equal(calls.length, 1); assert.equal(calls[0].files[0], file); assert.deepEqual(calls[0].point, { x: 640, y: 400 })
  assert.equal(adapter.inspect().reads, 0)
  interaction.dispatch({ type: 'pointer_move', time: 1, point: { x: 900, y: 610 } })
  await interaction.runAction('paste-at-cursor')
  assert.equal(paste().defaultPrevented, true); await turn()
  assert.deepEqual(calls[1].point, { x: 900, y: 610 })
  for (const context of [{ owner: 'form' }, { owner: 'canvas', isComposing: true }]) {
    interaction.setInputContext(context); assert.equal(paste().defaultPrevented, false); await turn()
  }
  interaction.setInputContext({ owner: 'canvas' }); session.beginGesture()
  assert.equal(paste().defaultPrevented, false); session.cancelGesture()
  assert.equal(calls.length, 2); assert.equal(adapter.inspect().reads, 0)
})
