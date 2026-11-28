import { createConnectionContext, getShapePageBounds } from '../../renderer/geometry.js'
import { pageFor } from '../media-target.js'

const expand = (b, p) => ({ x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2 })
const intersects = (a, b) => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y
const colors = new Set(['red', 'yellow', 'orange'])
const identified = (shape, key) => shape.meta?.[key] === true || colors.has(shape.props.color) || shape.type === 'arrow' && shape.props.labelColor === 'red'
const limits = Object.freeze({ edge: 4096, pixels: 16_000_000 })
function generatedEmbed(shape) {
  if (shape.type !== 'embed') return false
  if (shape.meta?.cowartHtmlDraft === true) return true
  const url = shape.props.url
  if (/^data:text\/html(?:;[^,]*)?,/i.test(url)) return true
  let path = url
  try { const parsed = new URL(url); if (parsed.origin !== 'http://cowart.local') return false; path = parsed.pathname + parsed.search + parsed.hash } catch { /* Relative legacy asset. */ }
  return /^\/(?:c\/[^/]+\/)?(?:page-assets|assets)\//.test(path) && /\.html?(?:$|[?#])/i.test(path)
}

export function annotationPlan(snapshot, targetId) {
  const records = snapshot.store, target = records[targetId]
  // O14 accepts asset-less images and empty slide frames. It classifies the
  // target, rather than guessing whether its renderer will contain pixels.
  if (target?.typeName !== 'shape' || !(target.type === 'image' || generatedEmbed(target) || target.type === 'frame' && target.meta?.cowartAiSlides === true)) throw new Error('请选择图片、已生成网页或影片、幻灯片后再汇集标注。')
  const pageId = pageFor(records, target)
  if (!pageId) throw new Error('标注目标不属于有效画布。')
  const context = createConnectionContext(Object.values(records)), boxes = new Map()
  const box = id => {
    if (!boxes.has(id)) boxes.set(id, getShapePageBounds(snapshot, id, context))
    return boxes.get(id)
  }
  const bounds = box(targetId)
  if (!bounds) throw new Error('无法读取当前内容的画布位置。')
  // .scratch/annotation-observation/runs/observe-1795815564692 O10/O15,
  // observe-1795815674628 O10: page AABB; margin clamp(long edge,160,720),
  // inclusive contact, independent of camera/DPR and ancestor frame clipping.
  const near = expand(bounds, Math.min(720, Math.max(160, bounds.w, bounds.h)))
  const candidates = Object.values(records).filter(r => r.typeName === 'shape' && r.id !== targetId && pageFor(records, r) === pageId).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const arrows = candidates.filter(r => r.type === 'arrow' && identified(r, 'cowartAnnotationArrow') && box(r.id) && intersects(near, box(r.id)))
  // observe-1795815452031 O12 (identity/locked/opacity); observe-1795815733593
  // O11/O13 and observe-1795815564692 O13: arrow AABB, 120px text margin,
  // no text-to-text spread. Two passes deliberately fix the legacy layer bug.
  const texts = candidates.filter(r => r.type === 'text' && identified(r, 'cowartAnnotationText') && box(r.id) && (intersects(near, box(r.id)) || arrows.some(a => intersects(expand(box(a.id), 120), box(r.id)))))
  const ids = [targetId, ...arrows.map(r => r.id), ...texts.map(r => r.id)], selected = ids.map(box)
  const x = Math.min(...selected.map(b => b.x)), y = Math.min(...selected.map(b => b.y))
  const sourceBounds = { x, y, w: Math.max(...selected.map(b => b.x + b.w)) - x, h: Math.max(...selected.map(b => b.y + b.h)) - y }
  // observe-1795815564692 O15/O17: four sides 32; padded long edge
  // <=1000 -> 2, <=1600 -> 1.5, otherwise 1. Renderer owns rounding.
  const longest = Math.max(sourceBounds.w, sourceBounds.h) + 64
  return { targetId, pageId, ids, bounds: sourceBounds, padding: 32, scale: longest <= 1000 ? 2 : longest <= 1600 ? 1.5 : 1 }
}

export function checkAnnotationSize({ width, height }) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error('标注截图预检没有有效的实际宽高。')
  // observe-1795815733593 O18 / observe-1795815452031 O19:
  // 4096 per edge and 16,000,000 pixels are inclusive, independent limits.
  if (width > limits.edge || height > limits.edge || width * height > limits.pixels) throw Object.assign(new Error(`标注截图 ${width}×${height} 超过4096px边长或1600万像素上限；请缩小图片或移近标注后重试。`), { code: 'annotation-size-limit', width, height, limits })
}
