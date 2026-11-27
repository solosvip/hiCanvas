import { createExternalClipboardContent, decodeClipboardContent, planUrlInsertion, EXTERNAL_CLIPBOARD_LIMITS as limits } from '../../engine/index.js'
import { hasClipboardType, parseExcalidrawClipboard } from './clipboard-excalidraw.js'
import { parseClipboardHtml } from './clipboard-html.js'
import { parseClipboardUrl } from './clipboard-url.js'

const byteLength = text => new TextEncoder().encode(text).length

// Internal content retains its original adapter and larger attachment budget.
// Only the sanitized content envelope leaves this host for the editing layer.
export function parseExternalClipboard(formats, { document } = {}) {
  if (decodeClipboardContent(formats)) return formats
  const plain = formats?.['text/plain'] ?? '', html = formats?.['text/html'] ?? ''
  if (typeof plain !== 'string' || typeof html !== 'string') throw new Error('剪贴板格式需要文字数据。')
  if (hasClipboardType(plain, 'hicanvas/clipboard')) throw new Error('内部剪贴板 JSON 无效。')
  if (/<(?:div|span)\s+data-tldraw(?:\s|=|>)/i.test(html)) throw new Error('暂不支持旧版 data-tldraw 复制格式。')
  if (byteLength(plain) + byteLength(html) > limits.totalBytes || byteLength(html) > limits.htmlBytes) throw new Error('外部剪贴板内容超过大小上限。')
  const excal = parseExcalidrawClipboard(plain)
  if (excal) return { kind: 'external-content', placement: 'viewport-page', content: createExternalClipboardContent(excal.data), notice: excal.notice }
  if (byteLength(plain) > limits.plainBytes) throw new Error('外部纯文本超过大小上限。')
  const address = parseClipboardUrl({ 'text/plain': plain, 'text/html': html }, { document })
  if (address) return { kind: 'external-content', placement: 'viewport-page', content: createExternalClipboardContent(address), notice: planUrlInsertion(address.url, address).notice }
  const richText = html ? parseClipboardHtml(html, document) : { type: 'doc', content: plain.replace(/\r\n?/g, '\n').split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) }
  return { kind: 'external-content', placement: 'default', content: createExternalClipboardContent({ type: 'text', richText }), notice: null }
}
