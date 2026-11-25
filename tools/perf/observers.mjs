import * as legacy from './page-probe.mjs'
import * as preview from './renderer-probe.mjs'

export function pageObserver(renderer) {
  if (renderer === 'legacy') return { ...legacy, requiresSelection: true, canDrag: true }
  if (renderer === 'preview') return { ...preview, requiresSelection: false, canDrag: false }
  throw new Error(`未知页面观察实现：${renderer}`)
}

export function cameraReaderScript(observer) {
  // IPC cannot clone a returned function; installation must return void.
  return `window.__hiCanvasPerfCamera = (${observer.getCamera.toString()}); void 0`
}
