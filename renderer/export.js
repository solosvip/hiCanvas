import { createExportScene, serializeExportScene } from './export-scene.js'
import { exportBounds, exportSize, CANVAS_EXPORT_LIMITS } from './export-bounds.js'
import { createExportAssets, waitExport } from './export-assets.js'
import { exportRaster } from './export-raster.js'
import { prepareExportMedia } from './export-media.js'
export { CANVAS_EXPORT_LIMITS } from './export-bounds.js'

export function preflightCanvasExport(snapshot, options = {}) {
  const scene = createExportScene(snapshot, options)
  return exportSize(scene.shapes.length ? options.bounds || exportBounds(scene) : null, { ...options, scale: options.scale ?? (options.format === 'svg' ? 1 : 2) })
}

export async function renderCanvasExport(snapshot, options = {}) {
  const format = options.format || 'png'
  if (!['svg', 'png'].includes(format)) throw new Error('输出格式仅支持SVG或PNG。')
  if (options.background != null && !/^(?:#[0-9a-f]{3,8}|rgba?\([\d.,%\s/]+\)|hsla?\([\d.,%\s/]+\)|white|black|transparent)$/i.test(options.background)) throw new Error('输出背景需要普通颜色。')
  options.signal?.throwIfAborted()
  const scene = createExportScene(snapshot, options)
  const size = exportSize(scene.shapes.length ? options.bounds || exportBounds(scene) : null, { ...options, scale: options.scale ?? (format === 'svg' ? 1 : 2) })
  if (size.status === 'empty') return size
  const duration = options.timeout ?? CANVAS_EXPORT_LIMITS.timeout
  if (!Number.isFinite(duration) || duration <= 0 || duration > CANVAS_EXPORT_LIMITS.timeout) throw new Error('输出超时时间无效。')
  const controller = new AbortController(), signal = controller.signal, cleanups = []
  const abort = () => controller.abort(options.signal.reason)
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('输出超过所设期限。')), duration)
  const assets = createExportAssets({ ...options, document: options.document || globalThis.document, signal })
  let failure
  try {
    const media = await prepareExportMedia(scene, { ...options, scale: size.scale, document: options.document || globalThis.document, assets, stats: assets.stats, signal, cleanups })
    // Pin mounted media before any await. Load the CJS serializer only for an
    // actual export, so the old application's unused output stays tree-shaken.
    const { renderToStaticMarkup } = await waitExport(import('react-dom/server.browser'), signal)
    const fontCss = await assets.fonts(scene.shapes)
    signal.throwIfAborted()
    const svg = serializeExportScene(scene, size, { background: options.background, media, fontCss, renderToStaticMarkup })
    const bytes = format === 'svg' ? new TextEncoder().encode(svg) : await exportRaster(svg, size, { document: options.document || globalThis.document, signal })
    signal.throwIfAborted()
    if (bytes.length > CANVAS_EXPORT_LIMITS.bytes) throw new Error('输出文件超过64MB上限。')
    return { ...size, status: 'complete', mime: format === 'svg' ? 'image/svg+xml' : 'image/png', bytes, ...assets.stats, warnings: assets.warnings() }
  } catch (error) { failure = error; controller.abort(error); Object.assign(error, assets.stats); throw error }
  finally {
    const released = await Promise.allSettled(cleanups.reverse().map(cleanup => waitExport(Promise.resolve().then(cleanup), AbortSignal.timeout(2500))))
    const cleanupFailure = released.find(result => result.status === 'rejected')?.reason
    clearTimeout(timer); options.signal?.removeEventListener('abort', abort)
    if (cleanupFailure && !failure) { assets.stats.failedResources++; Object.assign(cleanupFailure, assets.stats); throw cleanupFailure }
    if (signal.aborted && !failure) { Object.assign(signal.reason, assets.stats); throw signal.reason }
  }
}
