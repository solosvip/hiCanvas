import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { atom } from '@tldraw/state'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShapeLinks, checkedShapeLinks, createShapeLinkState } from '../renderer/shape-links.js'

const item = (patch = {}) => ({ id: 'shape:one', url: 'https://example.invalid/links', origin: { x: 100, y: 150 }, rotation: Math.PI / 4,
  bounds: { x: 0, y: 0, w: 200, h: 120 }, opacity: .5, selected: false, clips: [], ...patch })
const render = (items, camera = { x: 10, y: 20, z: .5 }) => renderToStaticMarkup(createElement(ShapeLinks, { camera: atom('test camera', camera), links: atom('test links', { items: checkedShapeLinks(items), hitSize: 44 }) }))

test('没有链接的画板不产生额外 DOM，避免相机改变时重写空覆盖层', () => {
  assert.equal(render([]), '')
})

test('链接层可访问且原生打开受限，跟随文档坐标/相机旋转，视觉全部引用令牌', () => {
  const html = render([item()])
  assert.match(html, /aria-label="形状链接"/); assert.match(html, /aria-label="打开链接"/)
  assert.doesNotMatch(html, /aria-hidden="true"[^>]*>[^<]*<a/)
  assert.match(html, /href="https:\/\/example.invalid\/links"/)
  assert.match(html, /target="_blank"/); assert.match(html, /rel="noopener noreferrer"/)
  assert.match(html, /scale\(0.5\) translate3d\(10px,20px,0\)/)
  assert.match(html, /translate3d\(100px,150px,0\) rotate\(0.7853981633974483rad\)/)
  assert.match(html, /var\(--spacing-shape-link-hit\)/); assert.match(html, /opacity:0.5/)
})

test('非法 href、畸形几何、重复身份不进入可聚焦树', () => {
  for (const patch of [{ url: 'javascript:void(0)' }, { url: '//example.invalid' }, { url: 'https://u:p@example.invalid' }, { rotation: NaN }, { opacity: 2 }, { bounds: { x: 0, y: 0, w: -1, h: 100 } }, { clips: [[{ x: Infinity, y: 0 }]] }]) assert.throws(() => checkedShapeLinks([item(patch)]))
  assert.throws(() => checkedShapeLinks([item(), item()]))
  const input = [item()], result = checkedShapeLinks(input)
  input[0].origin.x = 999; assert.equal(result[0].origin.x, 100); assert.ok(Object.isFrozen(result[0]))
})

test('frame 裁切同时约束入口命中；完全裁掉的入口不占 Tab 顺序', () => {
  const clip = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 120 }, { x: 0, y: 120 }]
  assert.match(render([item({ clips: [clip] })]), /clip-path:polygon\(/)
  const hidden = [{ x: 0, y: 80 }, { x: 200, y: 80 }, { x: 200, y: 120 }, { x: 0, y: 120 }]
  assert.doesNotMatch(render([item({ clips: [hidden] })]), /<a /)
  assert.doesNotMatch(render([item({ opacity: 0 })]), /<a /)
})

test('渲染状态只缓存深层冻结的纯数据，外层冻结不掩盖更新或坏地址', () => {
  let reads = 0
  const links = createShapeLinkState(() => { reads++; return 44 }), source = Object.freeze([item()])
  links.set(source)
  source[0].url = 'https://example.invalid/changed'; source[0].origin.x = 999
  links.set(source)
  assert.equal(links.state.get().items[0].url, source[0].url)
  assert.equal(links.state.get().items[0].origin.x, 999)
  source[0].url = 'javascript:void(0)'; assert.throws(() => links.set(source))
  const frozen = checkedShapeLinks([item()])
  links.set(frozen); const before = reads, state = links.state.get()
  links.set(frozen); assert.equal(reads, before); assert.equal(links.state.get(), state)
  let url = 'https://example.invalid/getter'
  const getter = Object.freeze([{ ...frozen[0], get url() { return url } }].map(Object.freeze))
  links.set(getter); url = 'https://example.invalid/getter-changed'; links.set(getter)
  assert.equal(links.state.get().items[0].url, url)
  const prototype = { url: 'https://example.invalid/inherited' }, { url: ignored, ...rest } = frozen[0]
  const inherited = Object.freeze([Object.freeze(Object.assign(Object.create(prototype), rest))])
  links.set(inherited); prototype.url = 'https://example.invalid/inherited-changed'; links.set(inherited)
  assert.equal(links.state.get().items[0].url, prototype.url)
})
