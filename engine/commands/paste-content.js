import { getIndicesAbove, sortByIndex } from '@tldraw/utils'
import { CanvasEditError } from '../errors.js'
import { pageToShapePoint } from '../../renderer/geometry.js'
import { copyAncestors } from '../clipboard/tree.js'
import { validateClipboardContent } from '../clipboard/validate.js'

export function pasteContent(store, { content, parentId, offset = { x: 0, y: 0 } }) {
  content = validateClipboardContent(content)
  if (content.resources.length) throw new CanvasEditError('资源必须由宿主准备后再粘贴。')
  if (!offset || ![offset.x, offset.y].every(Number.isFinite)) throw new CanvasEditError('粘贴位移需要有效坐标。')
  const parent = store.get(parentId || store.allRecords().find(r => r.typeName === 'page')?.id)
  if (!parent || parent.typeName !== 'page' && !['frame', 'group'].includes(parent.type)) throw new CanvasEditError('粘贴的目标容器无效。')
  const values = structuredClone([...content.assets, ...content.shapes, ...content.bindings])
  const idMap = Object.fromEntries(values.map(r => [r.id, `${r.typeName}:${globalThis.crypto.randomUUID()}`]))
  const allocated = Object.values(idMap)
  if (new Set(allocated).size !== allocated.length || allocated.some(id => store.has(id))) throw new CanvasEditError('粘贴的新编号发生碰撞，请重试。')
  const roots = content.rootIds.map(id => values.find(r => r.id === id)).sort(sortByIndex)
  const rootSet = new Set(content.rootIds), records = { store: Object.fromEntries(store.allRecords().map(r => [r.id, r])) }
  const siblings = store.allRecords().filter(r => r.typeName === 'shape' && r.parentId === parent.id)
  const indices = getIndicesAbove(siblings.map(r => r.index).sort().at(-1), roots.length)
  const parentRotation = parent.typeName === 'shape' ? parent.rotation + copyAncestors(store, parent).reduce((sum, r) => sum + r.rotation, 0) : 0
  const placements = new Map(roots.map((r, i) => {
    const point = { x: r.x + offset.x, y: r.y + offset.y }
    return [r.id, { ...(parent.typeName === 'page' ? point : pageToShapePoint(records, parent.id, point)), rotation: r.rotation - parentRotation, index: indices[i] }]
  }))
  const copies = values.map(r => {
    const next = { ...r, id: idMap[r.id] }
    if (r.typeName === 'shape') {
      next.parentId = rootSet.has(r.id) ? parent.id : idMap[r.parentId]
      if (rootSet.has(r.id)) next.isLocked = false
      if (placements.has(r.id)) Object.assign(next, placements.get(r.id))
      if (r.props.assetId) next.props = { ...r.props, assetId: idMap[r.props.assetId] }
      if (r.meta?.cowartAiSlidesParentShapeId) {
        next.meta = { ...r.meta }
        const slides = idMap[r.meta.cowartAiSlidesParentShapeId] || (parent.meta?.cowartAiSlides ? parent.id : null)
        if (slides) next.meta.cowartAiSlidesParentShapeId = slides
        else delete next.meta.cowartAiSlidesParentShapeId
      }
    }
    if (r.typeName === 'binding') Object.assign(next, { fromId: idMap[r.fromId], toId: idMap[r.toId] })
    return next
  })
  store.put(copies)
  return { idMap, rootIds: content.rootIds.map(id => idMap[id]) }
}
