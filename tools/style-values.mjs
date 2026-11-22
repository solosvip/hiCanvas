import { parse as parseJs } from '@babel/parser'
import postcss from 'postcss'

function containsLiteral(value, property = '') {
  const withoutTokens = String(value).replace(/var\([^)]*\)/g, '')
  return /#[\da-f]{3,8}\b|(?:rgb|hsl)a?\(|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|pt|%)\b/i.test(withoutTokens)
    || /^\s*-?[\d.]+(?:\s|$)/.test(withoutTokens)
    || (/(?:color|fill|stroke|background)$/i.test(property)
      && withoutTokens.trim() !== ''
      && !/^(?:none|transparent|currentColor|inherit|initial|unset)$/i.test(withoutTokens.trim()))
}

// 只检查界面样式；画板记录中的坐标、比例、形状颜色是用户数据。
export function styleLiterals(path, source) {
  const values = []
  if (path.endsWith('.css')) {
    postcss.parse(source).walkDecls(declaration => {
      if (containsLiteral(declaration.value, declaration.prop)) values.push(`${declaration.prop}:${declaration.value}`)
    })
  } else if (/\.[jt]sx$/.test(path)) {
    const visit = (node, inStyle = false) => {
      if (!node || typeof node !== 'object') return
      const style = inStyle || (node.type === 'JSXAttribute' && node.name?.name === 'style')
      if (style && node.type === 'ObjectProperty') {
        const key = node.key.name ?? node.key.value ?? ''
        if (node.value.type === 'NumericLiteral' || (node.value.type === 'StringLiteral' && containsLiteral(node.value.value, key))) {
          values.push(`${key}:${node.value.value}`)
        }
      }
      for (const [key, child] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'extra', 'comments'].includes(key)) continue
        if (Array.isArray(child)) child.forEach(item => visit(item, style))
        else if (child && typeof child === 'object') visit(child, style)
      }
    }
    visit(parseJs(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] }))
  }
  return values.sort()
}

export function addedStyleLiterals(current, baseline = []) {
  const available = new Map()
  baseline.forEach(value => available.set(value, (available.get(value) ?? 0) + 1))
  return current.filter(value => {
    const count = available.get(value) ?? 0
    if (count > 0) { available.set(value, count - 1); return false }
    return true
  })
}
