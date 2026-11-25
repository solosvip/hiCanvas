import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { atom } from '@tldraw/state'
import { checkedCamera, hitTestCanvas } from './geometry.js'
import { createScene } from './scene.js'
import { CanvasWorld } from './shapes.js'

// The caller owns the Store and input events. Coordinates are CSS pixels
// relative to element's upper-left corner. This mount never writes to the Store.
export function mountCanvasRenderer(element, { store, camera, pageId } = {}) {
  if (!element?.ownerDocument || !store?.getStoreSnapshot) throw new Error('渲染器需要页面元素和模型 Store。')
  const view = atom('renderer camera', checkedCamera(camera))
  const host = element.ownerDocument.createElement('div')
  Object.assign(host.style, { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none' })
  host.dataset.canvasRenderer = ''
  element.append(host)
  const scene = createScene(store, pageId), root = createRoot(host)
  let active = true
  const unmount = () => {
    if (!active) return
    active = false
    try { flushSync(() => root.unmount()) } finally { scene.dispose(); host.remove() }
  }
  try { flushSync(() => root.render(createElement(CanvasWorld, { scene, camera: view }))) }
  catch (error) { unmount(); throw error }
  const assertActive = () => { if (!active) throw new Error('渲染器已卸载。') }
  return Object.freeze({
    getCamera() { assertActive(); return { ...view.get() } },
    setCamera(value) { assertActive(); view.set(checkedCamera(value)) },
    hitTest(point) { assertActive(); return hitTestCanvas(store.getStoreSnapshot(), point, view.get(), scene.pageId) },
    unmount
  })
}
