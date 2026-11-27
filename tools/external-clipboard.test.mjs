import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseExternalClipboard } from './renderer-preview/clipboard-external.js'
import { createClipboardContent, encodeClipboardContent, executeCanvasCommands, planClipboardPaste } from '../engine/index.js'
import { createCanvasSnapshot } from '../model/index.js'

test('宿主纯文本解析保留段落和字面HTML，先识别自有格式且坏自有格式不得降级', () => {
  const result = parseExternalClipboard({ 'text/plain': 'Hello\r\n\r\n<script>literal</script>' })
  assert.equal(result.kind, 'external-content')
  assert.equal(result.placement, 'default')
  assert.deepEqual(result.content.shapes[0].props.richText.content.map(p => p.content.map(t => t.text || '').join('')), ['Hello', '', '<script>literal</script>'])
  const source = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', id: 'shape:internal', shapeType: 'geo' }]).snapshot
  const formats = encodeClipboardContent(createClipboardContent(source, ['shape:internal']))
  assert.deepEqual(parseExternalClipboard(formats), formats)
  assert.throws(() => parseExternalClipboard({ 'text/html': '<div data-hicanvas-clipboard="1">broken</div>', 'text/plain': 'fallback' }), /内部/)
  assert.throws(() => parseExternalClipboard({ 'text/html': '<div data-tldraw>legacy</div>', 'text/plain': 'fallback' }), /旧版/)
  const ordinary = 'The format is "excalidraw/clipboard".'
  assert.equal(parseExternalClipboard({ 'text/plain': ordinary }).content.shapes[0].props.richText.content[0].content[0].text, ordinary)
  const frame = { nodeType: 1, localName: 'iframe', namespaceURI: 'http://www.w3.org/1999/xhtml', textContent: '', childNodes: [], getAttribute: key => key === 'src' ? 'https://example.invalid/embed' : null }
  const document = { implementation: { createHTMLDocument: () => ({ defaultView: null, createElement: () => ({ content: { nodeType: 11, childNodes: [frame] } }) }) } }
  const fallback = parseExternalClipboard({ 'text/plain': '<iframe src="https://example.invalid/embed"></iframe>' }, { document })
  assert.equal(fallback.content.shapes[0].type, 'bookmark')
  assert.deepEqual(fallback.notice.counts, { bookmarkFallbacks: 1 })
  const preferred = { ...formats, 'text/plain': '<iframe src="https://example.invalid/embed"></iframe>' }
  assert.deepEqual(parseExternalClipboard(preferred, { document }), preferred)
  assert.throws(() => parseExternalClipboard({ 'text/plain': '{"type":"hicanvas/clipboard","version":' }), /内部/)
  assert.throws(() => parseExternalClipboard({ 'text/plain': '{"version":1,"type":"hicanvas/clipboard","shapes":[' }), /内部/)
  assert.throws(() => parseExternalClipboard({ 'text/plain': '{"version":1,"ty\\u0070e":"hicanvas/clipboard","shapes":[' }), /内部/)
})

test('已审定的颜色、填充、粗糙度、透明度与线宽分档使用明确结果', () => {
  const values = [
    { strokeWidth: 1.5 }, { strokeWidth: 1.5001 }, { strokeWidth: 2.5 }, { strokeWidth: 2.5001 }, { strokeWidth: 3.5 }, { strokeWidth: 3.5001 },
    { roughness: 1 }, { roughness: 2, strokeStyle: 'dotted' },
    { backgroundColor: '#ffc9c9', fillStyle: 'hachure' }, { backgroundColor: '#a5d8ff', fillStyle: 'cross-hatch', opacity: 50 },
    { strokeColor: '#1971c2', backgroundColor: '#unknown', fillStyle: 'unknown' },
    { strokeColor: '#e03131' }, { strokeColor: '#2f9e44' }, { strokeColor: '#f08c00' }, { strokeColor: '#ffffff' },
  ]
  const result = parseExternalClipboard(excal(values.map((value, i) => element({ ...value, id: String(i), x: i * 200 }))))
  const shapes = result.content.shapes
  assert.deepEqual(shapes.slice(0, 6).map(r => r.props.size), ['s', 'm', 'm', 'l', 'l', 'xl'])
  assert.equal(shapes[6].props.dash, 'draw')
  assert.equal(shapes[7].props.dash, 'dotted')
  assert.deepEqual(shapes.slice(8, 11).map(r => [r.props.color, r.props.fill, r.opacity]), [['light-red', 'pattern', 1], ['light-blue', 'pattern', .5], ['blue', 'solid', 1]])
  assert.deepEqual(shapes.slice(11).map(r => r.props.color), ['red', 'green', 'orange', 'white'])
  assert.equal(result.notice.counts.backgroundFallbacks, 1)
  assert.equal(result.notice.counts.solidFills, 1)
})

