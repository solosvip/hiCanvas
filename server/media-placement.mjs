// 保留 Cowart 的目标框替换、父容器、旋转与旁置避让语义。
import { getIndicesBetween, sortByIndex } from 'tldraw'
import { randomUUID } from 'node:crypto'
import { applyCanvasOperations } from './canvas-operations.mjs'
import { httpError } from './file-lock.mjs'

export function pageFor(store, shape) {
  const visited = new Set()
  while (shape?.typeName === 'shape' && !visited.has(shape.id)) { visited.add(shape.id); shape = store[shape.parentId] }
  return shape?.typeName === 'page' ? shape.id : null
}
export function targetFor(snapshot, args) {
  const store = snapshot.store
  const id = args.draftShapeId || args.anchorShapeId
  const anchor = id ? store[id] : null
  if (id && anchor?.typeName !== 'shape') throw httpError('目标框已被删除；结果未插入其他位置。', 409)
  const pageId = args.pageId || pageFor(store, anchor) || Object.values(store).find(r => r.typeName === 'page')?.id
  if (store[pageId]?.typeName !== 'page' || (anchor && pageFor(store, anchor) !== pageId)) throw httpError('目标画布无效或与选中对象不一致。')
  return { store, anchor, pageId }
}
function adjacent(store, anchor, parentId, w, h, args) {
  const gap = Math.max(0, args.margin ?? 40)
  let x = args.x ?? (anchor ? anchor.x + anchor.props.w + gap : 0)
  let y = args.y ?? (anchor?.y || 0)
  if (anchor && args.placement === 'below') { x = anchor.x; y = anchor.y + anchor.props.h + gap }
  if (anchor && args.placement === 'left') x = anchor.x - w - gap
  const obstacles = Object.values(store).filter(r => r.typeName === 'shape' && r.parentId === parentId && r.id !== anchor?.id)
  for (let i = 0; i < 100; i++) {
    if (!obstacles.some(r => x < r.x + (r.props?.w || 0) + gap / 2 && x + w + gap / 2 > r.x && y < r.y + (r.props?.h || 0) + gap / 2 && y + h + gap / 2 > r.y)) break
    if (args.placement === 'below') y += h + gap
    else x += (args.placement === 'left' ? -1 : 1) * (w + gap)
  }
  return { x, y }
}
export function placeMedia(snapshot, args, { type, props, meta = {} }) {
  const { store, anchor, pageId } = targetFor(snapshot, args)
  const holder = anchor?.type === 'frame' && (type === 'image' ? anchor.meta?.cowartAiImageHolder : anchor.meta?.cowartAiDraftHolder)
  const slides = anchor?.type === 'frame' && anchor.meta?.cowartAiSlides === true
  const update = type === 'embed' && anchor?.type === 'embed' && anchor.meta?.cowartHtmlDraft && args.updateExistingDraft !== false
  const match = !!anchor && args.matchAnchor !== false && !slides
  const replace = holder && match && (type === 'image' ? args.replaceAiImageHolder : args.replaceDraftHolder) !== false
  const fill = holder && match && !replace
  const w = match ? anchor.props.w : args.displayWidth ?? (slides ? 1024 : props.w)
  const h = match ? anchor.props.h : args.displayHeight ?? (slides ? 576 : props.h)
  if (![w, h].every(n => Number.isFinite(n) && n > 0 && n <= 16384)) throw httpError('内容宽高必须有效。')
  const parentId = slides || fill ? anchor.id : anchor?.parentId || pageId
  let xy = replace || update ? { x: anchor.x, y: anchor.y } : fill ? { x: 0, y: 0 } : adjacent(store, anchor, parentId, w, h, args)
  if (slides) {
    const padding = anchor.meta.cowartAiSlidesPadding ?? 12
    const gap = anchor.meta.cowartAiSlidesGap ?? 32
    const children = Object.values(store).filter(r => r.typeName === 'shape' && r.parentId === anchor.id)
    xy = { x: children.reduce((x, r) => Math.max(x, r.x + r.props.w + gap), padding), y: padding }
    anchor.props.w = Math.max(anchor.props.w, xy.x + w + padding)
    anchor.props.h = Math.max(anchor.props.h, h + padding * 2)
    meta.cowartAiSlidesParentShapeId = anchor.id
  }
  const id = update ? anchor.id : `shape:${randomUUID()}`
  if (replace) {
    // 占位框不是用户内容的所有者；生成期间画进框内的标注、文字应保持原来的画布位置。
    const children = Object.values(store).filter(r => r.typeName === 'shape' && r.parentId === anchor.id).sort(sortByIndex)
    const above = Object.values(store).filter(r => r.typeName === 'shape' && r.parentId === anchor.parentId && r.index > anchor.index).map(r => r.index).sort()[0]
    const indices = getIndicesBetween(anchor.index, above, children.length)
    for (const [i, child] of children.entries()) {
      child.index = indices[i]
      const x = child.x, y = child.y
      child.parentId = anchor.parentId
      child.x = anchor.x + Math.cos(anchor.rotation) * x - Math.sin(anchor.rotation) * y
      child.y = anchor.y + Math.sin(anchor.rotation) * x + Math.cos(anchor.rotation) * y
      child.rotation += anchor.rotation
    }
    applyCanvasOperations(snapshot, [{ type: 'delete', ids: [anchor.id] }])
  }
  if (update) delete store[id]
  applyCanvasOperations(snapshot, [{ type: 'create_shape', id, shapeType: type, parentId, ...xy, rotation: replace || update ? anchor.rotation : 0, props: { ...(update ? anchor.props : {}), ...props, w, h }, meta: { ...(update ? anchor.meta : {}), ...meta } }])
  if (replace || update) store[id].index = anchor.index
  return { shapeId: id, pageId, shapeRecord: store[id], bounds: { ...xy, w, h }, replacedAiDraftHolder: !!replace && type === 'embed', replacedAiImageHolder: !!replace && type === 'image', updatedExistingHtmlDraft: !!update }
}
