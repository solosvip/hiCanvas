import { CanvasEditError } from '../errors.js'
import { clipboardJson, validateClipboardContent, MAX_CLIPBOARD_BYTES } from './validate.js'

const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const unescape = text => text.replace(/&(amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity])

export function encodeClipboardContent(content) {
  const json = clipboardJson(validateClipboardContent(content))
  return { 'text/plain': json, 'text/html': `<div data-hicanvas-clipboard="1">${escape(json)}</div>` }
}

// This recognizes only our own marker/type. External HTML/text and legacy
// data-tldraw payloads belong to #176, rather than an implicit fallback here.
export function decodeClipboardContent(formats) {
  if (!formats || typeof formats !== 'object') return null
  const html = formats['text/html'], plain = formats['text/plain']
  const marked = typeof html === 'string' && html.includes('data-hicanvas-clipboard')
  let json = plain
  if (marked) {
    if (html.length > MAX_CLIPBOARD_BYTES * 6) throw new CanvasEditError('剪贴板内容超过大小上限。')
    const match = html.match(/^\s*<div data-hicanvas-clipboard="1">([\s\S]*)<\/div>\s*$/)
    if (!match) throw new CanvasEditError('内部剪贴板HTML封装无效。')
    json = unescape(match[1])
  }
  if (typeof json !== 'string') return null
  if (new TextEncoder().encode(json).length > MAX_CLIPBOARD_BYTES) throw new CanvasEditError('剪贴板内容超过大小上限。')
  let value
  try { value = JSON.parse(json) } catch {
    if (marked) throw new CanvasEditError('内部剪贴板JSON无效。')
    return null
  }
  if (!marked && value?.type !== 'hicanvas/clipboard') return null
  return validateClipboardContent(value)
}
