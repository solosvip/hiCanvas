import { createMinimapScene } from './minimap-scene.js'

// Drawing only. The host forwards normalized input to engine/interaction and
// supplies its layout; this module never computes or changes the main camera.
// Native legacy output uses solid gray AABBs, selected blue, then a translucent
// rounded viewport. Cache the box bitmap while the framing/selection is stable:
// 5000 unchanged records do not need 5000 redraws on every pan or zoom frame.
export function mountCanvasMinimap(element, { store, pageId } = {}) {
  if (!element?.ownerDocument || !store?.addHistoryInterceptor) throw new Error('小地图需要页面元素和模型 Store。')
  const doc = element.ownerDocument, win = doc.defaultView, canvas = doc.createElement('canvas'), bitmap = doc.createElement('canvas')
  canvas.className = 'hicanvas-minimap-canvas'; canvas.dataset.minimapCanvas = ''
  canvas.setAttribute('aria-label', '画板小地图，拖动或双击定位，方向键平移'); canvas.tabIndex = 0
  element.append(canvas)
  const context = canvas.getContext('2d'), cache = bitmap.getContext('2d')
  if (!context || !cache) { canvas.remove(); throw new Error('小地图需要二维绘制支持。') }
  let view = null, selected = [], scheduled = null, active = true, cacheKey = null, lastBoxes = null, colors
  const scene = createMinimapScene(store, pageId, schedule)
  function schedule() {
    if (!active || scheduled !== null || !view) return
    scheduled = win.requestAnimationFrame(() => { scheduled = null; draw() })
  }
  function draw() {
    if (!view || !active) return
    const rect = canvas.getBoundingClientRect(), ratio = win.devicePixelRatio || 1
    if (!rect.width || !rect.height) return
    const w = Math.round(rect.width * ratio), h = Math.round(rect.height * ratio)
    if (canvas.width !== w || canvas.height !== h) { canvas.width = bitmap.width = w; canvas.height = bitmap.height = h; cacheKey = null }
    if (!colors) {
      const style = win.getComputedStyle(canvas), token = name => style.getPropertyValue(name).trim()
      colors = { shape: token('--color-minimap-shape'), selected: token('--color-primary'), viewport: token('--color-minimap-viewport'), background: token('--color-minimap-background'), radius: parseFloat(token('--radius-xs')) }
      if (Object.values(colors).some(value => !value && value !== 0)) throw new Error('小地图缺少设计令牌。')
    }
    const boxes = scene.boxes(), key = JSON.stringify([view.pageBounds, view.scale, view.offset, selected])
    if (lastBoxes !== boxes || key !== cacheKey) {
      cache.setTransform(ratio, 0, 0, ratio, 0, 0); cache.clearRect(0, 0, rect.width, rect.height)
      cache.fillStyle = colors.background; cache.fillRect(0, 0, rect.width, rect.height)
      cache.setTransform(view.scale * ratio, 0, 0, view.scale * ratio, view.offset.x * ratio, view.offset.y * ratio)
      const ids = new Set(selected)
      // Paint selected boxes last, so a containing frame cannot hide them.
      for (const isSelected of [false, true]) {
        cache.fillStyle = isSelected ? colors.selected : colors.shape; cache.beginPath()
        for (const box of boxes) if (ids.has(box.id) === isSelected) cache.rect(box.x, box.y, box.w, box.h)
        cache.fill()
      }
      lastBoxes = boxes; cacheKey = key
    }
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, w, h); context.drawImage(bitmap, 0, 0)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const b = view.viewportBounds
    context.fillStyle = colors.viewport; context.beginPath(); context.roundRect(b.x, b.y, b.w, b.h, colors.radius); context.fill()
  }
  return Object.freeze({
    element: canvas,
    setView(layout, selectedIds = []) {
      if (!active) throw new Error('小地图已卸载。')
      view = layout && structuredClone(layout); selected = [...selectedIds]; schedule()
    },
    unmount() { if (!active) return; active = false; if (scheduled !== null) win.cancelAnimationFrame(scheduled); scene.dispose(); canvas.remove() },
  })
}
