import './style.css'
import { react } from '@tldraw/state'
import { createEditorSession, createCanvasInteraction } from '../../engine/index.js'
import { mountCanvasRenderer } from '../../renderer/index.js'
import { createGallery } from './gallery.js'
import { attachPreviewInput } from './input.js'
import { memoryTransport, previewTransport } from './transport.js'

let ready = false, renderer, controls, metadata, interaction, session, cameraTimer, failure = null, decodedImages = 0, snapshotReads = 0
const disposers = []
const cleanup = () => { clearTimeout(cameraTimer); for (const dispose of disposers.splice(0).reverse()) { try { dispose() } catch { /* Continue releasing remaining preview resources. */ } } }
const host = document.querySelector('#canvas'), status = document.querySelector('#status')
const getState = () => {
  const state = interaction?.state.get()
  return Object.freeze({ ready, error: failure, count: metadata?.count || 0, counts: metadata ? Object.freeze({ ...metadata.counts }) : null, camera: state ? { ...state.camera } : null,
    selectedIds: state ? [...state.selectedIds] : [], hoveredId: state?.hoveredId || null, mode: state?.mode || 'idle',
    selectedShapes: (state?.selectedIds || []).map(id => { const r = session.store.get(id); return r && { id, x: r.x, y: r.y } }).filter(Boolean),
    revision: session?.state.get().revision, submitting: session?.state.get().isSubmitting || false, lastError: state?.lastError || session?.state.get().lastError || null,
    snapshotReads, renderedShapes: host.querySelectorAll('[data-shape-id]').length, imageCount: host.querySelectorAll('img').length, decodedImages })
}
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
  const transport = metadata.persistent ? previewTransport(metadata.conversationId) : memoryTransport(metadata.snapshot)
  const actorKey = `preview-actor:${metadata.conversationId || gallery || metadata.count}`
  const actor = sessionStorage.getItem(actorKey) || `preview:${crypto.randomUUID()}`
  sessionStorage.setItem(actorKey, actor)
  const camera = await transport.loadCamera?.() || metadata.viewState.camera
  session = await createEditorSession({ transport, actor })
  disposers.push(() => session.dispose())
  // Observation counter proves pointer hit queries do not serialize the board.
  const originalSnapshot = session.store.getStoreSnapshot.bind(session.store)
  session.store.getStoreSnapshot = (...args) => { snapshotReads++; return originalSnapshot(...args) }
  interaction = createCanvasInteraction({ session, camera, pageId: metadata.viewState.currentPageId })
  disposers.push(() => interaction.dispose())
  renderer = mountCanvasRenderer(host, { store: session.store, camera, pageId: metadata.viewState.currentPageId })
  disposers.push(() => renderer.unmount())
  const showError = error => { status.textContent = `操作失败：${error.message}` }
  const stop = react('preview interaction view', () => {
    const state = interaction.state.get()
    renderer.setCamera(state.camera); renderer.setOverlays(state.overlays)
    clearTimeout(cameraTimer)
    if (metadata.persistent) cameraTimer = setTimeout(() => { void transport.saveCamera({ ...metadata.viewState, camera: state.camera }).catch(showError) }, 200)
  })
  disposers.push(stop)
  controls = attachPreviewInput(host, interaction, { onError: showError })
  disposers.push(() => controls.dispose())
  window.addEventListener('pagehide', cleanup, { once: true })
  await document.fonts.ready
  await Promise.all([...host.querySelectorAll('img')].map(async image => { await image.decode(); decodedImages++ }))
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  if (getState().renderedShapes !== metadata.count) throw new Error('渲染元素数量与合成快照不一致。')
  ready = true
  status.textContent = `${metadata.count} 个合成元素 · 点选／Shift 加减选 · 空白拖框 · 拖动移动 · Esc 取消${metadata.persistent ? ' · 松手保存' : ' · 临时预览，刷新还原'}`
} catch (error) { cleanup(); failure = error.message; status.textContent = `预览失败：${failure}` }
