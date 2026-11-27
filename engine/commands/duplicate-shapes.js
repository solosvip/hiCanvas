import { getIndicesAbove } from '@tldraw/utils'
import { CanvasEditError } from '../errors.js'
import { collectCopyTree, copyAncestors } from '../clipboard/tree.js'

const DEFAULT_DUPLICATE_OFFSET = 16

export function duplicateShapes(store, { ids, offset = { x: DEFAULT_DUPLICATE_OFFSET, y: DEFAULT_DUPLICATE_OFFSET } }) {
  const { roots, originals, bindings, props, children } = collectCopyTree(store, ids)
  if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) throw new CanvasEditError('复制位移需要有效的 x、y 数值。')
  const idMap = Object.fromEntries([...originals, ...bindings].map(record => [record.id, `${record.typeName}:${globalThis.crypto.randomUUID()}`]))
  const rootPositions = new Map()
  for (const parentId of new Set(roots.map(record => record.parentId))) {
    const siblings = children.get(parentId) || []
    const group = roots.filter(record => record.parentId === parentId)
    const indices = getIndicesAbove(siblings.map(record => record.index).sort().at(-1), group.length)
    for (const [i, record] of group.entries()) {
      // 位移以画布坐标给出；只平移根副本，子孙沿用各自的局部坐标。
      const angle = copyAncestors(store, record).reduce((rotation, parent) => rotation + parent.rotation, 0)
      rootPositions.set(record.id, { index: indices[i], x: record.x + Math.cos(angle) * offset.x + Math.sin(angle) * offset.y, y: record.y - Math.sin(angle) * offset.x + Math.cos(angle) * offset.y })
    }
  }
  for (const record of originals) {
    // 幻灯片布局器按此归属接回子页；框一起复制时必须改指新框。
    const slidesParentId = idMap[record.meta?.cowartAiSlidesParentShapeId]
    const meta = slidesParentId ? { ...record.meta, cowartAiSlidesParentShapeId: slidesParentId } : record.meta
    store.put([{ ...record, id: idMap[record.id], parentId: idMap[record.parentId] || record.parentId, meta, ...(props.has(record.id) && { props: props.get(record.id) }), ...rootPositions.get(record.id) }])
  }
  // Only bindings wholly inside the copied tree are retained.
  for (const record of bindings) store.put([{ ...record, id: idMap[record.id], fromId: idMap[record.fromId], toId: idMap[record.toId] }])
  return { idMap }
}
