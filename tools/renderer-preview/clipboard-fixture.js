import { createCanvasSnapshot } from '../../model/index.js'
import { executeCanvasCommands } from '../../engine/index.js'

export function createClipboardFixture({ empty = false } = {}) {
  const snapshot = empty ? createCanvasSnapshot() : executeCanvasCommands(createCanvasSnapshot(), [
    { type: 'create_shape', id: 'shape:clipboard-a', shapeType: 'geo', x: 100, y: 160, props: { w: 100, h: 80, fill: 'solid' } },
    { type: 'create_shape', id: 'shape:clipboard-b', shapeType: 'geo', x: 340, y: 260, props: { w: 80, h: 120, fill: 'solid' } },
  ]).snapshot
  return { snapshot, clipboardFixture: true, count: empty ? 0 : 2, counts: { geo: empty ? 0 : 2 }, assetCount: 0, viewState: { currentPageId: 'page:page', camera: { x: 0, y: 0, z: 1 } } }
}

export function externalClipboardCases(origin) {
  const item = (id, fields = {}) => ({ id, type: 'rectangle', x: 20, y: 30, width: 160, height: 90, angle: 0,
    strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null, isDeleted: false, boundElements: null, link: null, locked: false, ...fields })
  const excal = elements => ({ 'text/plain': JSON.stringify({ type: 'excalidraw/clipboard', elements, files: {} }) })
  const html = value => ({ 'text/html': value, 'text/plain': 'PRIVATE-FALLBACK-MUST-NOT-APPEAR' })
  const trap = name => `${origin}/__clipboard_trap__/${name}`
  const execute = 'globalThis.top.__hicanvasExternalExecuted++'
  return [
    { name: 'plain-paragraphs', formats: { 'text/plain': 'Hello\n\n<literal>' }, count: 1, text: 'Hello\n\n<literal>' },
    { name: 'plain-url-stays-text', formats: { 'text/plain': 'https://example.invalid/ordinary-text' }, count: 1, text: 'https://example.invalid/ordinary-text' },
    { name: 'plain-format-mention', formats: { 'text/plain': 'The format is "excalidraw/clipboard".' }, count: 1, text: 'The format is "excalidraw/clipboard".' },
    { name: 'plain-iframe-code', formats: { 'text/plain': '<iframe src="https://example.invalid/embed"></iframe>' }, rejected: '#138' },
    { name: 'html-marks', formats: html('<p>First <strong>B<em>I</em></strong><br>last</p><p>next</p>'), count: 1, text: 'First BI\nlast\nnext', marks: true },
    { name: 'html-source-whitespace', formats: html('<div>\n  <p>A\n <b> B </b><i> C</i> &nbsp;D<br>  E</p>\n  <p>F</p>\n</div>'), count: 1, text: 'A B C \u00a0D\nE\nF' },
    { name: 'html-unknown-wrapper', formats: html(`<unknown data-x="private"><p onclick="${execute}" style="color:red" class="private">First <b>B</b><i>I</i> tail</p></unknown>`), count: 1, text: 'First BI tail' },
    { name: 'html-malformed', formats: html('<p><b>bold<i>both</b>italic</i><p>next<br>line<div>tail'), count: 1, text: 'boldbothitalic\nnext\nline\ntail' },
    { name: 'html-inert-resources', formats: html(`<p>SAFE <b>B</b><i>I</i></p><script>${execute}</script><style>@import url("${trap('css')}");body{background:url("${trap('background')}")}</style><link rel="stylesheet" href="${trap('link')}"><base href="${trap('base')}"><meta http-equiv="refresh" content="0;url=${trap('meta')}"><img src="${trap('img')}" srcset="${trap('srcset')} 2x" onerror="${execute}"><object data="${trap('object')}">HIDDEN</object>`), count: 1, text: 'SAFE BI' },
    { name: 'html-foreign-namespaces', formats: html(`<p>SAFE</p><svg xmlns="http://www.w3.org/2000/svg" onload="${execute}"><image href="${trap('svg')}"></image><foreignObject><p>HIDDEN</p></foreignObject></svg><math xmlns="http://www.w3.org/1998/Math/MathML"><mtext>HIDDEN</mtext></math>`), count: 1, text: 'SAFE' },
    { name: 'html-dangerous-links', formats: html('<p><a href="javascript:alert(1)">JS</a><a href="jav&#x09;ascript:alert(1)">TAB</a><a href="data:text/html,x">DATA</a><a href="file:///not-read">FILE</a><a href="/relative">REL</a><a href="//example.invalid">PROTO</a></p>'), count: 1, text: 'JSTABDATAFILERELPROTO' },
    ...['https://example.invalid', 'http://example.invalid', 'mailto:synthetic@example.invalid'].map((href, i) => ({ name: `html-valid-link-${i}`, formats: html(`<p><a href="${href}">link</a></p>`), rejected: '#150' })),
    { name: 'html-iframe-srcdoc', formats: html(`<iframe src="${trap('frame')}" srcdoc="&lt;script&gt;${execute}&lt;/script&gt;&lt;img src='${trap('srcdoc')}'&gt;"></iframe>`), rejected: '#138' },
    { name: 'html-iframe-script-only', formats: html(`<iframe srcdoc="&lt;script&gt;${execute}&lt;/script&gt;"></iframe>`), rejected: '#138' },
    { name: 'html-heading', formats: html('<h1>Heading</h1>'), rejected: '#150' },
    { name: 'html-list', formats: html('<ul><li>List</li></ul>'), rejected: '#150' },
    { name: 'html-rtl', formats: html('<p dir="rtl">ABC</p>'), rejected: '#150' },
    { name: 'plain-rtl', formats: { 'text/plain': 'Invoice مرحبا 42' }, rejected: '#150' },
    { name: 'legacy-data-tldraw', formats: html('<div DATA-TLDRAW="true">legacy</div>'), rejected: '旧版' },
    { name: 'internal-broken-reordered', formats: { 'text/plain': '{"version":1,"type":"hicanvas/clipboard","shapes":[' }, rejected: '内部' },
    { name: 'plain-utf8-limit', formats: { 'text/plain': '中'.repeat(88000) }, rejected: '上限' },
    { name: 'plain-codepoint-limit', formats: { 'text/plain': 'A'.repeat(100001) }, rejected: '上限' },
    { name: 'html-byte-limit', formats: html(' '.repeat(1024 * 1024 + 1)), rejected: '上限' },
    { name: 'html-node-limit', formats: html('<span>x</span>'.repeat(10001)), rejected: '上限' },
    { name: 'html-depth-limit', formats: html('<div>'.repeat(65) + 'nested' + '</div>'.repeat(65)), rejected: '上限' },
    { name: 'excal-rotation', formats: excal([item('a', { x: -150, y: -40, angle: Math.PI / 6 }), item('b', { type: 'ellipse', x: 150, y: 160, width: 80, height: 60, angle: -Math.PI / 4 })]), count: 2, poses: [[351.4313143189588, 200.33675888518644, Math.PI / 6], [608.7158719386555, 471.37896986735166, 5.497787143782138]] },
    { name: 'excal-convert-skip', formats: excal([item('a', { strokeWidth: 8, strokeColor: '#6741d9' }), item('b', { type: 'synthetic' }), item('c', { x: 260, y: 150, boundElements: [{ id: 'missing', type: 'text' }] })]), count: 2, notice: true },
    { name: 'excal-all-skipped', formats: excal([item('a', { type: 'synthetic' })]), empty: true, notice: true },
    { name: 'excal-bad-json', formats: { 'text/plain': '{"type":"excalidraw/clipboard","elements":[' }, rejected: 'JSON' },
    { name: 'excal-duplicate-id', formats: excal([item('a'), item('a')]), rejected: '重复' },
    { name: 'excal-negative', formats: excal([item('a'), item('b', { width: -1 })]), rejected: '越界' },
    { name: 'excal-nonfinite', formats: { 'text/plain': JSON.stringify({ type: 'excalidraw/clipboard', elements: [item('a')] }).replace('"width":160', '"width":1e999') }, rejected: '有限' },
    { name: 'excal-count-limit', formats: excal(Array.from({ length: 1001 }, (_, i) => item(String(i)))), rejected: '上限' },
  ]
}
