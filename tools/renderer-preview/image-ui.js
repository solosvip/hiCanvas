import { createMediaUpload } from './media-upload.js'

// Temporary host: DOM/file I/O only, all document intent goes to the engine.
export function attachImageUi(host, interaction, session, renderer, onError, reduceMotion = false, metadata = null) {
  const doc = host.ownerDocument, panel = doc.createElement('div')
  panel.id = 'image-tools'; panel.setAttribute('role', 'toolbar'); panel.setAttribute('aria-label', '图片与裁剪')
  const controls = new Map(), listeners = []
  let state = interaction.state.get(), zooming = false, busy = false, disposed = false, pendingId = null
  const upload = createMediaUpload({ session, interaction, document: doc, metadata: metadata || { viewState: { currentPageId: session.store.allRecords().find(r => r.typeName === 'page').id } }, onError, onBusy: value => { busy = value; update(state) } })
  function listen(element, type, fn) { element.addEventListener(type, fn); listeners.push(() => element.removeEventListener(type, fn)) }
  const failed = error => { if (!disposed) onError(error) }
  const attempt = fn => { try { Promise.resolve(fn()).catch(failed) } catch (error) { failed(error) } }
  const focus = () => { if (!disposed) host.focus({ preventScroll: true }) }
  const crop = action => attempt(() => interaction.cropImage(action))
  function button(id, label, action, restoreFocus = true) {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = label; node.dataset.imageAction = id
    listen(node, 'click', () => { attempt(action); if (restoreFocus) focus() }); panel.append(node); controls.set(id, node); return node
  }
  function command(value) {
    if (session.state.get().isGestureActive) throw new Error('请先结束当前手势。')
    session.beginGesture()
    try { session.preview([value]); return session.commitGesture() } catch (error) { session.cancelGesture(); throw error }
  }
  const selected = () => state.selectedIds.length === 1 ? session.store.get(state.selectedIds[0]) : null
  button('crop', '裁剪', () => interaction.cropImage({ type: 'start' }))
  for (const [axis, label] of [['x', '水平镜像'], ['y', '垂直镜像']]) button(`flip-${axis}`, label, () => command({ type: 'flip_shapes', ids: state.selectedIds, axis }))
  const file = doc.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp,image/gif,image/apng,image/avif'; file.hidden = true; panel.append(file)
  button('import', '导入图片', () => { pendingId = null; file.multiple = true; file.value = ''; file.click() })
  button('replace', '替换图片', () => { pendingId = selected()?.id; file.multiple = false; file.value = ''; file.click() })
  listen(file, 'change', () => attempt(async () => {
    await upload.importFiles([...file.files], { x: host.clientWidth / 2, y: host.clientHeight / 2 }, pendingId)
    focus()
  }))
  const alt = doc.createElement('input'); alt.type = 'text'; alt.maxLength = 10000; alt.hidden = true; alt.dataset.imageAction = 'alt-text'; alt.setAttribute('aria-label', '图片替代文字')
  button('edit-alt', '替代文字', () => { interaction.imageAlt({ type: 'start' }); update(interaction.state.get()); alt.focus(); alt.select() }, false)
  panel.append(alt)
  listen(alt, 'input', () => attempt(() => interaction.imageAlt({ type: 'update', text: alt.value })))
  listen(alt, 'blur', () => attempt(() => interaction.imageAlt({ type: 'finish' })))
  listen(alt, 'keydown', event => {
    if (event.isComposing || event.keyCode === 229 || !['Enter', 'Escape'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    attempt(async () => { await interaction.imageAlt({ type: event.key === 'Enter' ? 'finish' : 'cancel' }); focus() })
  })
  for (const [value, text] of [['original', '原图'], ['square', '正方形'], ['circle', '圆形'], ['landscape', '横向 4:3'], ['portrait', '纵向 3:4'], ['wide', '宽屏 16:9']]) {
    const node = button(`aspect-${value}`, text, () => interaction.cropImage({ type: 'aspect', preset: value }))
    node.setAttribute('aria-label', `裁剪比例：${text}`)
  }
  const zoomLabel = doc.createElement('label'), zoom = doc.createElement('input'), zoomValue = doc.createElement('output')
  zoom.type = 'range'; zoom.min = '0'; zoom.max = '100'; zoom.step = '1'; zoom.setAttribute('aria-label', '裁剪图像缩放'); zoom.dataset.imageAction = 'zoom'
  zoomLabel.textContent = '取景 '; zoomLabel.append(zoom, zoomValue); panel.append(zoomLabel); controls.set('zoom', zoom)
  const startZoom = () => { if (!zooming) { interaction.cropImage({ type: 'zoom_begin' }); zooming = true } }
  const endZoom = () => { if (zooming) { zooming = false; crop({ type: 'zoom_end' }) } }
  listen(zoom, 'pointerdown', () => attempt(startZoom))
  listen(zoom, 'input', () => attempt(() => { startZoom(); interaction.cropImage({ type: 'zoom', value: Number(zoom.value) }) }))
  listen(doc.defaultView, 'pointerup', endZoom)
  listen(zoom, 'pointercancel', () => { if (zooming) { zooming = false; crop({ type: 'cancel' }) } })
  listen(zoom, 'keyup', endZoom)
  listen(zoom, 'blur', endZoom)
  listen(zoom, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); zooming = false; crop({ type: 'cancel' }); focus() }
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); endZoom(); crop({ type: 'finish' }); focus() }
  })
  button('reset', '复位', () => interaction.cropImage({ type: 'reset' }))
  button('finish', '完成', () => interaction.cropImage({ type: 'finish' }))
  button('cancel', '取消当前操作', () => interaction.cropImage({ type: 'cancel' }))
  const motionLabel = doc.createElement('label'), motion = doc.createElement('input')
  motion.type = 'checkbox'; motion.checked = reduceMotion; motion.dataset.imageAction = 'reduce-motion'
  motionLabel.append(motion, doc.createTextNode('减少图片动画')); panel.append(motionLabel)
  listen(motion, 'change', () => renderer.setReduceMotion(motion.checked))
  doc.body.append(panel)
  const navigation = doc.querySelector('#navigation')
  const observer = new doc.defaultView.ResizeObserver(() => panel.style.setProperty('--image-navigation-height', `${navigation.getBoundingClientRect().height}px`))
  observer.observe(navigation)
  function update(value) {
    state = value
    const shape = selected(), image = shape?.type === 'image', submitting = session.state.get().isSubmitting
    for (const [id, control] of controls) {
      const cropping = id.startsWith('aspect-') || ['zoom', 'reset', 'finish', 'cancel'].includes(id)
      control.disabled = (id !== 'import' && (!image || shape.isLocked)) || busy || submitting || cropping && !state.croppingId || !cropping && Boolean(state.croppingId)
      control.hidden = cropping ? !state.croppingId : Boolean(state.croppingId)
    }
    zoomLabel.hidden = !state.croppingId
    if (!zooming) zoom.value = String(state.cropZoom || 0)
    zoomValue.value = `${Math.round(100 + (state.cropZoom || 0) * 2)}%`
    panel.dataset.cropping = String(Boolean(state.croppingId))
    alt.hidden = !state.imageAltEditing; alt.disabled = busy || submitting
    if (state.imageAltEditing && alt.value !== state.imageAltEditing.text) alt.value = state.imageAltEditing.text
  }
  const drag = event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault() }
  const drop = event => {
    const files = [...event.dataTransfer.files]; if (!files.length) return
    event.preventDefault(); const box = host.getBoundingClientRect()
    void upload.importFiles(files, { x: event.clientX - box.left, y: event.clientY - box.top })
  }
  listen(host, 'dragover', drag); listen(host, 'drop', drop)
  return { update, importFiles: (...args) => upload.importFiles(...args), dispose() { disposed = true; upload.dispose(); interaction.imageAlt({ type: 'cancel' }); observer.disconnect(); if (zooming) crop({ type: 'cancel' }); for (const stop of listeners) stop(); panel.remove() } }
}
