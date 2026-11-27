// Temporary video toolbar; file I/O and upload lifecycle use the shared host.
import { createMediaUpload } from './media-upload.js'

export function attachVideoUi(host, interaction, session, metadata, onError) {
  const doc = host.ownerDocument, panel = doc.createElement('div'), file = doc.createElement('input'), button = doc.createElement('button'), alt = doc.createElement('textarea'), saveAlt = doc.createElement('button')
  panel.id = 'image-tools'; panel.dataset.videoToolbar = ''; panel.setAttribute('role', 'toolbar'); panel.setAttribute('aria-label', '视频')
  file.type = 'file'; file.accept = 'video/mp4,video/webm,video/quicktime'; file.hidden = true
  button.type = 'button'; button.textContent = '替换视频'; button.dataset.videoAction = 'replace'
  alt.setAttribute('aria-label', '视频替代文字'); alt.dataset.videoAction = 'alt-text'; alt.maxLength = 10000
  saveAlt.type = 'button'; saveAlt.textContent = '保存替代文字'; saveAlt.dataset.videoAction = 'save-alt-text'
  panel.append(button, file, alt, saveAlt); doc.body.append(panel)
  let state = interaction.state.get(), pendingId = null, busy = false, disposed = false, altId = null, altBasis = null, altDirty = false
  const upload = createMediaUpload({ session, interaction, metadata, document: doc, onError, onBusy: value => { busy = value; if (!disposed) update() } })
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
  const intake = (files, point, id = null) => upload.importFiles(files, point, id)
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
  return { update, importFiles: intake, dispose() { disposed = true; upload.dispose(); alt.removeEventListener('input', editAlt); button.removeEventListener('click', replace); saveAlt.removeEventListener('click', save); file.removeEventListener('change', change); host.removeEventListener('dragover', drag); host.removeEventListener('drop', drop); panel.remove() } }
}
