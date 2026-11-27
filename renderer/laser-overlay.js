import { createElement as h } from 'react'
import { checkedTrailPoints, TrailOverlay } from './trail-overlay.js'

export function checkedLaser(item) {
  if (typeof item.id !== 'string' || !item.id || item.id.length > 128) throw new Error('激光描述需要轨迹ID。')
  return Object.freeze({ kind: 'laser', id: item.id, ...checkedTrailPoints(item.points, 1024, '激光尾迹') })
}

// Ref runs only when a nonempty laser path is actually mounted. Display-only
// hosts need neither these editing tokens nor another Store subscription.
function checkPaint(element) {
  if (!element) return
  const style = element.ownerDocument.defaultView.getComputedStyle(element)
  const color = style.getPropertyValue('--color-overlay-laser-stroke').trim()
  const width = style.getPropertyValue('--spacing-overlay-laser-stroke').trim()
  if (!/^#[\da-f]{8}$/i.test(color) || !/^\d+(?:\.\d+)?px$/.test(width) || !Number.isFinite(parseFloat(width)) || parseFloat(width) <= 0) throw new Error('激光绘制缺少有效颜色和宽度设计令牌。')
}

export function LaserOverlay({ item, zoom }) {
  return h(TrailOverlay, { item, zoom, checkPaint })
}
