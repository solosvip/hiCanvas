import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {checkContentIsolation} from './check-content-isolation.mjs'

const check=(source,path='src/editor/generated.jsx')=>checkContentIsolation(path,source)
test('画板直接和计算属性读取子页、别名获取、SVG与srcdoc回退均被拦截',()=>{
  for(const source of [
    'frame.contentDocument.body.textContent',
    'frame?.contentWindow?.CowartFilm.play()',
    'const child=frame["content"+"Window"];child.document',
    'const {body}=frame.contentDocument',
    'const {contentDocument}=iframe',
    'const {contentWindow:child}=iframe;child.document',
    'const {["content"+"Window"]:child}=iframe',
    'Reflect.get(frame,"contentDocument")',
    'Object.getOwnPropertyDescriptor(frame,"contentWindow")',
    'window.frames[0].document',
    'frame.getSVGDocument()',
    'frame.srcdoc=html',
    'const attributes={srcDoc:html}',
    'const node=<iframe srcDoc={html}/>',
    'frame.setAttribute("srcdoc",html)',
    'import {renderHtmlDraftDocument} from "../../content-channel/index.js"',
    'import * as helpers from "../../content-channel/index.js"',
    'import capture from "../../content-channel/capture-render.js"',
  ])assert.ok(check(source).length,source)
})
test('父能力接口和通道窗口身份/握手可用，子内捕获不等于父读DOM',()=>{
  assert.deepEqual(check('import {renderContentCapture} from "../../content-channel/index.js";renderContentCapture(frame,options)'),[])
  const path='content-channel/parent.js'
  assert.deepEqual(check('const active={frame:iframe.contentWindow};iframe.contentWindow.postMessage(message,origin,[port])',path),[])
  for(const source of ['iframe.contentDocument.body','const child=iframe.contentWindow;child.document','iframe.contentWindow.document','const active={frame:iframe.contentWindow};active.frame.document','const {contentDocument:doc}=iframe;doc.body','const active={frame:iframe.contentWindow};const {document:doc}=active.frame;doc.body'])assert.ok(check(source,path).length,source)
  for(const path of ['content-channel/capture-parent.js','content-channel/edit-parent.js','content-channel/offline-slides.js'])assert.ok(check('const {contentDocument:doc}=iframe',path).length,path)
  assert.deepEqual(check('const doc=iframe.contentDocument;iframe.contentWindow.__hicanvasCaptureRender(doc)','content-channel/capture-realm.js'),[])
})
test('父生产文件中的新旧渲染代码都受同一检查约束，合成测试反例可独立保留',()=>{
  for(const path of ['src/editor/shapes.jsx','renderer/embed.js','desktop/main.mjs'])assert.ok(check('iframe.contentDocument',path).length,path)
  assert.deepEqual(check('iframe.contentDocument','tools/security-probe.js'),[])
  assert.deepEqual(check('iframe.contentDocument','server/security.test.mjs'),[])
})
test('双权限仅放行两个指定构造函数，不按整个文件放行',()=>{
  for(const source of [
    'const frame=<iframe sandbox="allow-scripts allow-same-origin"/>',
    'iframe.setAttribute("sandbox","allow-scripts allow-same-origin")',
    'const sandbox=["allow-scripts","allow-same-origin"].join(" ")',
    'const sandbox="allow-scripts allow-"+"same-origin"',
    'const sandbox=["allow-scripts allow-","same-origin"].join("")',
    'const sandbox=`allow-scripts ${extra} allow-same-origin`',
  ])assert.ok(check(source).length,source)
  const unique='export function isolatedContentSandbox(){return "allow-scripts allow-same-origin"}'
  const external='const frame=extra=>({sandbox:`allow-scripts ${extra} allow-same-origin`})'
  assert.deepEqual(check(unique,'content-channel/content-policy.js'),[])
  assert.deepEqual(check(external,'renderer/embed-content.js'),[])
  assert.ok(check(unique+';const stray="allow-scripts allow-same-origin"','content-channel/content-policy.js').length)
  assert.ok(check(external+';const stray="allow-scripts allow-same-origin"','renderer/embed-content.js').length)
  assert.ok(check(unique,'src/not-the-constructor.js').length)
  assert.ok(check('const permissions="allow-scripts allow-same-origin"','model/generated.js').length)
})
