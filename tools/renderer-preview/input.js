// Temporary preview input, not the new editor's interaction implementation.
export function attachPreviewInput(host, renderer) {
  let drag = null
  const down = event => {
    if (event.button !== 1) return
    event.preventDefault()
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, camera: renderer.getCamera() }
    host.setPointerCapture?.(event.pointerId)
  }
  const move = event => {
    if (!drag || event.pointerId !== drag.id) return
    event.preventDefault()
    const { camera } = drag
    renderer.setCamera({ ...camera, x: camera.x + (event.clientX - drag.x) / camera.z, y: camera.y + (event.clientY - drag.y) / camera.z })
  }
  const up = event => {
    if (drag?.id !== event.pointerId) return
    drag = null
    if (host.hasPointerCapture?.(event.pointerId)) host.releasePointerCapture(event.pointerId)
  }
  const listeners = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: up, lostpointercapture: up }
  for (const [type, listener] of Object.entries(listeners)) host.addEventListener(type, listener)
  return {
    getCamera() {
      const { x, y, z } = renderer.getCamera()
      return { x, y, z }
    },
    // 仅供性能测量：只重置视角，不修改或暴露画板数据。
    resetCamera(camera) {
      if (!camera || !['x', 'y', 'z'].every(key => Number.isFinite(camera[key])) || camera.z <= 0) throw new Error('视角需要有限坐标和正缩放。')
      drag = null
      renderer.setCamera({ x: camera.x, y: camera.y, z: camera.z })
    },
    dispose() { drag = null; for (const [type, listener] of Object.entries(listeners)) host.removeEventListener(type, listener) }
  }
}
