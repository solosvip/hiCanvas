import './test-sandbox.mjs'
import './renderer-test-fonts.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseExternalClipboard } from './renderer-preview/clipboard-external.js'
import { createExternalClipboardContent, createClipboardContent, encodeClipboardContent, executeCanvasCommands, planClipboardPaste } from '../engine/index.js'
import { createCanvasSnapshot } from '../model/index.js'
import { parseClipboardUrl } from './renderer-preview/clipboard-url.js'

test('单独网址走外部内容旧端口，保留内部格式优先，混合文字仍为文字', () => {
  const result = parseExternalClipboard({ 'text/plain': 'https://youtu.be/demo?t=73' })
  assert.equal(result.placement, 'viewport-page')
  assert.equal(result.content.shapes[0].type, 'embed')
  assert.deepEqual(result.content.shapes[0].props, { w: 800, h: 450, url: 'https://youtu.be/demo?t=73' })
  const source = executeCanvasCommands(createCanvasSnapshot(), [{ type: 'create_shape', id: 'shape:internal', shapeType: 'geo' }]).snapshot
  const formats = { ...encodeClipboardContent(createClipboardContent(source, ['shape:internal'])), 'text/plain': 'https://youtu.be/demo' }
  assert.deepEqual(parseExternalClipboard(formats), formats)
  for (const plain of ['这里有 https://youtu.be/demo', 'https://youtu.be/demo\n第二段', 'javascript:alert(1)']) {
    assert.equal(parseExternalClipboard({ 'text/plain': plain }).content.shapes[0].type, 'text')
  }
})

// The parser's document seam is inert-only. These unit fixtures exercise its
// data policy; the native embeds check separately exercises Chromium's parser.
function inertFixture(nodes, { live = false } = {}) {
  let value = null
  return { get input() { return value }, implementation: { createHTMLDocument: () => ({ defaultView: live ? {} : null, createElement: () => ({
    set innerHTML(html) { value = html }, content: { nodeType: 11, childNodes: nodes },
  }) }) } }
}
const iframe = src => ({ nodeType: 1, localName: 'iframe', namespaceURI: 'http://www.w3.org/1999/xhtml', textContent: '', childNodes: [], getAttribute(name) { assert.equal(name, 'src'); return src } })
test('iframe边界只读唯一src；从不读取输入宽高/权限/srcdoc，未知服务回退并只提示一次', () => {
  const html = '<iframe src="https://unknown.example.invalid" width="900" height="300" srcdoc="bad" onload="bad" sandbox="allow-top-navigation"></iframe>'
  const document = inertFixture([iframe('https://unknown.example.invalid')])
  const result = parseExternalClipboard({ 'text/html': html }, { document })
  assert.equal(document.input, html)
  assert.equal(result.content.shapes[0].type, 'bookmark')
  assert.deepEqual([result.content.shapes[0].props.w, result.content.shapes[0].props.h], [300, 46])
  assert.deepEqual(result.notice.counts, { bookmarkFallbacks: 1 })
  for (const nodes of [[iframe('https://youtu.be/demo'), iframe('https://youtu.be/other')],
    [iframe('https://youtu.be/demo'), { nodeType: 1, localName: 'script', childNodes: [] }],
    [iframe('javascript:alert(1)')], [iframe('/relative')], [iframe(null)], [{ ...iframe('https://youtu.be/demo'), namespaceURI: 'http://www.w3.org/2000/svg' }],
  ]) assert.throws(() => parseClipboardUrl({ 'text/html': html }, { document: inertFixture(nodes) }))
  assert.throws(() => parseClipboardUrl({ 'text/html': html }, { document: inertFixture([iframe('https://youtu.be/demo')], { live: true }) }))
})

test('HTTP和未知网址只建无图书签，合法Gist建嵌入；纯数据入口拒绝伪造HTML或属性', () => {
  for (const url of ['http://www.youtube.com/watch?v=demo', 'https://unknown.example.invalid']) {
    const result = parseExternalClipboard({ 'text/plain': url })
    assert.equal(result.content.shapes[0].type, 'bookmark')
    assert.deepEqual(result.content.assets[0].props, { src: new URL(url).href, title: '', description: '', image: '', favicon: '' })
  }
  const gist = parseExternalClipboard({ 'text/plain': 'https://gist.github.com/demo/0123456789abcdef0123456789abcdef?file=ignored.js#L1' })
  assert.equal(gist.content.shapes[0].type, 'embed')
  assert.deepEqual(gist.content.shapes[0].props, { w: 720, h: 500, url: 'https://gist.github.com/demo/0123456789abcdef0123456789abcdef' })
  assert.deepEqual(gist.content.assets, [])
  assert.throws(() => createExternalClipboardContent({ type: 'url', url: 'https://youtu.be/demo', source: 'iframe', html: '<script>bad</script>' }))
  assert.throws(() => createExternalClipboardContent({ type: 'url', url: 'https://youtu.be/demo', source: 'iframe', width: 900 }))
})

test('经既有paste_content在page中心一次插入，未定义的凭据/端口网址拒绝', () => {
  const result = parseExternalClipboard({ 'text/plain': 'https://www.tldraw.com/r/demo' })
  const initial = createCanvasSnapshot(), plan = planClipboardPaste(initial, result.content, { viewport: { x: 200, y: 100, w: 1000, h: 700 }, strategy: result.placement })
  const pasted = executeCanvasCommands(initial, [{ type: 'paste_content', content: result.content, ...plan }])
  const shape = pasted.snapshot.store[pasted.results[0].rootIds[0]]
  assert.equal(shape.type, 'bookmark')
  assert.deepEqual([shape.x, shape.y], [550, 427])
  for (const url of ['https://user@www.youtube.com/watch?v=demo', 'https://www.youtube.com:444/watch?v=demo', 'https://example.invalid/' + 'a'.repeat(8192)]) assert.throws(() => parseExternalClipboard({ 'text/plain': url }))
})
