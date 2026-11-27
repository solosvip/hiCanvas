import { normalizeHttpUrl } from '../model/index.js'
import { CanvasEditError } from './errors.js'

// These URLs are annotations. Bookmark and embed URLs are content addresses.
export const supportsShapeLink = shape => shape?.typeName === 'shape' && ['geo', 'note', 'image', 'video'].includes(shape.type)

export function checkedShapeLink(value) {
  if (typeof value !== 'string') throw new CanvasEditError('链接需要文字网址，清除请传空串。')
  if (!value.trim()) return ''
  const url = normalizeHttpUrl(value)
  if (!url) throw new CanvasEditError('请输入不带凭据和非默认端口的有效 HTTP(S) 网址。')
  return url
}
