import { createElement as h } from 'react'
import { checkedTrailPoints, TrailOverlay } from './trail-overlay.js'

export function checkedEraser(item) {
  if (!Array.isArray(item.ids) || Array.from(item.ids).some(id => typeof id !== 'string' || !id.startsWith('shape:') || id.length <= 6)
    || item.tailScale !== undefined && (!Number.isFinite(item.tailScale) || item.tailScale < 0 || item.tailScale > 1)) throw new Error('擦除描述需要形状ID、最多256个有限坐标与0至1的尾迹倍率。')
  return Object.freeze({ kind: 'eraser', ids: Object.freeze([...new Set(item.ids)]), ...checkedTrailPoints(item.points, 256, '擦除尾迹'), tailScale: item.tailScale ?? 1 })
}

export function EraserOverlay({ item, zoom }) {
  return h(TrailOverlay, { item, zoom })
}
