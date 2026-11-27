import { httpError } from './file-lock.mjs'

export const svgLimits = Object.freeze({ bytes: 2 * 1024 * 1024, nodes: 10000, depth: 64, attributes: 100000, perElement: 64, css: 65536, rules: 1000, declarations: 10000, path: 262144, parameters: 100000, references: 10000, referenceDepth: 32, expanded: 25000, rasterBytes: 1048576, rasterPixels: 16 * 1024 * 1024, rasters: 16 })
export const svgError = message => { throw httpError(`SVG ${message}。`) }
export function charge(budget, key, amount = 1) {
  budget[key] = (budget[key] || 0) + amount
  if (!Number.isSafeInteger(budget[key]) || budget[key] > svgLimits[key]) svgError(`${key} 超出限制`)
}
function entities(source) {
  const pattern = /&(?:amp|lt|gt|quot|apos|#([0-9]+)|#x([0-9a-fA-F]+));/y
  for (let position = source.indexOf('&'); position >= 0; position = source.indexOf('&', pattern.lastIndex)) {
    pattern.lastIndex = position
    const match = pattern.exec(source)
    if (!match) svgError('不接受自定义实体')
    if (match[1] || match[2]) {
      const code = Number.parseInt(match[1] || match[2], match[1] ? 10 : 16)
      if (![9, 10, 13].includes(code) && !(code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff)) svgError('字符引用无效')
    }
  }
}

// A quote/comment-aware linear quota pass, not an XML parser or sanitizer.
// It bounds the parser's input tree before allowing the real XML parser to run.
export function preflightSvg(source) {
  if (!source || Buffer.byteLength(source) > svgLimits.bytes) svgError('需要非空且不超过 2 MiB')
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(source)) svgError('包含非法字符')
  let position = 0, depth = 0
  const budget = {}
  while (position < source.length) {
    const start = source.indexOf('<', position)
    entities(source.slice(position, start < 0 ? undefined : start))
    if (start < 0) break
    let terminator
    if (source.startsWith('<!--', start)) terminator = '-->'
    else if (source.startsWith('<![CDATA[', start)) terminator = ']]>'
    else if (source.startsWith('<?', start)) terminator = '?>'
    if (terminator) {
      const end = source.indexOf(terminator, start + 2)
      if (end < 0) svgError('XML 未闭合')
      if (terminator === '?>') {
        const declaration = source.slice(start + 2, end)
        if (/^xml\s/i.test(declaration)) {
          const encoding = /\sencoding\s*=\s*(['"])([^'"]*)\1/i.exec(declaration)
          if (encoding && encoding[2].toUpperCase() !== 'UTF-8') svgError('只接受 UTF-8')
        }
      }
      charge(budget, 'nodes'); position = end + terminator.length; continue
    }
    if (source.startsWith('<!', start)) svgError('不接受 DTD 或实体声明')
    let quote = '', end = start + 1, attributes = 0
    for (; end < source.length; end++) {
      const character = source[end]
      if (quote) { if (character === quote) quote = ''; continue }
      if (character === '"' || character === "'") quote = character
      else if (character === '=') attributes++
      else if (character === '>') break
    }
    if (end === source.length) svgError('XML 未闭合')
    entities(source.slice(start, end))
    if (attributes > svgLimits.perElement) svgError('单元素属性超出限制')
    charge(budget, 'attributes', attributes)
    if (source[start + 1] === '/') { if (--depth < 0) svgError('XML 嵌套无效') }
    else {
      charge(budget, 'nodes')
      if (++depth > svgLimits.depth) svgError('嵌套深度超出限制')
      if (source[end - 1] === '/') depth--
    }
    position = end + 1
  }
  if (depth) svgError('XML 嵌套无效')
}
