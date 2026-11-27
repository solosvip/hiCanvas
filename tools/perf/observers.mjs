import * as legacy from './page-probe.mjs'
import * as preview from './renderer-probe.mjs'
import * as editor from './editor-probe.mjs'

export function pageObserver(renderer, previewMode = 'editor') {
  if (renderer === 'legacy') return { ...legacy, requiresSelection: true, canDrag: true }
  if (renderer === 'preview' && previewMode === 'renderer') return { ...preview, requiresSelection: false, canDrag: false }
  if (renderer === 'preview' && previewMode === 'editor') return { ...editor, requiresSelection: true, canDrag: true }
  throw new Error(`未知页面观察实现：${renderer}`)
}

export function cameraReaderScript(observer) {
  // IPC cannot clone a returned function; installation must return void.
  return `window.__hiCanvasPerfCamera = (${observer.getCamera.toString()}); void 0`
}