test('资源预算按UTF-8和结构检查；坏数据不能藏在被跳过的元素里', () => {
  for (const formats of [
    { 'text/plain': '中'.repeat(88000) }, { 'text/plain': 'A'.repeat(100001) },
    { 'text/html': ' '.repeat(1024 * 1024 + 1) }, { 'text/plain': ' '.repeat(4 * 1024 * 1024 + 1) },
    excal(Array.from({ length: 1001 }, (_, i) => element({ id: String(i) }))),
    excal([element(), element({ id: 'unknown', type: 'synthetic', x: null })]),
    excal([element({ id: 'deleted', isDeleted: true }), element({ id: 'deleted' })]),
    { 'text/plain': '{"type":"excalidraw/clipboard","elements":[],"__proto__":{}}' },
  ]) assert.throws(() => parseExternalClipboard(formats))
  const nested = { type: 'excalidraw/clipboard', elements: [], files: {} }
  let parent = nested
  for (let i = 0; i < 65; i++) { parent.extra = {}; parent = parent.extra }
  assert.throws(() => parseExternalClipboard({ 'text/plain': JSON.stringify(nested) }), /上限/)
  const skipped = parseExternalClipboard(excal([element({ isDeleted: true }), element({ id: 'b', type: 'synthetic' })]))
  assert.equal(skipped.content, null)
  assert.match(skipped.notice.message, /没有可导入的内容/)
  assert.equal(skipped.notice.counts.deletedElements, 1)
  assert.deepEqual(parseExternalClipboard({ 'text/plain': '{"ordinary":"json"}' }).content.shapes[0].props.richText.content[0].content[0].text, '{"ordinary":"json"}')
  const accepted = parseExternalClipboard(excal(Array.from({ length: 1000 }, (_, i) => element({ id: String(i), x: i * 200 }))))
  assert.equal(accepted.content.shapes.length, 1000)
})

const element = (fields = {}) => ({ id: 'a', type: 'rectangle', x: 20, y: 30, width: 160, height: 90, angle: 0,
  strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100,
  groupIds: [], frameId: null, roundness: null, isDeleted: false, boundElements: null, link: null, locked: false, ...fields })
const excal = elements => ({ 'text/plain': JSON.stringify({ type: 'excalidraw/clipboard', elements, files: {} }) })

test('两个旋转Excalidraw按解析边界居中，相机缩放后只统一平移', () => {
  const result = parseExternalClipboard(excal([
    element({ x: -150, y: -40, angle: Math.PI / 6 }),
    element({ id: 'b', type: 'ellipse', x: 150, y: 160, width: 80, height: 60, angle: -Math.PI / 4 }),
  ]))
  // Independent analytic ellipse projection: sqrt((40²+30²)/2) per half
  // extent. Legacy sampled 70×70, placing the two origins at (351.6089838486225,
  // 200.51442841485013) and (608.8935414683192,471.5566393970154) instead.
  const original = [[351.4313143189588, 200.33675888518644, Math.PI / 6], [608.7158719386555, 471.37896986735166, 5.497787143782138]]
  for (const [viewport, delta] of [[{ x: 0, y: 0, w: 1000, h: 700 }, [0, 0]], [{ x: 200, y: 100, w: 2000, h: 1400 }, [700, 450]]]) {
    const snapshot = createCanvasSnapshot(), plan = planClipboardPaste(snapshot, result.content, { viewport, strategy: result.placement })
    const pasted = executeCanvasCommands(snapshot, [{ type: 'paste_content', content: result.content, ...plan }])
    pasted.results[0].rootIds.forEach((id, i) => {
      const record = pasted.snapshot.store[id]
      for (const [actual, expected] of [[record.x, original[i][0] + delta[0]], [record.y, original[i][1] + delta[1]], [record.rotation, original[i][2]]]) assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)
    })
  }
})

test('Excalidraw先全部校验，再按审定映射转换、跳过，返回一条不含原文的计数通知', () => {
  const result = parseExternalClipboard(excal([
    element({ strokeWidth: 8, strokeColor: '#6741d9' }),
    element({ id: 'b', type: 'synthetic-unknown', label: 'PRIVATE-RAW' }),
    element({ id: 'c', groupIds: ['g'] }),
    element({ id: 'd', boundElements: [{ id: 'not-present', type: 'text' }] }),
  ]))
  assert.equal(result.placement, 'viewport-page')
  assert.equal(result.content.shapes.length, 2)
  assert.equal(result.content.shapes[0].props.size, 'xl')
  assert.equal(result.content.shapes[0].props.color, 'black')
  assert.equal(result.notice.source, 'clipboard')
  assert.equal(result.notice.counts.unsupportedTypes, 1)
  assert.equal(result.notice.counts.unsupportedFeatures, 1)
  assert.equal(result.notice.counts.colorsToBlack, 1)
  assert.equal(result.notice.counts.droppedBindings, 1)
  assert.ok(!result.notice.message.includes('PRIVATE-RAW'))
  for (const input of [
    { 'text/plain': '{"type":"excalidraw/clipboard","elements":[' },
    excal([element(), element()]), excal([element({ width: 0 })]), excal([element({ height: -1 })]),
    { 'text/plain': '{"type":"excalidraw/clipboard","elements":[{"id":"a","type":"rectangle","width":1e999}],"files":{}}' },
    { 'text/plain': '{"type":"excalidraw/clipboard","elements":{},"files":{}}' },
  ]) assert.throws(() => parseExternalClipboard(input))
})
