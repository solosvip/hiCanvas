import { EXTERNAL_CLIPBOARD_LIMITS as limits } from '../../engine/index.js'

const htmlNamespace = 'http://www.w3.org/1999/xhtml'
const discard = new Set(['script', 'style', 'base', 'meta', 'link', 'img', 'object', 'embed', 'audio', 'video', 'canvas', 'template', 'noscript', 'input', 'textarea', 'select', 'button'])
const unsupported = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'mark', 'u', 's', 'strike', 'del', 'sub', 'sup', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'hr', 'bdi', 'bdo'])

function allowedLink(value) {
  if (!value || /[\u0000-\u0020\u007f]/u.test(value)) return false
  try { return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol) }
  catch { return false }
}

export function parseClipboardHtml(html, document) {
  if (!document?.implementation?.createHTMLDocument) throw new Error('HTML 粘贴需要浏览器净化。')
  // A template owned by a document WITHOUT a browsing context. No original
  // node or string is ever appended to the live page; we rebuild JSON only.
  const inert = document.implementation.createHTMLDocument('')
  if (inert.defaultView) throw new Error('HTML 净化文档必须没有浏览上下文。')
  const template = inert.createElement('template')
  template.innerHTML = html
  const stack = [[template.content, 0]]
  let nodes = 0
  while (stack.length) {
    const [node, depth] = stack.pop()
    if (++nodes > limits.htmlNodes || depth > limits.depth) throw new Error('HTML 节点或深度超过上限。')
    if (node.nodeType === 1 && node.hasAttribute('data-tldraw')) throw new Error('暂不支持旧版 data-tldraw 复制格式。')
    for (const child of node.childNodes) stack.push([child, depth + 1])
    if (node.nodeType === 1 && node.localName === 'template') stack.push([node.content, depth + 1])
    if (stack.length + nodes > limits.htmlNodes) throw new Error('HTML 节点超过上限。')
  }
  const paragraphs = []
  let current = null, pendingSpace = null
  const paragraph = dir => current ||= { type: 'paragraph', attrs: { dir }, content: [] }
  const flush = () => { if (current) paragraphs.push(current); current = null; pendingSpace = null }
  const append = (value, marks, dir) => paragraph(dir).content.push({ type: 'text', text: value, ...(marks.length && { marks: marks.map(type => ({ type })) }) })
  const appendText = (value, marks, dir) => {
    // Source indentation is not a paragraph. Collapse HTML ASCII whitespace
    // across mark/wrapper boundaries; NBSP and explicit br remain content.
    let valueText = value.replace(/[\t\n\f\r ]+/g, ' ')
    const lineStart = !current?.content.length || current.content.at(-1).type === 'hardBreak'
    if (valueText.startsWith(' ')) {
      if (!lineStart && !pendingSpace) pendingSpace = [...marks]
      valueText = valueText.slice(1)
    }
    const trailing = valueText.endsWith(' ')
    if (trailing) valueText = valueText.slice(0, -1)
    if (valueText) {
      if (pendingSpace && !lineStart) append(' ', pendingSpace, dir)
      append(valueText, marks, dir)
      pendingSpace = trailing ? [...marks] : null
    }
  }
  const visit = (node, marks = [], inheritedDir = 'auto') => {
    if (node.nodeType === 3) {
      if (node.data) appendText(node.data, marks, inheritedDir)
      return
    }
    if (node.nodeType !== 1 || node.namespaceURI !== htmlNamespace) return
    const tag = node.localName
    if (tag === 'iframe') throw new Error('网页嵌入的粘贴入口由 #138 提供。')
    if (discard.has(tag)) return
    if (unsupported.has(tag)) throw new Error('这种 HTML 文字格式需要 #150 支持。')
    const dir = node.getAttribute('dir')?.toLowerCase() || inheritedDir
    if (dir === 'rtl') throw new Error('从右往左的文字需要 #150 支持。')
    if (!['auto', 'ltr'].includes(dir)) throw new Error('HTML 文字方向无效。')
    if (tag === 'a' && allowedLink(node.getAttribute('href'))) throw new Error('链接格式需要 #150 支持。')
    if (tag === 'br') { pendingSpace = null; paragraph(dir).content.push({ type: 'hardBreak' }); return }
    const block = ['p', 'div'].includes(tag)
    if (block) flush()
    const before = paragraphs.length
    const mark = ['strong', 'b'].includes(tag) ? 'bold' : ['em', 'i'].includes(tag) ? 'italic' : null
    const nextMarks = mark && !marks.includes(mark) ? [...marks, mark] : marks
    for (const child of node.childNodes) visit(child, nextMarks, dir)
    if (block) {
      if (tag === 'p' && !current && before === paragraphs.length) paragraph(dir)
      flush()
    }
  }
  for (const node of template.content.childNodes) visit(node)
  flush()
  return { type: 'doc', attrs: { dir: 'auto' }, content: paragraphs }
}
