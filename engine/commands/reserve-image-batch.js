import { CanvasEditError } from '../errors.js'
import { pageFor } from '../media-target.js'
import { createShape } from './create-shape.js'
import { updateRecord } from './update.js'

// Grid layout and holder reuse form one edit. Store validation/transaction
// rollback is shared with every other command, including partial failures.
export function reserveImageBatch(store, { jobId, items, args = {} }) {
  if (!Array.isArray(items) || !items.length || items.length > 64) throw new CanvasEditError('每批需要 1 至 64 张独立图片。')
  if (typeof jobId !== 'string' || !jobId || items.some(item => !item || typeof item.id !== 'string' || !item.id || typeof item.holderId !== 'string' || !item.holderId)) throw new CanvasEditError('生成任务或图片框 ID 无效。')
  for (const item of items) {
    if (item.aspectRatio && (!/^\d{1,4}:\d{1,4}$/.test(item.aspectRatio) || item.aspectRatio.split(':').some(n => Number(n) <= 0))) throw new CanvasEditError('图片比例请填写宽:高。')
  }
  const columns = args.columns ?? Math.min(4, Math.ceil(Math.sqrt(items.length)))
  if (!Number.isInteger(columns) || columns < 1 || columns > 16) throw new CanvasEditError('每行数量需要 1 至 16。')
  const records = Object.fromEntries(store.allRecords().map(record => [record.id, record]))
  const anchor = args.anchorShapeId ? records[args.anchorShapeId] : null
  if (args.anchorShapeId && !anchor) throw new CanvasEditError('原目标框已删除。', 'conflict')
  const pageId = args.pageId || Object.values(records).find(record => record.typeName === 'page')?.id
  if (records[pageId]?.typeName !== 'page') throw new CanvasEditError('目标画布不存在。')
  if (anchor && pageFor(records, anchor) !== pageId) throw new CanvasEditError('目标框不属于指定画布。')
  const width = args.displayWidth ?? anchor?.props.w ?? 512
  const height = args.displayHeight ?? anchor?.props.h ?? 512
  const gap = args.gap ?? 40
  if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 8192) || !Number.isFinite(gap) || gap < 0) throw new CanvasEditError('图片框尺寸或间距无效。')
  const heights = items.map(item => { const ratio = item.aspectRatio?.split(':').map(Number); return ratio ? width * ratio[1] / ratio[0] : height })
  const rowHeight = Math.max(height, ...heights)
  const startX = args.x ?? (anchor ? anchor.x + (anchor.meta?.cowartAiImageHolder ? 0 : anchor.props.w + gap) : Object.values(records).filter(record => record.typeName === 'shape' && record.parentId === pageId).reduce((x, record) => Math.max(x, record.x + (record.props?.w || 0) + gap), 0))
  const startY = args.y ?? anchor?.y ?? 0
  const holderIds = []
  for (const [i, item] of items.entries()) {
    const holderId = i === 0 && anchor?.meta?.cowartAiImageHolder && !item.anchorShapeId ? anchor.id : item.holderId
    const status = { jobId, itemId: item.id, status: 'queued' }
    const existing = store.get(holderId)
    if (existing) {
      if (!existing.meta?.cowartAiImageHolder || existing.type !== 'frame') throw new CanvasEditError('只能替换 AI 图片占位框；改图请在原图旁新建目标。')
      const currentRecords = Object.fromEntries(store.allRecords().map(record => [record.id, record]))
      if (pageFor(currentRecords, existing) !== pageId) throw new CanvasEditError('图片框不属于指定画布。')
      if (['queued', 'running'].includes(existing.meta.hicanvasGeneration?.status)) throw new CanvasEditError('这个图片框正在生成，请等待当前任务完成。', 'conflict')
      updateRecord(store, { id: holderId, changes: { meta: { hicanvasGeneration: status } } })
    } else createShape(store, { id: holderId, shapeType: 'frame', parentId: anchor?.parentId || pageId, x: startX + (i % columns) * (width + gap), y: startY + Math.floor(i / columns) * (rowHeight + gap), props: { w: width, h: heights[i], name: 'AI 图片', color: 'blue' }, meta: { cowartAiImageHolder: true, hicanvasGeneration: status } })
    holderIds.push(holderId)
  }
  return { holderIds }
}
