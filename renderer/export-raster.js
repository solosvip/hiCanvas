import { waitExport } from './export-assets.js'

export async function exportRaster(svg, size, { document: doc, signal }) {
  if (!doc) throw new Error('PNG输出需要浏览器画布。')
  const image = doc.createElement('img'), url = doc.defaultView.URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  const canvas = doc.createElement('canvas')
  try {
    image.src = url
    await waitExport(image.decode(), signal)
    signal.throwIfAborted()
    canvas.width = size.width; canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建输出画布。')
    context.drawImage(image, 0, 0, size.width, size.height)
    const blob = await waitExport(new Promise(resolve => canvas.toBlob(resolve, 'image/png')), signal)
    if (!blob) throw new Error('PNG编码失败。')
    return new Uint8Array(await waitExport(blob.arrayBuffer(), signal))
  } finally { image.removeAttribute('src'); doc.defaultView.URL.revokeObjectURL(url); canvas.width = canvas.height = 0 }
}
