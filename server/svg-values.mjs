import { svgError } from './svg-budget.mjs'

export const svgNamespace = 'http://www.w3.org/2000/svg'
export const identifier = /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/
const numberSource = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?'
const numberPattern = new RegExp(`^${numberSource}$`)
const lengthPattern = new RegExp(`^(${numberSource})(px|%|in|cm|mm|pt|pc)?$`)
const referencePattern = /^url\(\s*(['"]?)#([A-Za-z_][A-Za-z0-9_-]{0,127})\1\s*\)$/
const list = value => value.trim().split(/[\s,]+/)
export const validNumber = value => numberPattern.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1000000
export function numberList(value, minimum = 1, maximum = 100000) {
  const values = list(value)
  return values.length >= minimum && values.length <= maximum && values.every(validNumber) ? values : null
}
export function lengthValue(value, nonnegative = false) {
  const match = lengthPattern.exec(value)
  return match && validNumber(match[1]) && (!nonnegative || Number(match[1]) >= 0) ? value : null
}
export function pixelLength(value) {
  const match = lengthPattern.exec(value || '')
  const factors = { '': 1, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16 }
  return match && match[2] !== '%' ? Number(match[1]) * factors[match[2] || ''] : null
}
const geometry = 'x y width height'
export const elementAttributes = new Map(Object.entries({
  svg: `${geometry} viewBox preserveAspectRatio`, g: '', defs: '', symbol: 'width height viewBox preserveAspectRatio', title: '', desc: '',
  path: 'd pathLength', rect: `${geometry} rx ry pathLength`, circle: 'cx cy r pathLength', ellipse: 'cx cy rx ry pathLength', line: 'x1 y1 x2 y2 pathLength', polyline: 'points pathLength', polygon: 'points pathLength',
  text: 'x y dx dy textLength lengthAdjust', tspan: 'x y dx dy textLength lengthAdjust',
  use: `${geometry} href`, image: `${geometry} href preserveAspectRatio`,
  linearGradient: 'x1 y1 x2 y2 gradientUnits gradientTransform spreadMethod href', radialGradient: 'cx cy r fx fy fr gradientUnits gradientTransform spreadMethod href', stop: 'offset stop-color stop-opacity',
  clipPath: 'clipPathUnits', mask: `${geometry} maskUnits maskContentUnits mask-type`,
  marker: 'markerWidth markerHeight refX refY orient markerUnits viewBox preserveAspectRatio', style: '',
}).map(([tag, values]) => [tag, new Set(values.split(' ').filter(Boolean))]))
export const presentation = new Set(('transform color fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity clip-rule clip-path mask display visibility font-family font-size font-style font-weight text-anchor dominant-baseline letter-spacing word-spacing marker-start marker-mid marker-end stop-color stop-opacity mask-type').split(' '))
const enumerations = {
  'fill-rule': ['nonzero', 'evenodd'], 'clip-rule': ['nonzero', 'evenodd'], 'stroke-linecap': ['butt', 'round', 'square'], 'stroke-linejoin': ['miter', 'round', 'bevel'],
  display: ['inline', 'none'], visibility: ['visible', 'hidden', 'collapse'], 'font-style': ['normal', 'italic', 'oblique'], 'text-anchor': ['start', 'middle', 'end'],
  'dominant-baseline': ['auto', 'middle', 'central', 'alphabetic', 'hanging', 'text-before-edge', 'text-after-edge'], 'mask-type': ['luminance', 'alpha'],
  gradientUnits: ['userSpaceOnUse', 'objectBoundingBox'], clipPathUnits: ['userSpaceOnUse', 'objectBoundingBox'], maskUnits: ['userSpaceOnUse', 'objectBoundingBox'], maskContentUnits: ['userSpaceOnUse', 'objectBoundingBox'], spreadMethod: ['pad', 'reflect', 'repeat'], lengthAdjust: ['spacing', 'spacingAndGlyphs'], markerUnits: ['strokeWidth', 'userSpaceOnUse'],
}
const urlKinds = { fill: ['linearGradient', 'radialGradient'], stroke: ['linearGradient', 'radialGradient'], 'clip-path': ['clipPath'], mask: ['mask'], 'marker-start': ['marker'], 'marker-mid': ['marker'], 'marker-end': ['marker'] }
export function referenceValue(name, value, tag) {
  if (name === 'href') {
    if (!value.startsWith('#') || !identifier.test(value.slice(1))) return null
    return { value, reference: { id: value.slice(1), kinds: tag === 'use' ? ['svg', 'symbol', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'use'] : ['linearGradient', 'radialGradient'] } }
  }
  const match = referencePattern.exec(value)
  return match && urlKinds[name] ? { value: `url(#${match[2]})`, reference: { id: match[2], kinds: urlKinds[name], marker: name.startsWith('marker-') ? name.slice(7) : null, paint: ['fill', 'stroke'].includes(name) } } : null
}
function color(value) {
  if (/^(?:[a-zA-Z]+|context-fill|context-stroke|#[\da-fA-F]{3,4}|#[\da-fA-F]{6}|#[\da-fA-F]{8})$/.test(value)) return value
  const match = /^(rgb|rgba|hsl|hsla)\(([^()]*)\)$/.exec(value)
  if (!match) return null
  const parts = match[2].split(/\s*,\s*/)
  return parts.length === (match[1].endsWith('a') ? 4 : 3) && parts.every(part => validNumber(part.replace(/%$/, ''))) ? value : null
}
function transform(value) {
  const arity = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] }
  let position = 0, count = 0
  const pattern = /([a-zA-Z]+)\(([^()]*)\)/g
  for (const match of value.matchAll(pattern)) {
    if (!/^[\s,]*$/.test(value.slice(position, match.index)) || !arity[match[1]]) return null
    const values = numberList(match[2], 1, 6)
    if (!values || !arity[match[1]].includes(values.length) || ++count > 64) return null
    position = match.index + match[0].length
  }
  return count && /^\s*$/.test(value.slice(position)) ? value : null
}

// Validate complete path tokens/arity, including implicit repeated segments.
// Return a conservative vertex count for marker drawing, never expand it.
export function pathCost(value) {
  const arity = { m: 2, z: 0, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 }
  const pattern = new RegExp(`[MmZzLlHhVvCcSsQqTtAa]|${numberSource}`, 'g')
  let position = 0, command, group = [], parameters = 0, vertices = 0, paths = 0
  const flush = () => {
    if (!command || !arity[command] || !group.length || group.length % arity[command]) svgError('路径参数无效')
    if (command === 'a') for (let i = 0; i < group.length; i += 7) if (Number(group[i]) < 0 || Number(group[i + 1]) < 0 || !['0', '1'].includes(group[i + 3]) || !['0', '1'].includes(group[i + 4])) svgError('圆弧参数无效')
    vertices += group.length / arity[command]; if (command === 'm') paths++
    group = []
  }
  for (const match of value.matchAll(pattern)) {
    if (!/^[\s,]*$/.test(value.slice(position, match.index))) svgError('路径内容无效')
    position = match.index + match[0].length
    if (/^[a-zA-Z]$/.test(match[0])) {
      if (group.length) flush()
      else if (command && command !== 'z') svgError('路径缺少参数')
      command = match[0].toLowerCase()
      if (!vertices && command !== 'm') svgError('路径必须从移动开始')
      if (command === 'z') vertices++
    } else {
      if (!command || command === 'z' || !validNumber(match[0])) svgError('路径数值无效')
      group.push(match[0]); parameters++
    }
  }
  if (group.length) flush(); else if (command !== 'z') svgError('路径缺少参数')
  if (!/^\s*$/.test(value.slice(position))) svgError('路径内容无效')
  return { parameters, vertices, paths }
}
export function attributeValue(tag, name, raw) {
  const value = raw.trim()
  if (/[\\\u0000-\u001f]|\/\*|\*\//.test(value)) return null
  if (name === 'id') return identifier.test(value) ? { value } : null
  if (name === 'class') return list(value).length <= 64 && list(value).every(x => identifier.test(x)) ? { value: list(value).join(' ') } : null
  if (name === 'xml:space') return ['default', 'preserve'].includes(value) ? { value } : null
  if (name === 'href' || urlKinds[name] && /^url\(/i.test(value)) return referenceValue(name, value, tag)
  let result
  if (enumerations[name]) result = enumerations[name].includes(value) ? value : null
  else if (name === 'viewBox') { const numbers = numberList(value, 4, 4); result = numbers && Number(numbers[2]) > 0 && Number(numbers[3]) > 0 ? value : null }
  else if (name === 'preserveAspectRatio') result = /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(value) ? value : null
  else if (name === 'transform' || name === 'gradientTransform') result = transform(value)
  else if (name === 'd') { pathCost(value); result = value }
  else if (name === 'points') { const values = numberList(value, 2); result = values && values.length % 2 === 0 ? value : null }
  else if (['fill', 'stroke', 'color', 'stop-color'].includes(name)) result = color(value)
  else if (/opacity$/.test(name)) result = validNumber(value) && Number(value) >= 0 && Number(value) <= 1 ? value : null
  else if (name === 'font-family') result = value.length <= 256 && /^[\p{L}\p{N} _,'"-]+$/u.test(value) ? value : null
  else if (name === 'font-weight') result = /^(?:normal|bold|[1-9]00)$/.test(value) ? value : null
  else if (name === 'stroke-dasharray') result = value === 'none' || numberList(value)?.every(n => Number(n) >= 0) ? value : null
  else if (name === 'offset') result = /%$/.test(value) ? validNumber(value.slice(0, -1)) && Number(value.slice(0, -1)) >= 0 && Number(value.slice(0, -1)) <= 100 ? value : null : validNumber(value) && Number(value) >= 0 && Number(value) <= 1 ? value : null
  else if (name === 'orient') result = ['auto', 'auto-start-reverse'].includes(value) || validNumber(value.replace(/(?:deg|rad|grad|turn)$/, '')) ? value : null
  else if (urlKinds[name]) result = value === 'none' ? value : null
  else if (['x', 'y', 'dx', 'dy'].includes(name) && ['text', 'tspan'].includes(tag)) result = list(value).every(x => lengthValue(x)) ? value : null
  else if (['letter-spacing', 'word-spacing'].includes(name) && value === 'normal') result = value
  else result = lengthValue(value, ['width', 'height', 'r', 'rx', 'ry', 'fr', 'font-size', 'markerWidth', 'markerHeight', 'textLength', 'stroke-width', 'pathLength'].includes(name))
  return result === null || result === undefined ? null : { value: result }
}
