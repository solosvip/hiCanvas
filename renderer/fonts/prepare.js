import { canvasFontFaces } from './manifest.js'

const preparations = new WeakMap()

// Call before mounting. Layout must never measure a transient system fallback
// while the local faces are still loading. Failure is retryable per document.
export function prepareCanvasFonts(target = globalThis.document) {
  const Face = target?.defaultView?.FontFace
  if (!Face || !target.fonts?.add || !target.fonts?.delete) throw new Error('当前环境不支持本地字体加载。')
  if (preparations.has(target)) return preparations.get(target)
  const added = []
  const pending = Promise.all(canvasFontFaces.map(({ family, url, weight, style }) =>
    new Face(family, `url("${url.href}") format("woff2")`, { weight, style }).load()))
    .then(faces => {
      for (const face of faces) { target.fonts.add(face); added.push(face) }
    }).catch(error => {
      for (const face of added) target.fonts.delete(face)
      preparations.delete(target)
      throw new Error(`画板字体加载失败，请重新打开画板：${error.message}`, { cause: error })
    })
  preparations.set(target, pending)
  return pending
}
