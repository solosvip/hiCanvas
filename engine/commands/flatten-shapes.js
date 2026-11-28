import { CanvasEditError } from '../errors.js'
import { flattenPlan, validateFlattenImage } from '../flatten-plan.js'
import { isSlidesContainer, planSlidesLayout } from '../slides-layout.js'
import { createShape } from './create-shape.js'
import { deleteRecords } from './delete.js'

export function flattenShapes(store, { ids, image, bounds, id = `shape:${globalThis.crypto.randomUUID()}`, assetId = `asset:${globalThis.crypto.randomUUID()}` }) {
  const plan = flattenPlan(store.getStoreSnapshot('document'), ids, { render: false })
  if (plan.status !== 'ready') throw new CanvasEditError('请选择需要扁平化的对象。')
  // Rendering supplies only the bounded image, never a parent or layer. Those
  // are recomputed from the authoritative store at the transaction boundary.
  validateFlattenImage(image, bounds)
  if (typeof assetId !== 'string' || !assetId.startsWith('asset:') || store.has(assetId)) throw new CanvasEditError('新图片资产 ID 无效或已存在。')
  createShape(store, { id, shapeType: 'image', parentId: plan.parentId, x: bounds.x, y: bounds.y, props: { w: bounds.w, h: bounds.h, assetId } })
  let opacity = 1, collapsed = new Set(plan.ids), ancestor = store.get(plan.parentId)
  // The common single-child ungroup carries pose but not opacity. Bake only
  // ancestors that finalization will dissolve; surviving parents apply once.
  while (ancestor?.type === 'group' && store.allRecords().filter(record => record.typeName === 'shape' && record.parentId === ancestor.id && record.id !== id).every(child => collapsed.has(child.id))) {
    opacity *= ancestor.opacity
    collapsed = new Set([ancestor.id]); ancestor = store.get(ancestor.parentId)
  }
  const replacement = { ...store.get(id), index: plan.index, opacity }
  const parent = store.get(plan.parentId)
  if (isSlidesContainer(parent)) {
    const children = store.allRecords().filter(record => record.typeName === 'shape' && record.parentId === parent.id && !plan.allIds.includes(record.id) && record.id !== id).concat(replacement)
    // A multi-page merge must not silently resize the deck or move its other
    // pages during shared finalization. Flatten the whole deck instead.
    if (planSlidesLayout(parent, children).length) throw new CanvasEditError('合成图片会改变幻灯片排版，请选择整个幻灯片框扁平化。')
  }
  store.put([{ id: assetId, typeName: 'asset', type: 'image', props: { name: 'Flattened selection', src: image.src, w: image.w, h: image.h, mimeType: image.mimeType, isAnimated: false }, meta: {} }, replacement])
  // Shared deletion pins surviving external arrow terminals and removes only
  // bindings into deleted targets. Its opposite terminal remains bound.
  deleteRecords(store, { ids: plan.ids })
  return { shapeId: id, assetId, parentId: plan.parentId }
}
