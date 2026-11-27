import { createMediaImport } from '../../engine/index.js'
import { readVideoFile } from './video-file.js'

const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/apng', 'image/avif', 'image/svg+xml']
const extensions = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', apng: 'image/apng', avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }
function untilAborted(pending, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}
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
async function prepareImage(file, document, metadata, signal, request) {
  const mimeType = fileType(file), svg = mimeType === 'image/svg+xml', warnings = new Set()
  if (svg && !metadata.persistent) throw new Error('只读图鉴没有 SVG 准备能力，请使用隔离交互预览。')
  if (!file.size || file.size > (svg ? 2 : 20) * 1024 * 1024) throw new Error(svg ? 'SVG 需要非空且不超过 2 MiB。' : '图片需要非空且不超过 20 MB。')
  let dataUrl = (await readData(file, signal)).replace(/^data:[^;]*;/, `data:${mimeType};`)
  signal.throwIfAborted()
  async function upload(purpose) {
    const result = await request({ purpose, dataUrl }, signal)
    for (const warning of result.warnings || []) warnings.add(warning)
    signal.throwIfAborted()
    return result
  }
  if (svg) {
    // Untrusted bytes are sent only to the sanitizer. No img/DOM receives
    // them, and cancelled/undecodable prepared bytes never reach final upload.
    dataUrl = (await upload('file-import-prepare')).dataUrl
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/svg+xml;base64,')) throw new Error('SVG 准备结果无效。')
  } else {
    const bytes = atob(dataUrl.split(',')[1]), head = bytes.slice(0, 12)
    const valid = mimeType === 'image/png' || mimeType === 'image/apng' ? head.startsWith('\x89PNG\r\n\x1a\n') : mimeType === 'image/jpeg' ? head.startsWith('\xff\xd8') : mimeType === 'image/gif' ? /^GIF8[79]a/.test(head) : mimeType === 'image/webp' ? head.startsWith('RIFF') && head.endsWith('WEBP') : head.slice(4, 8) === 'ftyp'
    if (!valid) throw new Error('图片损坏或文件头与格式不符。')
  }
  const dimensions = await decodeImage(dataUrl, document, signal)
  let saved
  if (metadata.persistent) {
    saved = await upload('file-import')
  } else {
    // Read-only galleries have no server board. Raster signatures forbid an
    // SVG disguised as PNG even in their temporary memory-only replacements.
    saved = { src: dataUrl, mimeType, isAnimated: ['image/gif', 'image/apng', 'image/webp'].includes(mimeType) }
  }
  signal.throwIfAborted()
  return { ...dimensions, src: saved.src, name: file.name, mimeType: saved.mimeType, isAnimated: Boolean(saved.isAnimated), warnings: [...warnings] }
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
      if (!supported.length) { onError(new Error('文件格式暂不支持，未导入。')); return false }
      if (supported.length > 100) { onError(new Error('一次最多导入 100 个媒体文件。')); return false }
      if (supported.filter(file => fileType(file) === 'image/svg+xml').reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) { onError(new Error('一批 SVG 合计不能超过 8 MiB。')); return false }
      const signal = AbortSignal.any([lifecycle.signal, AbortSignal.timeout(60000)])
      let ticket, importToken, primaryError, committed = false
      const request = async (args, requestSignal = signal) => {
        const headers = { 'content-type': 'application/json', 'x-hicanvas-client': '1', 'x-hicanvas-actor': metadata.actor || 'http' }
        const post = async (body, activeSignal) => {
          const response = await fetch(`/api/canvas/reference?conversation=${encodeURIComponent(metadata.conversationId)}`, { method: 'POST', signal: activeSignal, headers, body: JSON.stringify(body), ...(body.purpose === 'file-import-abort' && { keepalive: true }) })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || '媒体上传失败。')
          return result
        }
        if (args.purpose !== 'file-import-prepare' && args.purpose !== 'file-import-abort' && !importToken) {
          const started = await post({ purpose: 'file-import-begin', fileCount: supported.length }, requestSignal)
          importToken = started.importToken
          if (typeof importToken !== 'string' || !importToken) throw new Error('媒体导入凭证无效。')
          requestSignal.throwIfAborted()
        }
        return post({ ...args, ...(args.purpose !== 'file-import-prepare' && { importToken }) }, requestSignal)
      }
      busy = true; onBusy(true)
      try {
        ticket = media.begin({ point, replaceId })
        const items = [], warnings = new Set()
        for (const file of supported) {
          signal.throwIfAborted()
          if (imageTypes.includes(fileType(file))) {
            const { warnings: notes, ...item } = await prepareImage(file, document, metadata, signal, request)
            for (const note of notes) warnings.add(note)
            items.push(item)
          }
          else {
            if (!metadata.persistent) throw new Error('视频上传请使用隔离交互预览。')
            const video = await readVideoFile(file, document, signal)
            const saved = await request({ dataUrl: video.dataUrl })
            items.push({ ...video, dataUrl: undefined, src: saved.src, mimeType: saved.mimeType })
          }
        }
        signal.throwIfAborted()
        if (disposed) return false
        await untilAborted(ticket.commit(items), signal)
        committed = true
        if (filtered) warnings.add('部分文件格式暂不支持，已过滤。')
        if (!disposed && warnings.size) onError(new Error([...warnings].join('；')))
        return true
      } catch (error) { primaryError = error; if (!disposed) onError(error); return false }
      finally {
        // Never use the already-aborted import signal for cleanup. The server
        // also handles lost upload/commit receipts and abandoned-window leases.
        if (importToken && !committed) {
          try {
            const result = await request({ purpose: 'file-import-abort' }, AbortSignal.timeout(2000))
            if (result.remaining && !disposed) onError(new Error(`${primaryError?.message || '导入已取消'}；本次临时文件未完全清理，请稍后重试。`))
          } catch { if (!disposed) onError(new Error(`${primaryError?.message || '导入已取消'}；本次临时文件未完全清理，请稍后重试。`)) }
        }
        ticket?.cancel(); busy = false; if (!disposed) onBusy(false)
      }
    },
    dispose() { disposed = true; lifecycle.abort() },
  }
}
