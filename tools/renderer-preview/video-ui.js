// Temporary interaction-preview host: #143 moves the adapter into the product.
// #137 image import and #136/#176 file paste reuse the public media entry.
import { maxVideoBytes, createMediaImport } from '../../engine/index.js'
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

export function attachVideoUi(host, interaction, session, metadata, onError) {
  const doc = host.ownerDocument, panel = doc.createElement('div'), file = doc.createElement('input'), button = doc.createElement('button'), alt = doc.createElement('textarea'), saveAlt = doc.createElement('button')
  panel.id = 'image-tools'; panel.dataset.videoToolbar = ''; panel.setAttribute('role', 'toolbar'); panel.setAttribute('aria-label', '视频')
  file.type = 'file'; file.accept = 'video/mp4,video/webm,video/quicktime'; file.hidden = true
  button.type = 'button'; button.textContent = '替换视频'; button.dataset.videoAction = 'replace'
  alt.setAttribute('aria-label', '视频替代文字'); alt.dataset.videoAction = 'alt-text'; alt.maxLength = 10000
  saveAlt.type = 'button'; saveAlt.textContent = '保存替代文字'; saveAlt.dataset.videoAction = 'save-alt-text'
  panel.append(button, file, alt, saveAlt); doc.body.append(panel)
  let state = interaction.state.get(), pendingId = null, busy = false, disposed = false, altId = null, altBasis = null, altDirty = false
  const lifecycle = new AbortController()
  const mediaImport = createMediaImport({ session, interaction, pageId: metadata.viewState.currentPageId })
  const selected = () => state.selectedIds.length === 1 && session.store.get(state.selectedIds[0])?.type === 'video' ? state.selectedIds[0] : null
  function update(value = state) {
    state = value
    const id = selected(), shape = id && session.store.get(id)
    button.disabled = busy || !id || shape.isLocked || session.state.get().isSubmitting
    alt.disabled = saveAlt.disabled = button.disabled
    const text = shape?.props.altText || ''
    if (id !== altId || !altDirty && text !== altBasis) { alt.value = text; altDirty = false }
    altId = id; altBasis = text
  }
  async function intake(files, point, id = null) {
    if (disposed || !files.length || busy) return
    busy = true; update()
    let ticket
    try {
      ticket = mediaImport.begin({ point, replaceId: id })
      if (!metadata.persistent) throw new Error('视频上传请使用隔离交互预览。')
      const videos = []
      for (const chosen of files) {
        const video = await readVideoFile(chosen, doc, lifecycle.signal)
        lifecycle.signal.throwIfAborted()
        const response = await fetch(`/api/canvas/reference?conversation=${encodeURIComponent(metadata.conversationId)}`, { method: 'POST', signal: lifecycle.signal, headers: { 'content-type': 'application/json', 'x-hicanvas-client': '1' }, body: JSON.stringify({ dataUrl: video.dataUrl }) })
        const saved = await response.json()
        if (!response.ok) throw new Error(saved.error || '视频上传失败。')
        lifecycle.signal.throwIfAborted()
        videos.push({ ...video, dataUrl: undefined, src: saved.src, mimeType: saved.mimeType })
      }
      if (disposed) return
      await ticket.commit(videos)
    } catch (error) { if (!disposed) onError(error) }
    finally { ticket?.cancel(); busy = false; if (!disposed) update() }
  }
  const editAlt = () => { altDirty = true }
  alt.addEventListener('input', editAlt)
  const replace = () => { pendingId = selected(); file.value = ''; file.click() }
  const save = async () => {
    const id = selected()
    if (disposed || !id || busy || session.state.get().isSubmitting || session.state.get().isGestureActive) return
    try { session.beginGesture(); session.preview([{ type: 'set_video_alt_text', id, altText: alt.value }]); await session.commitGesture(); if (disposed) return; altDirty = false; update(); host.focus({ preventScroll: true }) }
    catch (error) { if (disposed) return; session.cancelGesture(); onError(error) }
  }
  const change = () => { if (pendingId) void intake([...file.files].slice(0, 1), { x: 0, y: 0 }, pendingId) }
  const point = event => { const box = host.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top } }
  const drop = event => { const files = [...event.dataTransfer.files]; if (!files.length) return; event.preventDefault(); void intake(files, point(event)) }
  const drag = event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault() }
  button.addEventListener('click', replace); saveAlt.addEventListener('click', save); file.addEventListener('change', change); host.addEventListener('dragover', drag); host.addEventListener('drop', drop)
  return { update, importFiles: intake, dispose() { disposed = true; lifecycle.abort(); alt.removeEventListener('input', editAlt); button.removeEventListener('click', replace); saveAlt.removeEventListener('click', save); file.removeEventListener('change', change); host.removeEventListener('dragover', drag); host.removeEventListener('drop', drop); panel.remove() } }
}
