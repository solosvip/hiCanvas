// Only host normalization and scheduling live here. Decisions, camera physics
// and tool transitions remain in the window-free interaction module.
export function attachPreviewInput(host, interaction, { onError = () => {} } = {}) {
  const keys = host.ownerDocument?.defaultView || host
  const document = host.ownerDocument
  const captured = new Set()
  let lastTime = 0, animation = null, disposed = false, composing = false
  const owner = target => {
    if (target?.closest?.('[data-canvas-input-owner="video"], [data-canvas-input-owner="embed"]')) return { owner: 'form' }
    if (target?.closest?.('[data-canvas-input-owner="text-editing"]')) return { owner: 'text-editing' }
    // Canvas-owned controls outside the canvas element (the minimap) keep keys on the canvas.
    if (target?.closest?.('[data-canvas-input-owner="canvas"]')) return { owner: 'canvas' }
    if (target?.closest?.('[role="menu"], [role="listbox"], [role="dialog"], dialog')) return { owner: 'menu' }
    if (target?.closest?.('input, textarea, [contenteditable]:not([contenteditable="false"])')) return { owner: 'form' }
    if (target?.closest?.('select')) return { owner: 'select' }
    const control = target?.closest?.('button, a')
    if (control?.getAttribute('aria-haspopup') === 'menu') return { owner: 'menu-trigger', expanded: control.getAttribute('aria-expanded') === 'true' }
    if (target?.closest?.('a')) return { owner: 'anchor' }
    if (target?.closest?.('button')) return { owner: target.closest('[role="toolbar"]') ? 'toolbar-button' : 'button' }
    return { owner: !target || target === document?.body || target === host || host.contains?.(target) ? 'canvas' : 'form' }
  }
  const reportContext = target => interaction.setInputContext({ ...owner(target), ownsArrows: Boolean(target?.closest?.('[data-canvas-own-arrows]')), isComposing: composing })
  const point = event => {
    const box = host.getBoundingClientRect?.() || { left: 0, top: 0 }
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  const modifiers = event => Object.fromEntries(['shiftKey', 'altKey', 'ctrlKey', 'metaKey'].map(key => [key, Boolean(event[key])]))
  function wake() {
    if (disposed || animation !== null || !interaction.state.get().needsFrame || !keys.requestAnimationFrame) return
    animation = keys.requestAnimationFrame(time => { animation = null; send({ type: 'frame', time }) })
  }
  function send(input) {
    lastTime = Math.max(lastTime, Number.isFinite(input.time) ? input.time : lastTime)
    let result
    try { result = interaction.dispatch({ ...input, time: lastTime }); Promise.resolve(result).catch(onError) } catch (error) { onError(error) }
    wake()
    return result
  }
  const pointer = type => event => {
    if (event.target?.closest?.('[data-canvas-input-owner="text-editing"], [data-canvas-input-owner="video"], [data-canvas-input-owner="embed"]')) return
    if (type === 'pointer_down') {
      if (![0, 1].includes(event.button) || event.pointerType !== 'touch' && captured.size && !captured.has(event.pointerId)) return
      host.focus?.({ preventScroll: true }); host.setPointerCapture?.(event.pointerId); captured.add(event.pointerId)
    }
    let inputType = type
    if (type === 'pointer_up' && interaction.state.get().creation?.dragFromToolbar && interaction.state.get().mode === 'dragging') {
      const target = host.ownerDocument?.elementFromPoint?.(event.clientX, event.clientY)
      if (target && !host.contains(target)) inputType = 'pointer_cancel'
    }
    event.preventDefault()
    send({ type: inputType, time: event.timeStamp, ...(Number.isFinite(event.clientX) && { point: point(event) }), pointerId: event.pointerId, pointerType: event.pointerType, pressure: event.pressure, button: event.button, buttons: event.buttons, ...modifiers(event) })
    if (['pointer_up', 'pointer_cancel'].includes(type) && captured.delete(event.pointerId)) {
      if (host.hasPointerCapture?.(event.pointerId)) host.releasePointerCapture(event.pointerId)
    }
  }
  const lost = event => {
    if (!captured.delete(event.pointerId)) return
    send({ type: 'pointer_cancel', time: event.timeStamp, pointerId: event.pointerId, pointerType: event.pointerType })
  }
  const wheel = event => {
    if (event.target?.closest?.('[data-canvas-input-owner="embed"]')) return
    event.preventDefault()
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1
    send({ type: 'wheel', time: event.timeStamp, point: point(event), delta: { x: event.deltaX * scale, y: event.deltaY * scale }, ...modifiers(event) })
  }
  const key = type => event => {
    reportContext(event.target)
    const name = event.code?.startsWith('Digit') && event.shiftKey ? event.code.slice(5) : event.key
    const result = send({ type, time: event.timeStamp, key: name, code: event.code, repeat: event.repeat, isComposing: event.isComposing, keyCode: event.keyCode, ...modifiers(event) })
    if (result) event.preventDefault()
  }
  const blur = () => {
    for (const id of captured) {
      if (host.hasPointerCapture?.(id)) host.releasePointerCapture(id)
      send({ type: 'pointer_cancel', time: 0, pointerId: id })
    }
    captured.clear(); composing = false; interaction.setInputContext({ owner: 'form' })
  }
  const focus = event => reportContext(event.target === keys ? document?.activeElement || host : event.target)
  const focusout = event => reportContext(event.relatedTarget || document?.body)
  const composition = active => event => { composing = active; reportContext(event.target) }
  const resize = () => { if (host.clientWidth && host.clientHeight) interaction.setViewport({ w: host.clientWidth, h: host.clientHeight }) }
  const outside = event => {
    if (!interaction.state.get().interactingEmbedId || host.contains(event.target) || event.target?.closest?.('[data-embed-action="finish-interaction"]')) return
    interaction.embed({ type: 'finish-interaction' })
  }
  const pointerListeners = { pointerdown: pointer('pointer_down'), pointermove: pointer('pointer_move'), pointerup: pointer('pointer_up'), pointercancel: pointer('pointer_cancel'), lostpointercapture: lost }
  const keyListeners = { keydown: key('key_down'), keyup: key('key_up'), focus, focusin: focus, focusout, compositionstart: composition(true), compositionend: composition(false), blur, resize }
  for (const [type, listener] of Object.entries(pointerListeners)) host.addEventListener(type, listener)
  for (const [type, listener] of Object.entries(keyListeners)) keys.addEventListener(type, listener, { capture: type.startsWith('key') })
  keys.addEventListener('pointerdown', outside, { capture: true })
  host.addEventListener('wheel', wheel, { passive: false }); resize(); reportContext(document?.activeElement || host)
  return {
    wake,
    dispatch: send,
    beginToolDrag(event, options) { interaction.beginToolDrag(options); pointer('pointer_down')(event) },
    navigate(action, anchor, time) {
      // Buttons and rAF share this host clock. A rAF timestamp can precede an
      // event dispatched earlier in that frame; normalize both in one place.
      lastTime = Math.max(lastTime, time); interaction.navigate(action, anchor, lastTime); wake()
    },
    getCamera: () => ({ ...interaction.state.get().camera }),
    resetCamera(camera) { interaction.setCamera(camera) },
    dispose() {
      if (disposed) return
      blur(); disposed = true
      if (animation !== null) keys.cancelAnimationFrame?.(animation)
      for (const [type, listener] of Object.entries(pointerListeners)) host.removeEventListener(type, listener)
      for (const [type, listener] of Object.entries(keyListeners)) keys.removeEventListener(type, listener, { capture: type.startsWith('key') })
      host.removeEventListener('wheel', wheel)
      keys.removeEventListener('pointerdown', outside, { capture: true })
    },
  }
}
