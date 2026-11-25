import './style.css'
import { createCanvasStore } from '../../model/index.js'
import { mountCanvasRenderer, screenToCanvas } from '../../renderer/index.js'
import { createGallery } from './gallery.js'
import { attachPreviewInput } from './input.js'

let ready = false, renderer, controls, metadata, failure = null, decodedImages = 0
const host = document.querySelector('#canvas'), status = document.querySelector('#status')
const getState = () => Object.freeze({ ready, error: failure, count: metadata?.count || 0, counts: metadata ? Object.freeze({ ...metadata.counts }) : null, camera: renderer ? Object.freeze(renderer.getCamera()) : null, renderedShapes: host.querySelectorAll('[data-shape-id]').length, imageCount: host.querySelectorAll('img').length, decodedImages })
// 仅供性能测量的 resetCamera 只改视角；getState 保持只读，不暴露画板。
Object.defineProperty(window, '__HICANVAS_RENDERER_PREVIEW__', { value: Object.freeze({ getState, getCamera: () => controls?.getCamera() || null, resetCamera: camera => {
  if (!controls) throw new Error('预览尚未挂载。')
  controls.resetCamera(camera)
} }), writable: false, configurable: false })

try {
  const params = new URLSearchParams(location.search), gallery = params.get('gallery')
  if (gallery) metadata = createGallery(gallery)
  else {
    const response = await fetch(`/__renderer_fixture?count=${encodeURIComponent(params.get('count') || '500')}`)
    if (!response.ok) throw new Error('合成规模仅支持 500、2000、5000。')
    metadata = await response.json()
  }
  const store = createCanvasStore()
  store.loadStoreSnapshot(metadata.snapshot)
  renderer = mountCanvasRenderer(host, { store, camera: metadata.viewState.camera, pageId: metadata.viewState.currentPageId })
  controls = attachPreviewInput(host, renderer)
  // Temporary input belongs to this development page, never renderer/.
  host.addEventListener('wheel', event => {
    event.preventDefault()
    const camera = renderer.getCamera()
    if (event.ctrlKey) {
      const bounds = host.getBoundingClientRect(), screen = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
      const point = screenToCanvas(screen, camera)
      const z = Math.min(8, Math.max(0.01, camera.z * Math.exp(-event.deltaY * 0.002)))
      renderer.setCamera({ x: screen.x / z - point.x, y: screen.y / z - point.y, z })
    } else renderer.setCamera({ x: camera.x - event.deltaX / camera.z, y: camera.y - event.deltaY / camera.z, z: camera.z })
  }, { passive: false })
  await document.fonts.ready
  await Promise.all([...host.querySelectorAll('img')].map(async image => { await image.decode(); decodedImages++ }))
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  if (getState().renderedShapes !== metadata.count) throw new Error('渲染元素数量与合成快照不一致。')
  ready = true
  status.textContent = `${metadata.count} 个合成元素 · 滚轮平移 · Ctrl+滚轮／捏合缩放 · 只读`
} catch (error) { failure = error.message; status.textContent = `预览失败：${failure}` }
