import { CanvasEditError } from '../errors.js'

export const MAX_CLIPBOARD_FILES = 256
export const MAX_CLIPBOARD_FILE_BYTES = 20 * 1024 * 1024
export const MAX_CLIPBOARD_RESOURCE_BYTES = 24 * 1024 * 1024

export function validateClipboardResources(resources) {
  if (resources.length > MAX_CLIPBOARD_FILES) throw new CanvasEditError('剪贴板资源数量超过上限。')
  const urls = new Set()
  let total = 0
  for (const resource of resources) {
    if (!resource || typeof resource.url !== 'string' || !resource.url.startsWith('/') || resource.url.startsWith('//') || /[?#\0\r\n]/.test(resource.url) || urls.has(resource.url)) throw new CanvasEditError('剪贴板资源引用重复或无效。')
    urls.add(resource.url)
    if (typeof resource.mimeType !== 'string' || !/^[a-z]+\/[a-z0-9.+-]+(?:;\s*charset=[a-z0-9-]+)?$/i.test(resource.mimeType)) throw new CanvasEditError('剪贴板资源格式无效。')
    const data = resource.data
    if (typeof data !== 'string' || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new CanvasEditError('剪贴板资源字节无效。')
    const bytes = data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
    total += bytes
    if (bytes > MAX_CLIPBOARD_FILE_BYTES || total > MAX_CLIPBOARD_RESOURCE_BYTES) throw new CanvasEditError('剪贴板资源字节超过上限。')
  }
}
