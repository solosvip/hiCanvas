import postcss from 'postcss'
import { presentation, elementAttributes, identifier, attributeValue } from './svg-values.mjs'
import { charge, svgError } from './svg-budget.mjs'

export function matchesSvgSelector(node, selector) {
  if (selector[0] === '#') return node.id === selector.slice(1)
  if (selector[0] === '.') return node.classes.includes(selector.slice(1))
  return node.tag === selector
}
const selectorAllowed = value => value[0] === '#' || value[0] === '.' ? identifier.test(value.slice(1)) : elementAttributes.has(value)

export function sanitizeSvgStyles(source, { inline = false, budget, warn }) {
  charge(budget, 'css', Buffer.byteLength(source))
  let tree
  try { tree = postcss.parse(inline ? `__inline{${source}}` : source, { from: undefined, map: false }) }
  catch { svgError('CSS 语法无效') }
  if (inline && (tree.nodes.length !== 1 || tree.first.type !== 'rule' || tree.first.selector !== '__inline')) svgError('style 属性语法无效')
  const pending = [...tree.nodes]
  while (pending.length) {
    const node = pending.pop()
    if (node.type === 'rule' || node.type === 'atrule') charge(budget, 'rules')
    if (node.type === 'decl') charge(budget, 'declarations')
    if (node.nodes) pending.push(...node.nodes)
  }
  const rules = []
  for (const node of tree.nodes) {
    if (node.type === 'comment') continue
    if (node.type !== 'rule') { warn('已移除 CSS @规则'); continue }
    const selectors = inline ? [] : node.selector.split(',').map(value => value.trim())
    if (!inline && (!selectors.length || selectors.length > 8 || !selectors.every(selectorAllowed))) { warn('已移除不支持的 CSS 选择器'); continue }
    const declarations = []
    for (const child of node.nodes) {
      if (child.type === 'comment') continue
      if (child.type !== 'decl') { warn('已移除嵌套 CSS'); continue }
      const property = child.prop
      const safe = presentation.has(property) && attributeValue('css', property, child.value)
      if (!safe) { warn('已移除不支持的 CSS 属性或值'); continue }
      declarations.push({ property, ...safe, important: Boolean(child.important) })
    }
    rules.push({ selectors, declarations })
  }
  return {
    rules,
    render() {
      const root = postcss.root()
      for (const rule of rules) {
        const result = postcss.rule({ selector: inline ? '__inline' : rule.selectors.join(','), raws: { before: '', between: '', after: '', semicolon: true } })
        for (const item of rule.declarations) if (!item.removed) result.append(postcss.decl({ prop: item.property, value: item.value, important: item.important, raws: { before: '', between: ':', important: '!important' } }))
        if (result.nodes.length) root.append(result)
      }
      return inline ? root.first?.nodes.map(node => node.toString()).join(';') || '' : root.toString()
    },
  }
}
