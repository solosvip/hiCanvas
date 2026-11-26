import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { describeEmbed, loadEmbedHtml, EMBED_FRAME_ATTRIBUTES } from '../renderer/embed-content.js'
import { getShapeBounds, hitTestCanvas, shapeToPagePoint } from '../renderer/geometry.js'
import { createCanvasStore } from '../model/index.js'
import { createEmbedGallery } from './renderer-preview/embed-gallery.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FrameState } from '../renderer/frame-state.js'

const shape = (meta = {}, props = {}) => ({ id: 'shape:embed', typeName: 'shape', type: 'embed', parentId: 'page:one', index: 'a1', x: 80, y: 100, rotation: .3, opacity: .7, props: { w: 640, h: 360, url: 'https://example.invalid', ...props }, meta })
const data = html => 'data:text/html;charset=utf-8,' + encodeURIComponent(html)

test('识别网页、影片及幻灯片页片，支持历史内联与本机资源；外部URL保持占位', () => {
  const html = '<h1>合成内容</h1>'
  assert.equal(describeEmbed(shape({}, { url: data(html) })).kind, '网页')
  assert.equal(describeEmbed(shape({ cowartFilm: true }, { url: data(html) })).kind, '影片')
  assert.equal(describeEmbed(shape({ cowartAiSlidesParentShapeId: 'shape:slides' }, { url: data(html) })).kind, '幻灯片')
  for (const url of ['/c/synthetic/assets/page.html', 'https://cowart.local/c/synthetic/assets/page.html', '/page-assets/page1/draft.htm']) assert.equal(describeEmbed(shape({ cowartHtmlDraft: true }, { url })).source, new URL(url, 'https://cowart.local').pathname)
  assert.equal(describeEmbed(shape({}, { url: 'https://cowart.local/c/synthetic/assets/page.html?revision=2#page' })).source, '/c/synthetic/assets/page.html?revision=2#page')
  for (const url of ['https://example.invalid/page.html', '/api/settings', '/c/a/assets/%2e%2e/config.html', '/c/a/assets/%2fconfig.html', 'javascript:alert(1)', '//example.invalid/page.html']) assert.equal(describeEmbed(shape({ cowartHtmlDraft: true }, { url })).source, null, url)
  assert.equal(describeEmbed(shape()).kind, '外部嵌入')
  assert.equal(describeEmbed({ ...shape(), type: 'bookmark' }).kind, '书签')
})

test('内联内容保留中文；本机资源只读且不跟随重定向，不向外部站点发请求', async () => {
  const html = '<!doctype html><h1>中文网页</h1>'
  for (const url of [data(html), 'data:text/html;base64,' + Buffer.from(html).toString('base64')]) assert.equal(await loadEmbedHtml(url), html)
  const requests = [], controller = new AbortController()
  const fetcher = async (url, options) => { requests.push({ url, options }); return new Response(html, { headers: { 'content-type': 'text/html' } }) }
  assert.equal(await loadEmbedHtml('/c/synthetic/assets/draft.html', { fetcher, signal: controller.signal }), html)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].options.redirect, 'error')
  assert.equal(requests[0].options.mode, 'same-origin')
  assert.equal(requests[0].options.signal, controller.signal)
  await assert.rejects(loadEmbedHtml('https://example.invalid', { fetcher }), /本机|内容/)
  assert.equal(requests.length, 1)
  await assert.rejects(loadEmbedHtml('/c/synthetic/assets/draft.html', { fetcher: async () => new Response('missing', { status: 404 }) }), /404/)
})

test('历史 data URL 使用浏览器的解码语义，保留裸百分号和百分号编码的 base64', async () => {
  const raw = '<div style="width:100%">中文 50% legacy</div>', html = '<h1>你好 😀</h1>'
  assert.equal(await loadEmbedHtml('data:text/html,' + raw), raw)
  const base64 = Buffer.from(html).toString('base64')
  assert.equal(await loadEmbedHtml('data:text/html;base64,' + encodeURIComponent(base64)), html)
})

test('加载未确认内容宿主前保持opaque默认，实例属性由受控加载器提供', () => {
  assert.deepEqual(EMBED_FRAME_ATTRIBUTES, { sandbox: 'allow-forms allow-popups allow-scripts', referrerPolicy: 'no-referrer', tabIndex: -1, draggable: false, frameBorder: '0' })
  assert.ok(Object.isFrozen(EMBED_FRAME_ATTRIBUTES))
})

test('本机图片去重内联，缺图保留正文，取消请求不继续加载', async () => {
  const image = '/c/synthetic/assets/pixel.png', html = `<h1>正文</h1><img src="${image}"><img src="https://cowart.local${image}">`, requests = []
  const result = await loadEmbedHtml(data(html), { fetcher: async url => { requests.push(url); return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }) } })
  assert.equal(requests.length, 1)
  assert.equal((result.match(/data:image\/png;base64,AQID/g) || []).length, 2)
  assert.equal(await loadEmbedHtml(data(html), { fetcher: async () => new Response('', { status: 404 }) }), html)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(loadEmbedHtml(data(html), { signal: controller.signal }), { name: 'AbortError' })
  await assert.rejects(loadEmbedHtml(data('')), /为空/)
  await assert.rejects(loadEmbedHtml('data:text/html;base64,%%%'), /内容无法解析/)
})

test('嵌入与书签复用记录的尺寸、旋转、透明度和点中查询', () => {
  for (const type of ['embed', 'bookmark']) {
    const record = { ...shape(), type }, snapshot = { store: { 'page:one': { id: 'page:one', typeName: 'page' }, [record.id]: record } }
    assert.deepEqual(getShapeBounds(record), { x: 0, y: 0, w: 640, h: 360 })
    assert.equal(hitTestCanvas(snapshot, shapeToPagePoint(snapshot, record.id, { x: 320, y: 180 })), record.id)
    snapshot.store[record.id] = { ...record, opacity: 0 }
    assert.equal(hitTestCanvas(snapshot, { x: 100, y: 100 }), null)
  }
})

test('合成画廊使用合法记录，包含三种 HTML 内容、外部占位及画框生成状态', () => {
  const fixture = createEmbedGallery(), store = createCanvasStore()
  store.loadStoreSnapshot(fixture.snapshot)
  assert.equal(Object.values(fixture.snapshot.store).filter(record => record.typeName === 'shape').length, fixture.count)
  assert.equal(store.get('shape:embed-slide').parentId, 'shape:embed-slides')
  assert.equal(store.get('shape:embed-slides').meta.cowartAiSlides, true)
  assert.equal(store.get('shape:embed-film').meta.cowartFilm, true)
  assert.equal(store.get('asset:embed-bookmark').props.title, '合成书签')
})

test('画框未知或畸形生成元数据不能使整张画布崩溃，错误只展示文字', () => {
  const render = task => renderToStaticMarkup(createElement(FrameState, { shape: shape({ hicanvasGeneration: task }) }))
  for (const task of [null, {}, 'running', { status: '__proto__' }, { status: 'constructor' }, { status: ['running'] }, { status: { value: 'running' } }]) assert.equal(render(task), '')
  assert.match(render({ status: 'running', error: { message: '不可信对象' } }), /正在生成/)
  assert.match(render({ status: 'failed', error: '合成错误' }), /合成错误/)
})
