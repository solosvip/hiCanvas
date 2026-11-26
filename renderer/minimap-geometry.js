import { checkedCamera } from './geometry.js'

const box = value => Object.freeze({ x: value.x || 0, y: value.y || 0, w: value.w, h: value.h })
function size(value) {
  if (![value?.w, value?.h].every(n => Number.isFinite(n) && n > 0)) throw new Error('小地图及画布视口需要正数宽高。')
  return value
}
function point(value) {
  if (![value?.x, value?.y].every(Number.isFinite)) throw new Error('小地图需要有限坐标。')
  return value
}

// Black-box 2026-11-25: isolated 1280×900 legacy board, native Electron input
// and the 152×88 canvas output (getImageData, no package code). Ellipse/triangle
// become boxes. Union(content, viewport), contain fit, centered letterboxing,
// no padding: (100,50,1) => scale 88/900, viewport x 13.422…/y 0;
// (0,0,2), content [0,0,1000,500] => .152 and vertical letterbox 6px.
export function getMinimapLayout({ camera, viewport, size: dimensions, contentBounds = null, frameBounds = null }) {
  const view = checkedCamera(camera), viewportSize = size(viewport), mini = size(dimensions)
  const visible = { x: -view.x, y: -view.y, w: viewportSize.w / view.z, h: viewportSize.h / view.z }
  for (const bounds of [contentBounds, frameBounds]) if (bounds && (![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) || bounds.w < 0 || bounds.h < 0)) throw new Error('小地图内容范围需要有限坐标和非负宽高。')
  if (frameBounds && (!frameBounds.w || !frameBounds.h)) throw new Error('固定取景需要正数宽高。')
  const x = Math.min(visible.x, contentBounds?.x ?? visible.x), y = Math.min(visible.y, contentBounds?.y ?? visible.y)
  const right = Math.max(visible.x + visible.w, contentBounds ? contentBounds.x + contentBounds.w : -Infinity)
  const bottom = Math.max(visible.y + visible.h, contentBounds ? contentBounds.y + contentBounds.h : -Infinity)
  const pageBounds = box(frameBounds || { x, y, w: right - x, h: bottom - y })
  const scale = Math.min(mini.w / pageBounds.w, mini.h / pageBounds.h)
  const offset = Object.freeze({ x: (mini.w - pageBounds.w * scale) / 2 - pageBounds.x * scale, y: (mini.h - pageBounds.h * scale) / 2 - pageBounds.y * scale })
  return Object.freeze({ pageBounds, viewBounds: box(visible), scale, offset,
    viewportBounds: box({ x: visible.x * scale + offset.x, y: visible.y * scale + offset.y, w: visible.w * scale, h: visible.h * scale }) })
}

export function pageToMinimapPoint(layout, value) {
  point(value)
  return { x: value.x * layout.scale + layout.offset.x, y: value.y * layout.scale + layout.offset.y }
}
export function minimapToPagePoint(layout, value) {
  point(value)
  return { x: (value.x - layout.offset.x) / layout.scale, y: (value.y - layout.offset.y) / layout.scale }
}
export function hitMinimapViewport(layout, value) {
  point(value)
  const b = layout.viewportBounds
  return value.x >= b.x && value.x <= b.x + b.w && value.y >= b.y && value.y <= b.y + b.h
}
