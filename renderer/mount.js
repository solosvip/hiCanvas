import { createElement, Fragment } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { atom } from '@tldraw/state'
import { checkedCamera, hitTestCanvas } from './geometry.js'
import { createScene } from './scene.js'
import { CanvasWorld } from './shapes.js'
import { CanvasOverlays, checkedOverlays } from './overlays.js'

// The caller owns the Store and input events. Coordinates are CSS pixels
// relative to element's upper-left corner. This mount never writes to the Store.
export function mountCanvasRenderer(element, { store, camera, pageId, loadGeneratedFrame, reduceMotion = false } = {}) {
  if (!element?.ownerDocument || !store?.getStoreSnapshot) throw new Error('渲染器需要页面元素和模型 Store。')
  if (typeof reduceMotion !== 'boolean') throw new Error('减少动画偏好需要布尔值。')
  const view = atom('renderer camera', checkedCamera(camera)), overlays = atom('renderer overlays', checkedOverlays([]))
  const host = element.ownerDocument.createElement('div')
  Object.assign(host.style, { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none', textSpacingTrim: 'space-all', textAutospace: 'no-autospace' })
  host.dataset.canvasRenderer = ''
  element.append(host)
  const scene = createScene(store, pageId), root = createRoot(host)
  scene.loadGeneratedFrame = loadGeneratedFrame
  scene.reduceMotion = atom('renderer image motion', reduceMotion)
  let active = true
  const unmount = () => {
    if (!active) return
    active = false
    try { flushSync(() => root.unmount()) } finally { scene.dispose(); host.remove() }
  }
  try { flushSync(() => root.render(createElement(Fragment, null,
    createElement('style', null, '[data-canvas-renderer] [contenteditable] { text-spacing-trim: space-all; text-autospace: no-autospace; word-break: normal; overflow-wrap: break-word; white-space: pre-wrap; tab-size: 2; }'),
    createElement(CanvasWorld, { scene, camera: view }), createElement(CanvasOverlays, { camera: view, overlays, reduceMotion: scene.reduceMotion })))) }
  catch (error) { unmount(); throw error }
  const assertActive = () => { if (!active) throw new Error('渲染器已卸载。') }
  return Object.freeze({
    getCamera() { assertActive(); return { ...view.get() } },
    setCamera(value) { assertActive(); view.set(checkedCamera(value)) },
    setOverlays(value) { assertActive(); overlays.set(checkedOverlays(value)) },
    setReduceMotion(value) { assertActive(); if (typeof value !== 'boolean') throw new Error('减少动画偏好需要布尔值。'); scene.reduceMotion.set(value) },
    hitTest(point) { assertActive(); return hitTestCanvas(store.getStoreSnapshot(), point, view.get(), scene.pageId) },
    unmount
  })
}
