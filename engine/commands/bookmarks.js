import { bookmarkPlan } from '../bookmarks.js'
import { CanvasEditError } from '../errors.js'

// No network side effects: a shared resource is copied and rebound atomically.
export function setBookmark(store, command) {
  const plan = bookmarkPlan(store, command)
  if (!plan) return { shapeId: command.id, changed: false }
  const { shape, asset, props, url } = plan
  const shared = store.allRecords().some(record => record.typeName === 'shape' && record.id !== shape.id && record.props.assetId === asset.id)
  const assetId = shared ? `asset:${globalThis.crypto.randomUUID()}` : asset.id
  if (shared && store.has(assetId)) throw new CanvasEditError('书签资源编号冲突，请重试。')
  store.put([{ ...asset, id: assetId, props }])
  if (shared || url !== shape.props.url) store.put([{ ...shape, props: { ...shape.props, url, assetId } }])
  return { shapeId: shape.id, assetId, changed: true }
}
