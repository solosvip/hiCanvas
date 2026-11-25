// Shared frame clock and zoom sampling for both page observers.
export function startFrames() {
  const capture = { start: performance.now(), times: [], active: true, zoomRange: { min: Infinity, max: -Infinity } }
  window.__hiCanvasPerfCapture = capture
  function tick(time) {
    if (!capture.active) return
    capture.times.push(time)
    const z = window.__hiCanvasPerfCamera().z
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
