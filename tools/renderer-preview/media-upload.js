import { createMediaImport } from '../../engine/index.js'
import { readVideoFile } from './video-ui.js'

const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/apng', 'image/avif']
const extensions = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', apng: 'image/apng', avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }
function fileType(file) { return file.type && file.type !== 'application/octet-stream' ? file.type : extensions[file.name?.split('.').at(-1).toLowerCase()] }
function readData(file, signal) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(), abort = () => reader.abort()
    const done = error => { signal.removeEventListener('abort', abort); error ? reject(error) : resolve(reader.result) }
    reader.onload = () => done(); reader.onerror = () => done(new Error('图片读取失败。')); reader.onabort = () => done(new Error('图片读取已取消。'))
    signal.addEventListener('abort', abort, { once: true })
    try { signal.throwIfAborted(); reader.readAsDataURL(file) } catch (error) { done(error) }
  })
}
async function decodeImage(src, document, signal) {
  const image = document.createElement('img')
  try {
    await new Promise((resolve, reject) => {
      const done = error => { clearTimeout(timer); signal.removeEventListener('abort', abort); image.onload = image.onerror = null; error ? reject(error) : resolve() }
      const abort = () => done(new Error('图片读取已取消。')), timer = setTimeout(() => done(new Error('图片解码超时。')), 10000)
      signal.addEventListener('abort', abort, { once: true })
      image.onload = () => done(); image.onerror = () => done(new Error('图片损坏或浏览器不支持该编码。'))
      try { signal.throwIfAborted(); image.src = src } catch (error) { done(error) }
    })
    signal.throwIfAborted()
    const w = image.naturalWidth, h = image.naturalHeight
    if (![w, h].every(n => n > 0 && n <= 16384) || w * h > 64 * 1024 * 1024) throw new Error('图片尺寸超限。')
    return { w, h }
  } finally { image.removeAttribute('src') }
}
async function prepareImage(file, document, metadata, signal) {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('图片需要非空且不超过 20 MB。')
  const mimeType = fileType(file), dataUrl = (await readData(file, signal)).replace(/^data:[^;]*;/, `data:${mimeType};`)
  signal.throwIfAborted()
  const bytes = atob(dataUrl.split(',')[1]), head = bytes.slice(0, 12)
  const valid = mimeType === 'image/png' || mimeType === 'image/apng' ? head.startsWith('\x89PNG\r\n\x1a\n') : mimeType === 'image/jpeg' ? head.startsWith('\xff\xd8') : mimeType === 'image/gif' ? /^GIF8[79]a/.test(head) : mimeType === 'image/webp' ? head.startsWith('RIFF') && head.endsWith('WEBP') : head.slice(4, 8) === 'ftyp'
  if (!valid) throw new Error('图片损坏或文件头与格式不符。')
  const dimensions = await decodeImage(dataUrl, document, signal)
  let saved
  if (metadata.persistent) {
    const response = await fetch(`/api/canvas/reference?conversation=${encodeURIComponent(metadata.conversationId)}`, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-hicanvas-client': '1' }, body: JSON.stringify({ purpose: 'file-import', dataUrl }) })
    saved = await response.json()
    if (!response.ok) throw new Error(saved.error || '图片上传失败。')
  } else {
    // Read-only galleries have no server board. Raster signatures forbid an
    // SVG disguised as PNG even in their temporary memory-only replacements.
    saved = { src: dataUrl, mimeType, isAnimated: ['image/gif', 'image/apng', 'image/webp'].includes(mimeType) }
  }
  signal.throwIfAborted()
  return { ...dimensions, src: saved.src, name: file.name, mimeType: saved.mimeType, isAnimated: Boolean(saved.isAnimated) }
}

// Host adapter: file I/O and uploads only. Placement, replacement and the one
// atomic document transaction belong to createMediaImport, including paste.
export function createMediaUpload({ session, interaction, metadata, document, onError, onBusy = () => {} }) {
  const media = createMediaImport({ session, interaction, pageId: metadata.viewState.currentPageId }), lifecycle = new AbortController()
  let busy = false, disposed = false
  return {
    async importFiles(files, point, replaceId = null) {
      if (disposed || busy || !files.length) return false
      const supported = [...files].filter(file => [...imageTypes, 'video/mp4', 'video/webm', 'video/quicktime'].includes(fileType(file)))
      const filtered = supported.length !== files.length
      if (!supported.length) { onError(new Error('文件格式暂不支持（包括 SVG），未导入。')); return false }
      if (supported.length > 100) { onError(new Error('一次最多导入 100 个媒体文件。')); return false }
      const signal = AbortSignal.any([lifecycle.signal, AbortSignal.timeout(60000)])
      let ticket
      busy = true; onBusy(true)
      try {
        ticket = media.begin({ point, replaceId })
        const items = []
        for (const file of supported) {
          signal.throwIfAborted()
          if (imageTypes.includes(fileType(file))) items.push(await prepareImage(file, document, metadata, signal))
          else {
            if (!metadata.persistent) throw new Error('视频上传请使用隔离交互预览。')
            const video = await readVideoFile(file, document, signal)
            const response = await fetch(`/api/canvas/reference?conversation=${encodeURIComponent(metadata.conversationId)}`, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-hicanvas-client': '1' }, body: JSON.stringify({ dataUrl: video.dataUrl }) })
            const saved = await response.json()
            if (!response.ok) throw new Error(saved.error || '视频上传失败。')
            items.push({ ...video, dataUrl: undefined, src: saved.src, mimeType: saved.mimeType })
          }
        }
        signal.throwIfAborted()
        if (disposed) return false
        await ticket.commit(items)
        if (!disposed && filtered) onError(new Error('部分文件格式暂不支持（包括 SVG），已过滤。'))
        return true
      } catch (error) { if (!disposed) onError(error); return false }
      finally { ticket?.cancel(); busy = false; if (!disposed) onBusy(false) }
    },
    dispose() { disposed = true; lifecycle.abort() },
  }
}
