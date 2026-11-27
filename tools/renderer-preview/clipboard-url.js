import { normalizeHttpUrl } from '../../model/index.js'
import { EXTERNAL_CLIPBOARD_LIMITS as limits } from '../../engine/index.js'

function iframeUrl(html, document) {
  if (!document?.implementation?.createHTMLDocument) throw new Error('iframe 粘贴需要浏览器惰性解析。')
  const inert = document.implementation.createHTMLDocument('')
  if (inert.defaultView) throw new Error('iframe 解析文档必须没有浏览上下文。')
  const template = inert.createElement('template')
  template.innerHTML = html
  const stack = [[template.content, 0]]
  let count = 0
  while (stack.length) {
    const [node, depth] = stack.pop()
    if (++count > limits.htmlNodes || depth > limits.depth) throw new Error('iframe HTML 超过结构上限。')
    for (const child of node.childNodes) stack.push([child, depth + 1])
    if (node.nodeType === 1 && node.localName === 'template') stack.push([node.content, depth + 1])
    if (stack.length + count > limits.htmlNodes) throw new Error('iframe HTML 超过结构上限。')
  }
  const nodes = [...template.content.childNodes].filter(node => node.nodeType !== 8 && !(node.nodeType === 3 && !node.data.trim()))
  const frame = nodes[0]
  if (nodes.length !== 1 || frame?.nodeType !== 1 || frame.localName !== 'iframe' || frame.namespaceURI !== 'http://www.w3.org/1999/xhtml' || frame.textContent.trim()) throw new Error('请只粘贴一个独立 iframe；不能混有其他代码。')
  // The inert source is never appended to a live document. No attribute other
  // than src leaves this parser: input sizes/permissions/srcdoc are discarded.
  const url = normalizeHttpUrl(frame.getAttribute('src'))
  if (!url) throw new Error('iframe src 必须是完整的 HTTP(S) 网址。')
  return { type: 'url', url, source: 'iframe' }
}

export function parseClipboardUrl({ 'text/plain': plain = '', 'text/html': html = '' }, { document } = {}) {
  const markup = html || plain
  if (/<iframe[\s/>]/i.test(markup)) return iframeUrl(markup, document)
  if (!/^https?:\/\/\S+$/i.test(plain.trim())) return null
  const url = normalizeHttpUrl(plain)
  if (!url) throw new Error('网址无效、包含凭据或超过大小上限。')
  return { type: 'url', url, source: 'url' }
}
