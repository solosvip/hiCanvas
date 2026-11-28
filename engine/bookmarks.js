import { normalizeHttpUrl, normalizeBookmarkMetadata } from '../model/index.js'
import { CanvasEditError } from './errors.js'

// The same eligibility/basis is used by the command and asynchronous intent.
// Records, not selection or revision, decide whether a prepared result is stale.
export function bookmarkTarget(store, id, pageId) {
  const shape = store.get(id), chain = [], seen = new Set()
  if (shape?.typeName !== 'shape' || shape.type !== 'bookmark' || !normalizeHttpUrl(shape.props.url) || shape.meta?.cowartHtmlDraft || shape.meta?.cowartHtmlDraftAssetUrl) throw new CanvasEditError('请选择一个可编辑的书签。')
  let record = shape
  while (record?.typeName === 'shape') {
    if (seen.has(record.id) || record.isLocked || record.opacity === 0) throw new CanvasEditError('书签或父容器已锁定、隐藏或不可编辑。')
    seen.add(record.id); chain.push(record); record = store.get(record.parentId)
  }
  if (record?.typeName !== 'page' || pageId && record.id !== pageId) throw new CanvasEditError('书签已不在当前画布。')
  const asset = store.get(shape.props.assetId)
  if (asset?.typeName !== 'asset' || asset.type !== 'bookmark') throw new CanvasEditError('书签资源不存在。')
  return { shape, asset, records: [...chain, asset, record] }
}

export function bookmarkPlan(store, command) {
  const { shape, asset } = bookmarkTarget(store, command.id)
  if (asset.id !== command.assetId || shape.props.url !== command.sourceUrl) throw new CanvasEditError('书签网址或资源已变化。', 'conflict')
  const changingUrl = command.type === 'set_bookmark_url'
  const url = changingUrl ? normalizeHttpUrl(command.url) : shape.props.url
  if (!url) throw new CanvasEditError('请输入不带凭据的完整 HTTP(S) 网址。')
  const metadata = command.metadata === null && changingUrl ? null : normalizeBookmarkMetadata(command.metadata)
  if (changingUrl && url === shape.props.url) return null
  if (!changingUrl && !metadata.title && !metadata.description) return null
  const src = new URL(metadata?.url || url); src.hash = ''
  const props = changingUrl
    ? { ...asset.props, src: src.href, title: metadata?.title || '', description: metadata?.description || '', image: '', favicon: '' }
    : { ...asset.props, src: src.href, title: metadata.title || asset.props.title, description: metadata.description || asset.props.description }
  if (!changingUrl && Object.keys(props).every(key => props[key] === asset.props[key])) return null
  return { shape, asset, props, url }
}
