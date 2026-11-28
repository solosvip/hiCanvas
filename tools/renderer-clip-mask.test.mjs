import './test-sandbox.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { beginClipPixelProbe, endClipPixelProbe } from './renderer-preview/clip-pixel-mask.js'

// Only the external DOM/layout boundary is replaced; the real probe collects
// metadata and restores its own state. Real dialog layout is checked separately.
class DomNode {
  constructor({ parent, paint = {}, box = { x: 40, y: 50, width: 80, height: 60 }, rects = true } = {}) {
    this.parentElement = parent; this.paint = { opacity: '1', display: 'block', visibility: 'visible', boxShadow: 'none', ...paint }
    this.box = box; this.rects = rects; this.style = {}; this.dataset = {}; this.children = []; this.attributes = new Set()
    if (parent) parent.children.push(this)
  }
  getBoundingClientRect() { return this.box }
  getClientRects() { return this.rects ? [this.box] : [] }
  get firstElementChild() { return this.children[0] }
  querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]) }
  hasAttribute(name) { return this.attributes.has(name) }
  removeAttribute(name) { this.attributes.delete(name) }
  remove() { this.isConnected = false }
}
class Element extends DomNode {}
class Svg extends DomNode {}

function probe(setup) {
  const originals = new Map(['HTMLElement', 'document', 'window', 'getComputedStyle', 'innerWidth', 'innerHeight'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const navigation = new Element({ box: { x: 8, y: 8, width: 20, height: 20 } })
  const transform = { toMatrix: () => ({ toFloat64Array: () => [1, 0, 0, 1, 0, 0] }) }
  const world = { attributeStyleMap: new Map([['transform', transform]]) }
  const fixture = setup(navigation), { target = fixture, svgs = [], shapes = [] } = fixture
  Object.assign(globalThis, {
    HTMLElement: Element, getComputedStyle: node => node.paint, innerWidth: 1280, innerHeight: 800,
    window: { __HICANVAS_RENDERER_PREVIEW__: { getCamera: () => ({ x: 0, y: 0, z: 1 }) } },
    document: { querySelector: () => world, querySelectorAll: selector => selector === '#status, #navigation' ? [navigation] : selector === '[data-shape-type=geo] > svg' ? svgs : shapes, createElement: () => new Element() },
  })
  try {
    const metadata = beginClipPixelProbe({ overflowProbe: false })
    assert.equal(endClipPixelProbe(), true)
    return { metadata, target }
  } finally {
    endClipPixelProbe()
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]
  }
}

const covers = (box, point) => box.width > 0 && box.height > 0 && box.x <= point.x && point.x < box.x + box.width && box.y <= point.y && point.y < box.y + box.height
const farPoint = { x: 1000, y: 700 }

test('closed shadow dialog does not reject unrelated viewport pixels', () => {
  const { metadata } = probe(parent => new Element({ parent, paint: { display: 'none', boxShadow: '0 8px 20px black' }, box: { x: 0, y: 0, width: 0, height: 0 }, rects: false }))
  assert.equal(metadata.opaqueBoxes.some(box => covers(box, farPoint)), false, JSON.stringify(metadata.opaqueBoxes))
  assert.ok(metadata.opaqueBoxes.every(box => box.width > 0 && box.height > 0))
})

for (const [name, options] of [
  ['display:none', { paint: { display: 'none' } }],
  ['visibility:hidden', { paint: { visibility: 'hidden' } }],
  ['visibility:collapse', { paint: { visibility: 'collapse' } }],
  ['opacity:0', { paint: { opacity: '0' } }],
  ['no layout boxes', { rects: false }],
]) test(`${name} contributes no opaque box`, () => {
  const { metadata } = probe(parent => new Element({ parent, ...options, paint: { boxShadow: '20px 0px 0px 4px black', ...options.paint } }))
  assert.equal(metadata.opaqueBoxes.some(box => covers(box, { x: 60, y: 70 })), false, JSON.stringify(metadata.opaqueBoxes))
  assert.ok(metadata.opaqueBoxes.every(box => box.width > 0 && box.height > 0))
})

for (const paint of [{ display: 'none' }, { opacity: '0' }, { contentVisibility: 'hidden' }]) test(`non-painting ancestor ${JSON.stringify(paint)} hides descendants`, () => {
  const { metadata } = probe(parent => new Element({ parent: new Element({ parent, paint, box: { x: 0, y: 0, width: 0, height: 0 } }), paint: { visibility: 'visible', boxShadow: '1px 1px black' } }))
  assert.equal(metadata.opaqueBoxes.some(box => covers(box, { x: 60, y: 70 })), false)
})

test('visible shadow layer keeps its actual box and conservative paint protection', () => {
  const { metadata, target } = probe(parent => new Element({ parent, paint: { boxShadow: '0 8px 20px black' } }))
  assert.ok(metadata.opaqueBoxes.some(box => covers(box, { x: 60, y: 70 })))
  assert.ok(metadata.opaqueBoxes.some(box => JSON.stringify(box) === JSON.stringify(target.box)))
  assert.equal(metadata.opaqueBoxes.some(box => covers(box, farPoint)), true)
})

for (const paint of [{ boxShadow: '20px 0px 0px 4px black' }, { textShadow: '20px 0px black' }, { filter: 'blur(8px)' }]) test(`visible out-of-box paint stays rejected: ${JSON.stringify(paint)}`, () => {
  const { metadata, target } = probe(parent => new Element({ parent, paint }))
  // The shadow is shifted 20px right: this point is outside layout but inside
  // its painted region. Unknown shadow/filter extents must never grant ink AA.
  const point = { x: 130, y: 80 }
  assert.equal(covers(target.box, point), false)
  assert.ok(metadata.opaqueBoxes.some(box => covers(box, point)), JSON.stringify(metadata.opaqueBoxes))
})

test('a visible layer without effects does not blanket the viewport', () => {
  const { metadata } = probe(parent => new Element({ parent }))
  assert.equal(metadata.opaqueBoxes.some(box => covers(box, farPoint)), false)
})

for (const box of [{ x: 40, y: 50, width: 0, height: 60 }, { x: 40, y: 50, width: 80, height: 0 }, { x: 40, y: 50, width: 0, height: 0 }]) {
  for (const paint of [{}, { boxShadow: '20px 0px 0px 4px black' }, { textShadow: '20px 0px black' }, { filter: 'blur(8px)' }]) test(`zero-size visible box ${box.width}x${box.height} retains only an effects fallback: ${JSON.stringify(paint)}`, () => {
    const { metadata } = probe(parent => new Element({ parent, box, paint }))
    assert.ok(metadata.opaqueBoxes.every(value => value.width > 0 && value.height > 0), '零尺寸外框不应登记')
    assert.equal(metadata.opaqueBoxes.some(value => covers(value, farPoint)), Object.keys(paint).length > 0, JSON.stringify(metadata.opaqueBoxes))
  })
}

test('half-transparent ancestors do not hide visible descendants', () => {
  const { metadata } = probe(parent => new Element({ parent: new Element({ parent, paint: { opacity: '.4' } }) }))
  assert.ok(metadata.opaqueBoxes.some(box => covers(box, { x: 60, y: 70 })))
})

test('content-visibility:hidden can still paint its own background and border', () => {
  const { metadata } = probe(parent => new Element({ parent, paint: { contentVisibility: 'hidden' } }))
  assert.ok(metadata.opaqueBoxes.some(box => covers(box, { x: 60, y: 70 })))
})

test('a child may override inherited visibility and overflow a zero-size parent', () => {
  const { metadata } = probe(parent => new Element({ parent: new Element({ parent, paint: { visibility: 'hidden' }, box: { x: 0, y: 0, width: 0, height: 0 } }), paint: { visibility: 'visible' } }))
  assert.ok(metadata.opaqueBoxes.some(box => covers(box, { x: 60, y: 70 })))
})

for (const [name, paint, box] of [
  ['hidden parent', { display: 'none' }, { x: 0, y: 0, width: 0, height: 0 }],
  ['invisible SVG', { visibility: 'hidden' }],
  ['zero-size SVG', {}, { x: 40, y: 50, width: 0, height: 0 }],
  ['visible SVG under half-transparent parent', {}],
]) test(`translucent registration skips ${name} only when it does not paint`, () => {
  const { metadata } = probe(() => {
    const shape = new Element({ paint: { opacity: '.4', ...paint } }); shape.dataset.shapeId = 'shape:semi-test'
    const svg = new Svg({ parent: shape, paint: { visibility: paint.visibility || 'visible' }, ...(box && { box }) })
    return { target: svg, svgs: [svg], shapes: [shape] }
  })
  assert.equal(metadata.semiShapes.length, name.startsWith('visible') ? 1 : 0)
  if (metadata.semiShapes.length) assert.equal(metadata.semiShapes[0].opacity, .4)
})
