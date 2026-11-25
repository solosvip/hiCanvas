// Independent plain-text layout: formatting is deliberately discarded. Explicit
// line widths let the DOM renderer and Node hit testing share the same bounds.
export function plainText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content || []).map(plainText).join(node.type === 'doc' ? '\n' : '')
}

export function textLayout(props) {
  const size = { s: 16, m: 20, l: 28, xl: 36 }[props.size] || 20
  const unit = size * 0.6, scale = props.scale || 1
  const width = Math.max(unit * 2, props.w || 100)
  const lines = []
  for (const paragraph of plainText(props.richText).split('\n')) {
    let text = '', length = 0
    for (const char of paragraph) {
      const advance = unit * (char.codePointAt(0) > 255 ? 2 : 1)
      if (length + advance > width && text) { lines.push({ text, width: length }); text = ''; length = 0 }
      text += char; length += advance
    }
    lines.push({ text, width: length })
  }
  return { size, scale, lines, lineHeight: size * 1.25, w: width * scale, h: lines.length * size * 1.25 * scale }
}
