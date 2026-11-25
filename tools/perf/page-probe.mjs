// Browser-side observation adapter. Workloads use native input; these hooks only
// read state or reset the starting camera outside the measured interval. A new
// editor may replace this adapter while keeping fixtures/timing/inputs unchanged.
export async function waitUntilReady({ count, targetId }) {
  const deadline = performance.now() + 60000
  while (performance.now() < deadline) {
    const editor = window.__cowartEditor
    if (editor?.getCurrentPageShapeIds().size === count && document.querySelector('.tl-canvas')) {
      await document.fonts.ready
      const images = [...document.querySelectorAll('.tl-image')]
      if (images.length && images.every(img => img.complete && img.naturalWidth > 0)) {
        await Promise.all(images.map(img => img.decode()))
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const target = editor.getShapePageBounds(targetId)
        const point = editor.pageToScreen(target.center)
        return { navigationReadyMs: performance.now(), point: { x: point.x, y: point.y }, camera: { ...editor.getCamera() }, renderedImages: images.length, documentShapes: count, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio } }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('画布数量、图片解码或交互挂载未在 60 秒内就绪。')
}

export function inspectState({ targetId }) {
  const editor = window.__cowartEditor, shape = editor.getShape(targetId)
  const point = editor.pageToScreen(editor.getShapePageBounds(targetId).center)
  return { camera: { ...editor.getCamera() }, shape: { x: shape.x, y: shape.y }, selected: editor.getSelectedShapeIds().includes(targetId), selectedIds: editor.getSelectedShapeIds(), point: { x: point.x, y: point.y } }
}

export async function resetCamera({ camera }) {
  window.__cowartEditor.selectNone()
  window.__cowartEditor.setCamera(camera, { immediate: true, force: true })
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

export function startFrames() {
  const capture = { start: performance.now(), times: [], active: true, zoomRange: { min: Infinity, max: -Infinity } }
  window.__hiCanvasPerfCapture = capture
  function tick(time) {
    if (!capture.active) return
    capture.times.push(time)
    const z = window.__cowartEditor.getCamera().z
    capture.zoomRange.min = Math.min(capture.zoomRange.min, z)
    capture.zoomRange.max = Math.max(capture.zoomRange.max, z)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

export function stopFrames() {
  const capture = window.__hiCanvasPerfCapture
  capture.active = false
  return { start: capture.start, end: performance.now(), times: capture.times, zoomRange: capture.zoomRange }
}
