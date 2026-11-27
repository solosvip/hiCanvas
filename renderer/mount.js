import { createElement, Fragment } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { atom } from '@tldraw/state'
import { checkedCamera, hitTestCanvas } from './geometry.js'
import { createScene } from './scene.js'
import { CanvasWorld } from './shapes.js'
import { CanvasOverlays, checkedOverlays } from './overlays.js'
import { CanvasGrid } from './grid.js'
import { createTextEditingView } from './text-editing-view.js'
import { textEditingStyle } from './text-editing-style.js'
import { createEraserPreview } from './eraser-preview.js'
import { ShapeLinks, createShapeLinkState, shapeLinkHitSize } from './shape-links.js'

// The caller owns the Store and input events. Coordinates are CSS pixels
// relative to element's upper-left corner. This mount never writes to the Store.
export function mountCanvasRenderer(element, { store, camera, pageId, loadGeneratedFrame, reduceMotion = false, textEditing, onVideoInput, onEmbedInput } = {}) {
  if (!element?.ownerDocument || !store?.getStoreSnapshot) throw new Error('渲染器需要页面元素和模型 Store。')
  if (typeof reduceMotion !== 'boolean') throw new Error('减少动画偏好需要布尔值。')
  const view = atom('renderer camera', checkedCamera(camera)), overlays = atom('renderer overlays', checkedOverlays([]))
  const links = createShapeLinkState(() => shapeLinkHitSize(element))
  const eraserPreview = createEraserPreview(store, element.ownerDocument.defaultView.getComputedStyle(element).getPropertyValue('--color-overlay-eraser-preview'))
  const host = element.ownerDocument.createElement('div')
  Object.assign(host.style, { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none', textSpacingTrim: 'space-all', textAutospace: 'no-autospace' })
  host.dataset.canvasRenderer = ''
  element.append(host)
  const scene = createScene(store, pageId), root = createRoot(host)
  scene.editingId = atom('renderer editing text', null)
  scene.videoState = atom('renderer video state', null)
  scene.onVideoInput = onVideoInput
  scene.embedInteraction = atom('renderer embed interaction', null)
  scene.onEmbedInput = onEmbedInput
  scene.eraserPreview = eraserPreview
  const textView = createTextEditingView(element, store, textEditing)
  scene.loadGeneratedFrame = loadGeneratedFrame
  scene.reduceMotion = atom('renderer image motion', reduceMotion)
  let active = true, editingDescription = null
  const unmount = () => {
    if (!active) return
    active = false
    try { textView.dispose() }
    finally { try { flushSync(() => root.unmount()) } finally { try { scene.eraserPreview.dispose(); scene.dispose() } finally { host.remove() } } }
  }
  try { flushSync(() => root.render(createElement(Fragment, null,
    createElement('style', null, textEditingStyle),
    createElement('style', null, '[data-canvas-renderer] [contenteditable] { text-spacing-trim: space-all; text-autospace: no-autospace; word-break: normal; overflow-wrap: break-word; white-space: pre-wrap; tab-size: 2; }'),
    createElement(CanvasGrid, { camera: view, overlays }), createElement(CanvasWorld, { scene, camera: view }), createElement(CanvasOverlays, { camera: view, overlays, reduceMotion: scene.reduceMotion }), createElement(ShapeLinks, { camera: view, links: links.state })))) }
  catch (error) { unmount(); throw error }
  const assertActive = () => { if (!active) throw new Error('渲染器已卸载。') }
  return Object.freeze({
    getCamera() { assertActive(); return { ...view.get() } },
    setCamera(value) { assertActive(); const next = checkedCamera(value), previous = view.get(); if (next.x !== previous.x || next.y !== previous.y || next.z !== previous.z) view.set(next); if (editingDescription) textView.update(editingDescription, view.get()) },
    setTextEditing(value) {
      assertActive()
      if (value && typeof textEditing?.onChange !== 'function') throw new Error('文字视图需要宿主提供草稿回调。')
      const description = value && structuredClone(value)
      editingDescription = description
      scene.editingId.set(description?.id || null)
      textView.update(description, view.get())
    },
    setVideoInteraction(value) { assertActive(); scene.videoState.set(value) },
    setEmbedInteraction(id) { assertActive(); if (id !== null && typeof id !== 'string') throw new Error('嵌入互动需要对象ID或null。'); scene.embedInteraction.set(id) },
    setShapeLinks(value) { assertActive(); links.set(value) },
    setOverlays(value) { assertActive(); const next = checkedOverlays(value); scene.eraserPreview.set(next); overlays.set(next) },
    setReduceMotion(value) { assertActive(); if (typeof value !== 'boolean') throw new Error('减少动画偏好需要布尔值。'); scene.reduceMotion.set(value) },
    hitTest(point) { assertActive(); return hitTestCanvas(store.getStoreSnapshot(), point, view.get(), scene.pageId) },
    unmount
  })
}
