import { CanvasEditError } from './errors.js'
import { reparentChildren } from './reparent-children.js'
import { getMediaTarget } from './media-target.js'
import { createShape } from './commands/create-shape.js'
import { deleteRecords } from './commands/delete.js'
import { updateRecord } from './commands/update.js'
import { getSlidesPages, getSlidesSpacing } from './slides-layout.js'

function adjacent(records, anchor, parentId, w, h, args) {
  const gap = Math.max(0, args.margin ?? 40)
  let x = args.x ?? (anchor ? anchor.x + anchor.props.w + gap : 0)
  let y = args.y ?? (anchor?.y || 0)
  if (anchor && args.placement === 'below') { x = anchor.x; y = anchor.y + anchor.props.h + gap }
  if (anchor && args.placement === 'left') x = anchor.x - w - gap
  if (args.avoidOverlap === false) return { x, y }
  const obstacles = Object.values(records).filter(record => record.typeName === 'shape' && record.parentId === parentId && record.id !== anchor?.id)
  for (let i = 0; i < 100; i++) {
    if (!obstacles.some(record => x < record.x + (record.props?.w || 0) + gap / 2 && x + w + gap / 2 > record.x && y < record.y + (record.props?.h || 0) + gap / 2 && y + h + gap / 2 > record.y)) break
    if (args.placement === 'below') y += h + gap
    else x += (args.placement === 'left' ? -1 : 1) * (w + gap)
  }
  return { x, y }
}

// 所有记录改动均经 Store；不修改 Store 取出的记录，也不触碰宿主快照。
export function placeMedia(store, args, { type, props, meta = {} }) {
  const records = Object.fromEntries(store.allRecords().map(record => [record.id, record]))
  const { anchor, pageId } = getMediaTarget({ store: records }, args)
  const holder = anchor?.type === 'frame' && (type === 'image' ? anchor.meta?.cowartAiImageHolder : anchor.meta?.cowartAiDraftHolder)
  const slides = anchor?.type === 'frame' && anchor.meta?.cowartAiSlides === true
  const update = type === 'embed' && anchor?.type === 'embed' && anchor.meta?.cowartHtmlDraft && args.updateExistingDraft !== false
  const match = !!anchor && args.matchAnchor !== false && !slides
  const replace = holder && match && (type === 'image' ? args.replaceAiImageHolder : args.replaceDraftHolder) !== false
  const fill = holder && match && !replace
  const w = match ? anchor.props.w : args.displayWidth ?? (slides ? 1024 : props.w)
  const h = match ? anchor.props.h : args.displayHeight ?? (slides ? 576 : props.h)
  if (![w, h].every(value => Number.isFinite(value) && value > 0 && value <= 16384)) throw new CanvasEditError('内容宽高必须有效。')
  const parentId = slides || fill ? anchor.id : anchor?.parentId || pageId
  let xy = replace || update ? { x: anchor.x, y: anchor.y } : fill ? { x: 0, y: 0 } : adjacent(records, anchor, parentId, w, h, args)
  if (slides) {
    const pages = getSlidesPages(anchor, Object.values(records)), last = pages.at(-1)
    const { padding, gap } = getSlidesSpacing(anchor, [...pages, { props: { w } }])
    const x = last ? last.x + Math.max(1, last.props.w) + gap : padding
    xy = { x, y: padding }
    meta = { ...meta, cowartAiSlidesParentShapeId: anchor.id }
  }
  const id = update ? anchor.id : `shape:${globalThis.crypto.randomUUID()}`
  if (replace) {
    // 占位框内的用户标注继续保留在原画布位置，并保持原先的前后层次。
    for (const change of reparentChildren(Object.values(records), anchor)) updateRecord(store, change)
    deleteRecords(store, { ids: [anchor.id] })
  }
  if (update) store.remove([id])
  createShape(store, { id, shapeType: type, parentId, ...xy, rotation: replace || update ? anchor.rotation : 0, props: { ...(update ? anchor.props : {}), ...props, w, h }, meta: { ...(update ? anchor.meta : {}), ...meta } })
  if (replace || update) updateRecord(store, { id, changes: { index: anchor.index } })
  return { shapeId: id, pageId, shapeRecord: store.get(id), bounds: { ...xy, w, h }, replacedAiDraftHolder: !!replace && type === 'embed', replacedAiImageHolder: !!replace && type === 'image', updatedExistingHtmlDraft: !!update }
}
