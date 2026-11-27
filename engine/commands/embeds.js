import { getIndexAbove } from '@tldraw/utils'
import { planUrlInsertion, planUrlConversion } from '../embeds.js'
import { CanvasEditError } from '../errors.js'
import { snapshotOf, unlockedShapes } from '../container-geometry.js'
import { shapeToPagePoint, pageToShapePoint } from '../../renderer/geometry.js'

function urlProps(store, plan) {
  const [w, h] = plan.size, props = { w, h, url: plan.url }
  if (plan.type === 'bookmark') {
    props.assetId = `asset:${globalThis.crypto.randomUUID()}`
    store.put([{ id: props.assetId, typeName: 'asset', type: 'bookmark', meta: {}, props: { src: plan.url, title: '', description: '', image: '', favicon: '' } }])
  }
  return props
}

export function insertUrl(store, command) {
  const plan = planUrlInsertion(command.url, command)
  const pageId = command.pageId || store.allRecords().find(r => r.typeName === 'page')?.id
  if (store.get(pageId)?.typeName !== 'page') throw new CanvasEditError('网址需要明确的目标画布。')
  const point = command.point || { x: 0, y: 0 }
  if (![point.x, point.y].every(Number.isFinite)) throw new CanvasEditError('网址落点需要有限坐标。')
  const id = command.id || `shape:${globalThis.crypto.randomUUID()}`
  if (typeof id !== 'string' || !id.startsWith('shape:') || store.has(id)) throw new CanvasEditError('形状 ID 无效或已存在。')
  const [w, h] = plan.size, props = urlProps(store, plan)
  const siblings = store.allRecords().filter(r => r.typeName === 'shape' && r.parentId === pageId).map(r => r.index).sort()
  store.put([{ id, typeName: 'shape', type: plan.type, parentId: pageId, index: getIndexAbove(siblings.at(-1) || 'a0'),
    x: point.x - w / 2, y: point.y - h / 2, rotation: 0, opacity: 1, isLocked: false, meta: {}, props }])
  return { shapeId: id, pageId, notice: plan.notice }
}

// Same identity, one validated transaction. Type replacement is restricted to
// this semantic command; generic update still rejects every type change.
export function convertUrlShape(store, { id, to }) {
  const shape = store.get(id)
  if (shape?.typeName !== 'shape' || !unlockedShapes(store, [shape]).length) throw new CanvasEditError('请选择一个未锁定的书签或外部嵌入。')
  const plan = planUrlConversion(shape, to), snapshot = snapshotOf(store)
  const center = shapeToPagePoint(snapshot, id, { x: shape.props.w / 2, y: shape.props.h / 2 })
  const parentCenter = pageToShapePoint(snapshot, shape.parentId, center)
  const [w, h] = plan.size, c = Math.cos(shape.rotation), s = Math.sin(shape.rotation)
  const previousAsset = shape.type === 'bookmark' && store.get(shape.props.assetId)
  store.put([{ ...shape, type: to, x: parentCenter.x - (w * c - h * s) / 2, y: parentCenter.y - (w * s + h * c) / 2, props: urlProps(store, plan) }])
  if (previousAsset?.typeName === 'asset' && previousAsset.type === 'bookmark' &&
    !store.allRecords().some(record => record.typeName === 'shape' && record.props.assetId === previousAsset.id)) store.remove([previousAsset.id])
  return { shapeId: id }
}
