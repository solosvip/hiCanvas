import { CanvasEditError } from '../errors.js'
import { createShape } from './create-shape.js'
import { getMediaTarget } from '../media-target.js'

function checkedVideo(video) {
  if (!video || ![video.w, video.h].every(n => Number.isFinite(n) && n > 0 && n <= 16384) || !['video/mp4', 'video/webm', 'video/quicktime'].includes(video.mimeType)) throw new CanvasEditError('视频需要有效尺寸和支持的类型。')
  let parts
  try { parts = video.src.split('/').map(decodeURIComponent) } catch { throw new CanvasEditError('视频需要有效本机资源路径。') }
  if (!/^\/(?:assets\/[^/]+|page-assets\/[^/]+\/[^/]+|c\/[^/]+\/(?:assets\/[^/]+|page-assets\/[^/]+\/[^/]+))$/.test(video.src) || parts.slice(1).some(p => !p || p === '.' || p === '..' || /[\\/\u0000?#]/.test(p))) throw new CanvasEditError('视频需要画板资料内的本机资源路径。')
  return { name: video.name || 'Video', src: video.src, w: video.w, h: video.h, mimeType: video.mimeType, isAnimated: true, ...(Number.isSafeInteger(video.fileSize) && video.fileSize >= 0 && { fileSize: video.fileSize }) }
}
function putAsset(store, video) {
  const props = checkedVideo(video), id = `asset:${globalThis.crypto.randomUUID()}`
  store.put([{ id, typeName: 'asset', type: 'video', props, meta: {} }])
  return id
}
export function insertVideo(store, { args = {}, video }) {
  const { pageId } = getMediaTarget({ store: Object.fromEntries(store.allRecords().map(r => [r.id, r])) }, { pageId: args.pageId })
  const assetId = putAsset(store, video), shapeId = `shape:${globalThis.crypto.randomUUID()}`
  createShape(store, { id: shapeId, shapeType: 'video', parentId: pageId, x: args.x ?? 0, y: args.y ?? 0, props: { assetId, w: video.w, h: video.h } })
  return { shapeId, assetId, pageId }
}
export function replaceVideo(store, { id, video }) {
  const shape = editableVideo(store, id)
  const assetId = putAsset(store, video)
  store.put([{ ...shape, props: { ...shape.props, assetId, w: video.w, h: video.h, time: 0 } }])
  return { shapeId: id, assetId }
}
function editableVideo(store, id) {
  const shape = store.get(id)
  if (shape?.typeName !== 'shape' || shape.type !== 'video') throw new CanvasEditError('需要一个视频。')
  for (let r = shape; r?.typeName === 'shape'; r = store.get(r.parentId)) if (r.isLocked) throw new CanvasEditError('视频或容器已锁定。')
  return shape
}
export function setVideoAltText(store, { id, altText }) {
  const shape = editableVideo(store, id)
  if (typeof altText !== 'string' || altText.length > 10000) throw new CanvasEditError('替代文字需要不超过 10000 字的文字。')
  store.put([{ ...shape, props: { ...shape.props, altText } }])
  return { shapeId: id }
}
