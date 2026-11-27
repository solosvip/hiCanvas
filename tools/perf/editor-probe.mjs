export { waitUntilReady, getCamera } from './renderer-probe.mjs'

// Only observe the public preview hook. Native input still goes through the
// same DOM host and editing state machine as the other interaction checks.
export function inspectState({ targetId }) {
  const state = window.__HICANVAS_RENDERER_PREVIEW__.inspectTarget(targetId)
  if (state.lastError) throw new Error(state.lastError.message || state.lastError)
  const { shape, camera, selectedIds } = state
  if (!shape) throw new Error(`测量目标不存在：${targetId}`)
  return { ...state, selected: selectedIds.includes(targetId), point: {
    x: (shape.x + shape.w / 2 + camera.x) * camera.z,
    y: (shape.y + shape.h / 2 + camera.y) * camera.z,
  } }
}

export async function resetCamera({ camera }) {
  window.__HICANVAS_RENDERER_PREVIEW__.resetCamera(camera, { clearSelection: true })
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}
