import { getShapeBounds, getShapeContour, shapeToPagePoint, getHandDrawnContour, getConnectionGeometry } from './geometry.js'
import { strokeWidth } from './geo-metrics.js'
import { geoLabelLayout } from './geo-label.js'
import { boxPolygon, clipPolygon } from './polygon-clip.js'

export const CANVAS_EXPORT_LIMITS = Object.freeze({ edge: 8192, pixels: 16_000_000, bytes: 64_000_000, timeout: 30_000 })
const union = boxes => {
  if (!boxes.length) return null
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y))
  return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y }
}
const envelope = points => union(points.map(p => ({ ...p, w: 0, h: 0 })))

function inkBox(shape, context) {
  const box = getShapeBounds(shape, context)
  if (!box) return null
  let result = box
  if (shape.type === 'geo') {
    const hand = getHandDrawnContour(shape), margin = strokeWidth(shape.props) / 2
    const points = hand?.outline.flatMap(p => [{ x: p.x - p.width / 2, y: p.y - p.width / 2 }, { x: p.x + p.width / 2, y: p.y + p.width / 2 }]) || getShapeContour(shape).outline
    const ink = envelope(points)
    result = { x: ink.x - margin, y: ink.y - margin, w: ink.w + margin * 2, h: ink.h + margin * 2 }
    const label = geoLabelLayout(shape.props)
    if (label.lines.some(line => line.text.trim())) result = union([result, label])
  } else if (['line', 'arrow'].includes(shape.type)) {
    const margin = getConnectionGeometry(shape, context).width / 2
    result = { x: box.x - margin, y: box.y - margin, w: box.w + margin * 2, h: box.h + margin * 2 }
  } else if (shape.type === 'frame') {
    // Titles are export decorations in world units, independent of camera.
    result = { x: -7, y: -28, w: box.w + 16, h: box.h + 29 }
  } else if (shape.type === 'note') {
    // Reserve paper decoration clearance outside the note's content box.
    const scale = shape.props.scale || 1
    result = { x: -4 * scale, y: -4 * scale, w: box.w + 8 * scale, h: box.h + 12 * scale }
  }
  return result
}

export function exportBounds(scene) {
  const boxes = []
  for (const shape of scene.shapes) {
    const box = inkBox(shape, scene.snapshot)
    if (!box) continue
    let polygon = boxPolygon(box).map(p => shapeToPagePoint(scene.snapshot, shape.id, p))
    let current = scene.records[shape.parentId]
    while (current?.typeName === 'shape') {
      if (current.type === 'frame') polygon = clipPolygon(polygon, boxPolygon(getShapeBounds(current)).map(p => shapeToPagePoint(scene.snapshot, current.id, p)))
      current = scene.records[current.parentId]
    }
    if (polygon.length) boxes.push(envelope(polygon))
  }
  return union(boxes)
}

export function exportSize(bounds, { padding = 0, scale = 2 } = {}) {
  if (!Number.isFinite(padding) || padding < 0 || !Number.isFinite(scale) || scale <= 0) throw new Error('输出留白与倍率需要有效的非负留白和正数倍率。')
  if (!bounds) return { status: 'empty' }
  if (![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) || bounds.w <= 0 || bounds.h <= 0) throw new Error('输出范围需要有限坐标和正数宽高。')
  const x = Math.floor(bounds.x - padding), y = Math.floor(bounds.y - padding)
  const w = Math.ceil(bounds.x + bounds.w + padding) - x, h = Math.ceil(bounds.y + bounds.h + padding) - y
  const width = Math.ceil(w * scale), height = Math.ceil(h * scale)
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width > CANVAS_EXPORT_LIMITS.edge || height > CANVAS_EXPORT_LIMITS.edge || width * height > CANVAS_EXPORT_LIMITS.pixels) throw new Error('输出超过8192边长或1600万像素上限。')
  return Object.freeze({ status: 'ready', bounds: Object.freeze({ x, y, w, h }), width, height, scale })
}
