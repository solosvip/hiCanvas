import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { sanitizeSvgStyles } from './svg-styles.mjs'
import { sanitizeSvg } from './svg-sanitize.mjs'
import { svg } from '../tools/renderer-preview/svg-fixtures.js'

function clean(source, inline = false) {
  const warnings = [], budget = {}, style = sanitizeSvgStyles(source, { inline, budget, warn: value => warnings.push(value) })
  return { text: style.render(), warnings, budget }
}
test('重建简单标签/class/id及逗号样式，值校验同属性，保留important与内联优先级', () => {
  const source = 'rect,.tile,#label {fill: url("#paint") !important; stroke: rgb(1, 2, 3); transform: translate(2,3); opacity:.5}'
  const result = clean(source)
  assert.match(result.text, /rect,.tile,#label/); assert.match(result.text, /fill:url\(#paint\)!important/)
  assert.match(result.text, /stroke:rgb\(1, 2, 3\)/); assert.match(result.text, /translate\(2,3\)/)
  assert.equal(clean('fill:red;stroke:blue!important', true).text, 'fill:red;stroke:blue!important')
  assert.equal(result.warnings.length, 0)
})
for (const value of ['url(https://svg-test.invalid/a)', 'url(#p) red', 'u\\72l(#p)', 'url(/**/#p)', 'var(--x)', 'env(x)', 'calc(1+2)', 'expression(alert(1))', 'url(data:image/svg+xml;base64,PHN2Zy8+)', 'url(//svg-test.invalid/a)']) test(`CSS危险值不进入重建结果：${value}`, () => {
  const result = clean(`rect{fill:${value};stroke:blue}`)
  assert.doesNotMatch(result.text, /fill:/); assert.match(result.text, /stroke:blue/); assert.ok(result.warnings.length)
})
for (const selector of ['g rect', 'g>rect', 'rect:hover', '[href]', '*', 'svg|rect', '.esca\\70ed', '#one.two', Array(9).fill('rect').join(',')]) test(`复杂选择器不进入重建结果：${selector}`, () => {
  assert.equal(clean(`${selector}{fill:red}`).text, '')
})
test('丢弃@规则及嵌套规则，坏CSS和逃出style属性整份拒绝', () => {
  const result = clean('@import "https://svg-test.invalid/a";@font-face{src:url(https://svg-test.invalid/font)}rect{g{fill:red}fill:blue;filter:url(#f);animation:bad 1s;--x:red}')
  assert.equal(result.text, 'rect{fill:blue;}')
  for (const source of ['fill: red;} rect{stroke:blue', 'fill:"unclosed', 'fill:red;/*']) assert.throws(() => clean(source, true))
})
test('sourceMappingURL不读文件、不解码巨大data map，序列化不保留原raw/comment', t => {
  let reads = 0
  t.mock.method(fs, 'readFileSync', () => { reads++; throw new Error('禁止读取任何source map') })
  for (const url of ['file:///synthetic/canary.map', 'https://svg-test.invalid/map', `data:application/json;base64,${'A'.repeat(60000)}`]) {
    const result = clean(`rect{fill:red}/*# sourceMappingURL=${url} */`)
    assert.match(result.text, /fill:red/); assert.doesNotMatch(result.text, /sourceMappingURL|canary|svg-test/)
  }
  assert.equal(reads, 0)
})
test('CSS预算计入被丢弃的@规则/嵌套规则/未知属性；边界与加一', () => {
  assert.equal(clean(`${' '.repeat(65536 - 12)}rect{fill:r}`).budget.css, 65536)
  assert.throws(() => clean(`${' '.repeat(65536)}rect{fill:r}`), /css/)
  assert.equal(clean('x{}'.repeat(1000)).budget.rules, 1000)
  assert.throws(() => clean('x{}'.repeat(1001)), /rules/)
  assert.throws(() => clean('@a{'.repeat(1001) + '}'.repeat(1001)), /rules/)
  assert.equal(clean(`rect{${'x:0;'.repeat(10000)}}`).budget.declarations, 10000)
  assert.throws(() => clean(`rect{${'x:0;'.repeat(10001)}}`), /declarations/)
})
test('CSS引用也参加循环/错类型检测，已去掉的pattern引用删除并提示', () => {
  assert.throws(() => sanitizeSvg(svg('<defs><mask id="m"><rect class="loop"/></mask></defs><style>.loop{mask:url(#m)}</style><rect/>')), /循环/)
  assert.throws(() => sanitizeSvg(svg('<rect id="wrong"/><style>rect{clip-path:url(#wrong)}</style>')), /类型/)
  const result = sanitizeSvg(svg('<pattern id="p"/><style>rect{fill:url(#p);stroke:red}</style><rect/>'))
  assert.doesNotMatch(result.bytes.toString(), /url\(#p\)/); assert.ok(result.warnings.length)
})
