// The preview owns readiness and camera input. This adapter observes only its
// public hook/DOM and uses the narrowly scoped measurement camera reset.
export async function waitUntilReady({ count, counts }) {
  const deadline = performance.now() + 60000
  while (performance.now() < deadline) {
    const state = window.__HICANVAS_RENDERER_PREVIEW__?.getState()
    if (state?.error) throw new Error(`新预览加载失败：${state.error}`)
    if (state?.ready && state.count === count && state.renderedShapes === count && state.imageCount === counts.image && state.decodedImages === counts.image) {
      const images = [...document.querySelectorAll('#canvas img')]
      if (document.fonts.status === 'loaded' && images.length === counts.image && images.every(image => image.complete && image.naturalWidth > 0)) {
        // Public ready already follows fonts, full decoding and two frames.
        // Waiting again would add a second double-frame delay only to preview.
        return { navigationReadyMs: performance.now(), point: { x: innerWidth / 2, y: innerHeight / 2 }, camera: state.camera, renderedImages: images.length, decodedImages: state.decodedImages, documentShapes: state.renderedShapes, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio } }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('新预览数量、字体或全部图片解码未在 60 秒内就绪。')
}

export function inspectState() {
  const state = window.__HICANVAS_RENDERER_PREVIEW__.getState()
  return { camera: state.camera, shape: null, selected: false, selectedIds: [], point: { x: innerWidth / 2, y: innerHeight / 2 }, renderedShapes: state.renderedShapes, decodedImages: state.decodedImages }
}

export async function resetCamera({ camera }) {
  window.__HICANVAS_RENDERER_PREVIEW__.resetCamera(camera)
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

export function getCamera() {
  return window.__HICANVAS_RENDERER_PREVIEW__.getCamera()
}
