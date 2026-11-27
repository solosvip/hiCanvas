import { normalizeHttpUrl, resolveEmbedUrl } from '../model/index.js'
import { CanvasEditError } from './errors.js'

// A pure plan: no metadata fetch, browser node or frame permissions cross this
// seam. Only the existing renderer constructor can grant iframe capabilities.
export function planUrlInsertion(value, { source = 'url', serviceId = null } = {}) {
  if (!['url', 'iframe', 'dialog'].includes(source)) throw new CanvasEditError('未知网址插入来源。')
  const url = normalizeHttpUrl(value)
  if (!url) throw new CanvasEditError('请输入不带凭据的完整 HTTP(S) 网址。')
  const embed = resolveEmbedUrl(url)
  if (source === 'dialog' && (!embed || embed.id !== serviceId)) throw new CanvasEditError('网址与所选嵌入服务不匹配。')
  // The isolated legacy paste probe intentionally creates a bookmark for a
  // tldraw URL; the explicit iframe/dialog entry still creates its embed.
  const useEmbed = embed && !(source === 'url' && embed.id === 'G05')
  const notice = source === 'iframe' && !useEmbed ? Object.freeze({ source: 'clipboard', message: '此网址已作为书签插入；只有支持的 HTTPS 服务可以嵌入。', counts: Object.freeze({ bookmarkFallbacks: 1 }) }) : null
  return Object.freeze({ type: useEmbed ? 'embed' : 'bookmark', url: useEmbed ? embed.url : url,
    size: useEmbed ? embed.size : Object.freeze([300, 46]), serviceId: useEmbed ? embed.id : null, notice })
}

export function planUrlConversion(shape, to) {
  if (!['bookmark', 'embed'].includes(to) || !['bookmark', 'embed'].includes(shape?.type) || shape.type === to) throw new CanvasEditError('需要在书签和外部嵌入之间转换。')
  if (shape.meta?.cowartHtmlDraft === true || shape.meta?.cowartHtmlDraftAssetUrl || !normalizeHttpUrl(shape.props.url)) throw new CanvasEditError('生成内容不能转换为外部网址。')
  if (to === 'bookmark') return Object.freeze({ type: to, url: normalizeHttpUrl(shape.props.url), size: Object.freeze([300, 46]) })
  const embed = resolveEmbedUrl(shape.props.url)
  if (!embed) throw new CanvasEditError('此书签没有可用的嵌入服务。')
  return Object.freeze({ type: to, url: embed.url, size: embed.size })
}
