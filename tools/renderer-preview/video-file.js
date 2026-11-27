import { maxVideoBytes } from '../../engine/index.js'

export async function readVideoFile(file, document, signal) {
  signal?.throwIfAborted()
  const mimeType = file.type || ({ mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' })[file.name.split('.').at(-1).toLowerCase()]
  if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(mimeType)) throw new Error('请选择 MP4、WebM 或 MOV 视频。')
  if (!file.size || file.size > maxVideoBytes) throw new Error('视频需要非空且不超过 37 MB。')
  const url = URL.createObjectURL(file), node = document.createElement('video')
  try {
    await new Promise((resolve, reject) => {
      const done = error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve() }
      const abort = () => done(new Error('视频读取已取消。'))
      const timer = setTimeout(() => done(new Error('视频读取超时。')), 10000)
      node.onloadedmetadata = () => done()
      node.onerror = () => done(new Error('视频损坏或当前浏览器不支持该编码。'))
      signal?.addEventListener('abort', abort, { once: true })
      node.src = url
    })
    if (![node.videoWidth, node.videoHeight].every(n => n > 0 && n <= 16384)) throw new Error('视频尺寸无效。')
    signal?.throwIfAborted()
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader(), abort = () => reader.abort()
      const done = error => { signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(reader.result) }
      reader.onload = () => done(); reader.onerror = () => done(new Error('视频读取失败。')); reader.onabort = () => done(new Error('视频读取已取消。'))
      signal?.addEventListener('abort', abort, { once: true }); reader.readAsDataURL(file)
    })
    return { w: node.videoWidth, h: node.videoHeight, name: file.name, mimeType, fileSize: file.size, dataUrl: dataUrl.replace(/^data:[^;]+;/, `data:${mimeType};`) }
  } finally { node.onloadedmetadata = node.onerror = null; node.removeAttribute('src'); node.load(); URL.revokeObjectURL(url) }
}

