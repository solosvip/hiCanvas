// The preview owns DOM controls; crop decisions and gesture transactions remain
// in engine/interaction. File import only produces an image command payload.
export function attachImageUi(host, interaction, session, renderer, onError, reduceMotion = false) {
  const doc = host.ownerDocument, panel = doc.createElement('div')
  panel.id = 'image-tools'; panel.setAttribute('role', 'toolbar'); panel.setAttribute('aria-label', '图片与裁剪')
  const controls = new Map(), listeners = []
  let state = interaction.state.get(), zooming = false
  function listen(element, type, fn) { element.addEventListener(type, fn); listeners.push(() => element.removeEventListener(type, fn)) }
  const attempt = fn => { try { Promise.resolve(fn()).catch(onError) } catch (error) { onError(error) } }
  const focus = () => host.focus({ preventScroll: true })
  const crop = action => attempt(() => interaction.cropImage(action))
  function button(id, label, action) {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = label; node.dataset.imageAction = id
    listen(node, 'click', () => { attempt(action); focus() }); panel.append(node); controls.set(id, node); return node
  }
  function command(value) {
    if (session.state.get().isGestureActive) throw new Error('请先结束当前手势。')
    session.beginGesture()
    try { session.preview([value]); return session.commitGesture() } catch (error) { session.cancelGesture(); throw error }
  }
  const selected = () => state.selectedIds.length === 1 ? session.store.get(state.selectedIds[0]) : null
  button('crop', '裁剪', () => interaction.cropImage({ type: 'start' }))
  for (const [axis, label] of [['x', '水平镜像'], ['y', '垂直镜像']]) button(`flip-${axis}`, label, () => command({ type: 'flip_shapes', ids: state.selectedIds, axis }))
  const file = doc.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true; panel.append(file)
  button('replace', '替换图片', () => { file.value = ''; file.click() })
  listen(file, 'change', () => attempt(async () => {
    const chosen = file.files[0], id = selected()?.id
    if (!chosen || !id) return
    const src = await new Promise((yes, no) => { const reader = new FileReader(); reader.onload = () => yes(reader.result); reader.onerror = () => no(reader.error); reader.readAsDataURL(chosen) })
    const image = doc.createElement('img'); image.src = src; await image.decode()
    if (selected()?.id !== id || state.croppingId) throw new Error('替换前请重新选择原图片。')
    await command({ type: 'replace_image', id, image: { src, name: chosen.name, w: image.naturalWidth, h: image.naturalHeight, mimeType: chosen.type || 'image/png', isAnimated: /image\/(gif|webp|apng)/.test(chosen.type) } })
    focus()
  }))
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
  return { update(value) {
    state = value
    const shape = selected(), image = shape?.type === 'image', busy = session.state.get().isSubmitting
    for (const [id, control] of controls) {
      const cropping = id.startsWith('aspect-') || ['zoom', 'reset', 'finish', 'cancel'].includes(id)
      control.disabled = !image || busy || cropping && !state.croppingId || !cropping && Boolean(state.croppingId)
      control.hidden = cropping ? !state.croppingId : Boolean(state.croppingId)
    }
    zoomLabel.hidden = !state.croppingId
    if (!zooming) zoom.value = String(state.cropZoom || 0)
    zoomValue.value = `${Math.round(100 + (state.cropZoom || 0) * 2)}%`
    panel.dataset.cropping = String(Boolean(state.croppingId))
  }, dispose() { observer.disconnect(); if (zooming) crop({ type: 'cancel' }); for (const stop of listeners) stop(); panel.remove() } }
}
