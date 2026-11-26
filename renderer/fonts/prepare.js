import { canvasFontFaces } from './manifest.js'
import { canvasFontStyle } from '../font-families.js'
import { prepareTextLayout } from '../text-measure.js'
import { checkTextCalibration } from './calibration.js'

const preparations = new WeakMap()

// Call before mounting. Layout must never measure a transient system fallback
// while the local faces are still loading. Failure is retryable per document.
export function prepareCanvasFonts(target = globalThis.document, { onWarning } = {}) {
  const Face = target?.defaultView?.FontFace
  if (!Face || !target.fonts?.add || !target.fonts?.delete) throw new Error('当前环境不支持本地字体加载。')
  if (preparations.has(target)) return preparations.get(target)
  const added = []
  const fetched = new Map()
  const pending = Promise.all(canvasFontFaces.map(async source => {
    const { family, url, weight, style, key } = source
    if (!fetched.has(url.href)) fetched.set(url.href, target.defaultView.fetch(url.href).then(async response => {
      if (!response.ok) throw new Error('找不到本地字体文件。')
      return new Uint8Array(await response.arrayBuffer())
    }))
    const bytes = await fetched.get(url.href)
    const face = await new Face(family, bytes, { weight, style, variationSettings: canvasFontStyle(key, Number(weight), style).fontVariationSettings }).load()
    return { source: { ...source, bytes }, face }
  })).then(prepared => {
      prepareTextLayout(prepared.map(item => item.source))
      const faces = prepared.map(item => item.face)
      for (const face of faces) { target.fonts.add(face); added.push(face) }
      if (target.createElement) checkTextCalibration(target, onWarning)
    }).catch(error => {
      for (const face of added) target.fonts.delete(face)
      preparations.delete(target)
      throw new Error(`画板字体加载失败，请重新打开画板：${error.message}`, { cause: error })
    })
  preparations.set(target, pending)
  return pending
}
