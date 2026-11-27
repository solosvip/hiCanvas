import { CanvasEditError } from '../errors.js'
import { loadValidatedCanvasSnapshot } from '../load-snapshot.js'
import { validateRelationships } from '../relationships.js'
import { shapeToPagePoint } from '../../renderer/geometry.js'
import { collectCopyTree, copyAncestors } from './tree.js'
import { CLIPBOARD_TYPE, CLIPBOARD_VERSION, CLIPBOARD_PAGE, validateClipboardContent } from './validate.js'

// Only document data crosses this interface. Roots use world coordinates;
// descendants keep their local coordinates, so the source can disappear.
export function createClipboardContent(snapshot, ids, { boardId = '' } = {}) {
  const { store, pageId } = loadValidatedCanvasSnapshot(snapshot)
  try {
    validateRelationships(store, pageId)
    if (typeof boardId !== 'string') throw new CanvasEditError('来源画板标识无效。')
    const { roots, originals, bindings, props } = collectCopyTree(store, ids)
    const rootIds = roots.map(r => r.id), rootSet = new Set(rootIds)
    const shapes = originals.map(record => {
      const root = rootSet.has(record.id)
      const point = root ? shapeToPagePoint(snapshot, record.id, { x: 0, y: 0 }) : record
      const rotation = root ? record.rotation + copyAncestors(store, record).reduce((sum, parent) => sum + parent.rotation, 0) : record.rotation
      return { ...record, x: point.x, y: point.y, rotation, ...(root && { parentId: CLIPBOARD_PAGE }), ...(props.has(record.id) && { props: props.get(record.id) }) }
    })
    const assetIds = new Set(shapes.map(r => r.props.assetId).filter(Boolean))
    const assets = [...assetIds].map(id => {
      const record = store.get(id)
      if (record?.typeName !== 'asset') throw new CanvasEditError('复制的对象缺少资源。')
      return record
    })
    return validateClipboardContent({ type: CLIPBOARD_TYPE, version: CLIPBOARD_VERSION, shapes, rootIds, bindings, assets, origin: { boardId, parents: Object.fromEntries(roots.map(r => [r.id, r.parentId])) }, resources: [] })
  } finally { store.dispose() }
}
