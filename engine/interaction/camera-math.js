// 2026-11-25 黑盒：旧版生产构建、1280×800 合成画板，原生按键/滚轮。
// 档位实测 5/10/25/50/100/200/400/800%，从最近档位走到相邻档。
// Ctrl 轮每 CSS px 改当前比例 1%，单事件截到 ±10px；原生 Electron
// deltaY 与窗口 WheelEvent 符号相反。适合内容在限制边留 64px（800→672）。
// 单个 200×100 内容的 Shift+1/2 都到 576%，不把适合缩放限为 100%。
// 测量依据：#85 派活结果及 .scratch/camera/measurements.json、extra.json。
export const zoomLevels = Object.freeze([.05, .1, .25, .5, 1, 2, 4, 8])
export const clampZoom = z => Math.min(8, Math.max(.05, z))
export const boxBetween = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })
export function checkedViewport(viewport = { w: 1280, h: 800 }) {
  if (![viewport.w, viewport.h].every(v => Number.isFinite(v) && v > 0)) throw new Error('视口需要正数宽高。')
  return Object.freeze({ w: viewport.w, h: viewport.h })
}
export const centerOf = viewport => ({ x: viewport.w / 2, y: viewport.h / 2 })
export function stepZoom(z, direction) {
  let nearest = 0
  for (let i = 1; i < zoomLevels.length; i++) if (Math.abs(zoomLevels[i] - z) <= Math.abs(zoomLevels[nearest] - z)) nearest = i
  return zoomLevels[Math.max(0, Math.min(zoomLevels.length - 1, nearest + direction))]
}
export function anchoredZoom(camera, z, point) {
  z = clampZoom(z)
  return { x: camera.x + point.x / z - point.x / camera.z, y: camera.y + point.y / z - point.y / camera.z, z }
}
export function fitCamera(bounds, viewport, maxZoom = 8, padding = 64) {
  if (!bounds) return null
  const z = clampZoom(Math.min(maxZoom, Math.max(1, viewport.w - padding * 2) / Math.max(1, bounds.w), Math.max(1, viewport.h - padding * 2) / Math.max(1, bounds.h)))
  return { x: viewport.w / (2 * z) - bounds.x - bounds.w / 2, y: viewport.h / (2 * z) - bounds.y - bounds.h / 2, z }
}
export function unionBounds(bounds) {
  const boxes = bounds.filter(Boolean)
  if (!boxes.length) return null
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y))
  return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y }
}
