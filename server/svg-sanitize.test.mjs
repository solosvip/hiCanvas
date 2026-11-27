import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { DOMParser } from '@xmldom/xmldom'
import { decodeSvgUpload, sanitizeSvg } from './svg-sanitize.mjs'
import { svg, svgPositive, svgAttacks, svgDimensions } from '../tools/renderer-preview/svg-fixtures.js'
import { svgLimits, preflightSvg } from './svg-budget.mjs'
import { rasterFiles } from '../tools/renderer-preview/image-fixtures.js'
import { animatedImage } from '../tools/renderer-preview/image-fixtures.js'
import { crc32, gzipSync } from 'node:zlib'

test('白名单重建保留类样式、渐变、use、裁剪、文字及流程图marker；输出幂等', () => {
  const clean = sanitizeSvg(svgPositive)
  const xml = clean.bytes.toString()
  for (const tag of ['style', 'linearGradient', 'use', 'marker', 'clipPath', 'text']) assert.ok(xml.includes(`<${tag}`), tag)
  assert.match(xml, /marker-end="url\(#arrow\)"/)
  assert.match(xml, /SVG &amp; 文字/)
  assert.deepEqual(sanitizeSvg(xml).bytes, clean.bytes)
  assert.equal(clean.mimeType, 'image/svg+xml'); assert.equal(clean.isAnimated, false)
})
for (const sample of svgDimensions) test(`保留${sample.name}尺寸属性而不在服务端另写浏览器布局`, () => {
  const result = sanitizeSvg(svg('<rect width="100%" height="100%"/>', sample.attributes)).bytes.toString()
  const root = new DOMParser().parseFromString(result, 'application/xml').documentElement
  for (const attribute of sample.attributes.matchAll(/(\w+)="([^"]*)"/g)) assert.equal(root.getAttribute(attribute[1]), attribute[2])
})
for (const sample of svgAttacks) test(`恶意SVG：${sample.name}`, () => {
  if (sample.reject) { assert.throws(() => sanitizeSvg(sample.source)); return }
  const clean = sanitizeSvg(sample.source), xml = clean.bytes.toString()
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  assert.equal(doc.getElementsByTagName('script').length, 0)
  assert.doesNotMatch(xml, /svg-test\.invalid|synthetic\/canary|foreignObject|xml:base|onload=|onclick=|<filter|<pattern|<font\b|@import|@font-face|sourceMappingURL/)
  assert.deepEqual(sanitizeSvg(xml).bytes, clean.bytes)
})
test('只接受严格UTF8/base64的SVG，不接路径、URL、压缩或伪装数据', () => {
  const wrap = value => `data:image/svg+xml;base64,${Buffer.from(value).toString('base64')}`
  assert.match(decodeSvgUpload(wrap(svg('<rect/>'))).bytes.toString(), /<rect/)
  for (const value of ['https://svg-test.invalid/a', '/synthetic/canary', 'data:image/svg+xml;base64,@@@@', wrap(Buffer.from([255, 254, 0, 0])), wrap('<?xml version="1.0" encoding="UTF-16"?><svg/>'), wrap('<svg/>\0')]) assert.throws(() => decodeSvgUpload(value))
  let source = svg('<rect/>'); while (Buffer.byteLength(source) % 3 !== 1) source += ' '
  const encoded = Buffer.from(source).toString('base64'), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const malformed = encoded.slice(0, -3) + alphabet[alphabet.indexOf(encoded.at(-3)) + 1] + '=='
  assert.deepEqual(Buffer.from(malformed, 'base64'), Buffer.from(encoded, 'base64'))
  assert.throws(() => decodeSvgUpload('data:image/svg+xml;base64,' + malformed), /base64/)
  assert.throws(() => decodeSvgUpload('data:image/svg+xml;base64,' + gzipSync(Buffer.from(svg('<rect/>'))).toString('base64')))
})
test('严格解析拒绝多根、根外残留、错误命名空间及非法UTF8，规范编码声明可用', () => {
  for (const source of [svg('<rect/>') + '<svg/>', 'junk' + svg('<rect/>'), svg('<rect/>') + 'junk', '<svg xmlns="http://not-svg.invalid"><rect/></svg>', '<?xml version="1.0" encoding="UTF-16"?>' + svg('<rect/>')]) assert.throws(() => sanitizeSvg(source))
  sanitizeSvg('<?xml version="1.0" encoding="UTF-8"?>' + svg('<rect/>'))
  for (const bytes of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xef, 0xbf]]) assert.throws(() => decodeSvgUpload('data:image/svg+xml;base64,' + Buffer.from(bytes).toString('base64')), /UTF-8/)
})
test('实体解码后再验证URL；正常预定义和数字转义只解码一次', () => {
  const result = sanitizeSvg(svg('<rect/><text>&lt;script&gt; &amp; &#x6587;</text><image href="&#x68;ttps://svg-test.invalid/a"/>')).bytes.toString()
  assert.match(result, /&lt;script&gt; &amp; 文/); assert.doesNotMatch(result, /svg-test/)
  assert.match(sanitizeSvg(svg('<text><![CDATA[fish & chips <literal>]]></text><!-- &custom; -->')).bytes.toString(), /fish &amp; chips &lt;literal&gt;/)
  for (const ref of ['&#0;', '&#xD800;', '&#x110000;', '&#xFFFF;']) assert.throws(() => sanitizeSvg(svg(`<text>${ref}</text>`)), /字符引用/)
})
test('输入字节、节点、深度及每元素/总属性均验证边界和加一；引号内尖括号不算节点', () => {
  const wrapper = svg('<rect/><!-- -->'), exact = wrapper.replace('<!-- -->', `<!--${'x'.repeat(svgLimits.bytes - Buffer.byteLength(wrapper) + 1)}-->`)
  assert.equal(Buffer.byteLength(exact), svgLimits.bytes)
  sanitizeSvg(exact); assert.throws(() => sanitizeSvg(exact + ' '), /2 MiB/)
  sanitizeSvg(svg('<rect/>'.repeat(9999))); assert.throws(() => sanitizeSvg(svg('<rect/>'.repeat(10000))), /nodes/)
  sanitizeSvg(svg('<g>'.repeat(62) + '<rect/>' + '</g>'.repeat(62)))
  assert.throws(() => sanitizeSvg(svg('<g>'.repeat(63) + '<rect/>' + '</g>'.repeat(63))), /深度/)
  const attrs = count => Array.from({ length: count }, (_, i) => ` a${i}="<not-a-tag>"`).join('')
  sanitizeSvg(svg(`<rect${attrs(64).replaceAll('<', '&lt;')}/>`))
  assert.throws(() => sanitizeSvg(svg(`<rect${attrs(65).replaceAll('<', '&lt;')}/>`)), /单元素/)
  const chunk = count => `<rect${Array.from({ length: count }, (_, i) => ` a${i}=""`).join('')}/>`
  const many = chunk(64).repeat(1562) + chunk(29)
  sanitizeSvg(svg(many)); assert.throws(() => sanitizeSvg(svg(many + '<rect a=""/>')), /attributes/)
  assert.doesNotThrow(() => preflightSvg(svg('<rect data="<g/><g/>"/>')))
})
test('实际DOM预算包含被移除子树和文本，不能借丢弃节点绕过额度', () => {
  assert.throws(() => sanitizeSvg(svg('<foreignObject>' + '<g/>text'.repeat(5000) + '</foreignObject><rect/>')), /nodes/)
  assert.throws(() => sanitizeSvg(svg('<title>' + '<g/>text'.repeat(5000) + '</title><rect/>')), /nodes/)
  assert.throws(() => sanitizeSvg(svg('<script id="same"/><rect id="same"/>')), /重复/)
  assert.throws(() => sanitizeSvg(svg('<defs><rect/></defs>')), /没有可绘制/)
})
test('路径字节、参数、有限数值/尺寸预算与加一', () => {
  const path = 'M0' + ' '.repeat(svgLimits.path - 5) + '0H1'
  sanitizeSvg(svg(`<path d="${path}"/>`))
  assert.throws(() => sanitizeSvg(svg(`<path d="${path.replace('M0', 'M0 ')}"/>`)), /path/)
  assert.throws(() => sanitizeSvg(svg(`<path d="M0 0${' '.repeat(svgLimits.path)}"/>`)), /path/)
  const parameters = 'M0 0' + 'H0'.repeat(99998)
  sanitizeSvg(svg(`<path d="${parameters}"/>`))
  assert.throws(() => sanitizeSvg(svg(`<path d="${parameters}H0"/>`)), /parameters/)
  assert.throws(() => sanitizeSvg(svg(`<defs><path id="many" d="M0 0${'H0'.repeat(59998)}"/></defs><use href="#many"/>`)), /parameters/)
  for (const d of ['M0 0H1e999', 'M0 0H1000001', 'M0 0 A1 1 0 2 1 3 3', 'M0 0H', 'L0 0']) assert.throws(() => sanitizeSvg(svg(`<path d="${d}"/>`)))
  sanitizeSvg(svg('<rect/>', 'width="16384" height="4096"'))
  for (const dimensions of ['width="16385" height="1"', 'width="16384" height="4097"', 'width="0"']) assert.throws(() => sanitizeSvg(svg('<rect/>', dimensions)), /尺寸/)
})
test('规范输出也独立受2MiB限制，XML属性引号转义不能扩张绕过输入额度', () => {
  const body = `<rect font-family='"face"'/><text>x</text>`
  const size = sanitizeSvg(svg(body)).bytes.length
  const exact = svg(body.replace('<text>', '<text>' + 'x'.repeat(svgLimits.bytes - size)))
  assert.equal(sanitizeSvg(exact).bytes.length, svgLimits.bytes)
  assert.throws(() => sanitizeSvg(exact.replace('<text>', '<text>x')), /净化结果/)
})
test('限额内密集CSS规范化后仍符合CSS预算，可反复净化且完全幂等', () => {
  const source = svg('<rect/><style>rect{' + 'fill:r;'.repeat(8000) + '}</style>')
  const result = sanitizeSvg(source)
  const style = new DOMParser().parseFromString(result.bytes.toString(), 'application/xml').getElementsByTagName('style')[0].textContent
  assert.ok(Buffer.byteLength(style) <= svgLimits.css)
  assert.deepEqual(sanitizeSvg(result.bytes.toString()).bytes, result.bytes)
})
test('引用深度边界及浅DOM长链：有限拒绝，不经过递归调用栈', t => {
  const chain = count => '<rect id="r0"/>' + Array.from({ length: count }, (_, i) => `<use id="r${i + 1}" href="#r${i}"/>`).join('')
  sanitizeSvg(svg(chain(32))); assert.throws(() => sanitizeSvg(svg(chain(33))), /引用深度/)
  const start = performance.now()
  assert.throws(() => sanitizeSvg(svg(chain(9900))), error => error.status === 400 && !(error instanceof RangeError))
  const elapsed = performance.now() - start
  assert.ok(elapsed < 5000, `9900引用拒绝不能阻塞数秒：${elapsed} ms`)
  t.diagnostic(`9900引用拒绝耗时 ${Math.round(elapsed)} ms`)
})
test('直接引用额度包含属性/CSS匹配，重复与指数use不做实际展开', () => {
  const defs = '<defs><linearGradient id="p"/></defs>', rect = '<rect fill="url(#p)" stroke="url(#p)"/>'
  sanitizeSvg(svg(defs + rect.repeat(5000)))
  assert.throws(() => sanitizeSvg(svg(defs + rect.repeat(5000) + '<rect fill="url(#p)"/>')), /references/)
  assert.throws(() => sanitizeSvg(svg(defs + '<style>rect{fill:url(#p);stroke:url(#p)}</style>' + '<rect/>'.repeat(5001))), /references/)
  const exponential = '<rect id="g0"/>' + Array.from({ length: 16 }, (_, i) => `<g id="g${i + 1}"><use href="#g${i}"/><use href="#g${i}"/></g>`).join('')
  assert.throws(() => sanitizeSvg(svg(exponential)), /展开/)
  const boundary = '<defs><g id="ten">' + '<rect/>'.repeat(10) + '</g></defs>' + '<use href="#ten"/>'.repeat(2082) + '<rect/>'.repeat(3)
  sanitizeSvg(svg(boundary)); assert.throws(() => sanitizeSvg(svg(boundary + '<rect/>')), /expanded/)
})
for (const context of ['path', 'g', 'css', 'use', 'polygon']) test(`marker重复绘制预算覆盖${context}、继承和闭合路径`, () => {
  const marker = '<defs><marker id="m">' + '<rect width="1" height="1"/>'.repeat(100) + '</marker><g id="tile"><path d="M0 0' + 'L1 1'.repeat(300) + '"/></g></defs>'
  const path = `<path d="M0 0${'L1 1'.repeat(300)}"/>`
  const body = context === 'path' ? path.replace('/>', ' marker-mid="url(#m)"/>') : context === 'g' ? `<g marker-mid="url(#m)">${path}</g>` : context === 'css' ? `<style>g{marker-mid:url(#m)}</style><g>${path}</g>` : context === 'use' ? '<use href="#tile" marker-mid="url(#m)"/>' : `<polygon points="${'0,0 '.repeat(301)}" marker-mid="url(#m)"/>`
  assert.throws(() => sanitizeSvg(svg(marker + body)), /展开/)
})
for (const context of ['attribute', 'css', 'use']) test(`渐变重复绘制预算覆盖${context}及其继承后代`, () => {
  const defs = '<defs><linearGradient id="p">' + '<stop/>'.repeat(500) + '</linearGradient><g id="tile">' + '<rect/>'.repeat(600) + '</g></defs>'
  const body = context === 'use' ? '<use href="#tile" fill="url(#p)"/>' : context === 'css' ? '<style>.paint{stroke:url(#p)}</style><g class="paint">' + '<rect/>'.repeat(600) + '</g>' : '<g fill="url(#p)">' + '<rect/>'.repeat(600) + '</g>'
  assert.throws(() => sanitizeSvg(svg(defs + body)), /展开/)
})
test('内嵌六栅格正例、字节/数量/像素预算及引用后像素成本', () => {
  const embed = file => `<image width="320" height="180" href="data:${file.mimeType};base64,${file.base64}"/>`
  for (const type of ['png', 'jpeg', 'webp', 'apng', 'avif']) assert.match(sanitizeSvg(svg(embed(rasterFiles[type]))).bytes.toString(), /data:image\//)
  assert.match(sanitizeSvg(svg(embed({ mimeType: 'image/gif', base64: animatedImage.split(',')[1] }))).bytes.toString(), /data:image\/gif/)
  sanitizeSvg(svg(embed(rasterFiles.png).repeat(16))); assert.throws(() => sanitizeSvg(svg(embed(rasterFiles.png).repeat(17))), /rasters/)
  const alias = embed(rasterFiles.png).replace(' href=', ` xlink:href="data:image/png;base64,${rasterFiles.png.base64}" href=`)
  sanitizeSvg(svg(alias.repeat(16), 'xmlns:xlink="http://www.w3.org/1999/xlink"'))
  const image = Buffer.from(rasterFiles.png.base64, 'base64'), large = Buffer.alloc(svgLimits.rasterBytes); image.copy(large)
  sanitizeSvg(svg(embed({ mimeType: 'image/png', base64: large.toString('base64') })))
  assert.throws(() => sanitizeSvg(svg(embed({ mimeType: 'image/png', base64: Buffer.concat([large, Buffer.from('x')]).toString('base64') }))), /rasterBytes/)
  image.writeUInt32BE(4096, 16); image.writeUInt32BE(4096, 20)
  image.writeUInt32BE(crc32(image.subarray(12, 29)), 29)
  const big = embed({ mimeType: 'image/png', base64: image.toString('base64') }).replace('<image ', '<image id="big" ')
  sanitizeSvg(svg(big)); assert.throws(() => sanitizeSvg(svg(big + '<use href="#big"/>')), /rasterPixels/)
  for (const href of ['data:text/html;base64,PHN2Zy8+', 'data:image/png;base64,@@@@', `data:image/jpeg;base64,${rasterFiles.png.base64}`]) assert.throws(() => sanitizeSvg(svg(`<image href="${href}"/>`)))
})
