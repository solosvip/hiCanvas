// Only host normalization and scheduling live here. Decisions, camera physics
// and tool transitions remain in the window-free interaction module.
export function attachPreviewInput(host, interaction, { onError = () => {} } = {}) {
  const keys = host.ownerDocument?.defaultView || host
  const captured = new Set()
  let lastTime = 0, animation = null, disposed = false
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
    try { Promise.resolve(interaction.dispatch({ ...input, time: lastTime })).catch(onError) } catch (error) { onError(error) }
    wake()
  }
  const pointer = type => event => {
    if (type === 'pointer_down') {
      if (![0, 1].includes(event.button) || event.pointerType !== 'touch' && captured.size && !captured.has(event.pointerId)) return
      host.focus?.({ preventScroll: true }); host.setPointerCapture?.(event.pointerId); captured.add(event.pointerId)
    }
    event.preventDefault()
    send({ type, time: event.timeStamp, ...(Number.isFinite(event.clientX) && { point: point(event) }), pointerId: event.pointerId, pointerType: event.pointerType, pressure: event.pressure, button: event.button, buttons: event.buttons, ...modifiers(event) })
    if (['pointer_up', 'pointer_cancel'].includes(type) && captured.delete(event.pointerId)) {
      if (host.hasPointerCapture?.(event.pointerId)) host.releasePointerCapture(event.pointerId)
    }
  }
  const lost = event => {
    if (!captured.delete(event.pointerId)) return
    send({ type: 'pointer_cancel', time: event.timeStamp, pointerId: event.pointerId, pointerType: event.pointerType })
  }
  const wheel = event => {
    event.preventDefault()
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1
    send({ type: 'wheel', time: event.timeStamp, point: point(event), delta: { x: event.deltaX * scale, y: event.deltaY * scale }, ...modifiers(event) })
  }
  const key = type => event => {
    if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
    if (event.target?.closest?.('button') && [' ', 'Enter'].includes(event.key)) return
    const name = event.code?.startsWith('Digit') && event.shiftKey ? event.code.slice(5) : event.key
    if (['Escape', ' ', '=', '+', '-', 'h', 'v', 'z', 'H', 'V', 'Z'].includes(name) || event.shiftKey && ['0', '1', '2'].includes(name)) event.preventDefault()
    send({ type, time: event.timeStamp, key: name, code: event.code, repeat: event.repeat, ...modifiers(event) })
  }
  const blur = () => {
    for (const id of captured) if (host.hasPointerCapture?.(id)) host.releasePointerCapture(id)
    captured.clear(); send({ type: 'key_down', time: 0, key: 'Escape' })
  }
  const resize = () => { if (host.clientWidth && host.clientHeight) interaction.setViewport({ w: host.clientWidth, h: host.clientHeight }) }
  const pointerListeners = { pointerdown: pointer('pointer_down'), pointermove: pointer('pointer_move'), pointerup: pointer('pointer_up'), pointercancel: pointer('pointer_cancel'), lostpointercapture: lost }
  const keyListeners = { keydown: key('key_down'), keyup: key('key_up'), blur, resize }
  for (const [type, listener] of Object.entries(pointerListeners)) host.addEventListener(type, listener)
  for (const [type, listener] of Object.entries(keyListeners)) keys.addEventListener(type, listener)
  host.addEventListener('wheel', wheel, { passive: false }); resize()
  return {
    wake,
    navigate(action, anchor, time) {
      // Buttons and rAF share this host clock. A rAF timestamp can precede an
      // event dispatched earlier in that frame; normalize both in one place.
      lastTime = Math.max(lastTime, time); interaction.navigate(action, anchor, lastTime); wake()
    },
    getCamera: () => ({ ...interaction.state.get().camera }),
    resetCamera(camera) { interaction.setCamera(camera) },
    dispose() {
      blur(); disposed = true
      if (animation !== null) keys.cancelAnimationFrame?.(animation)
      for (const [type, listener] of Object.entries(pointerListeners)) host.removeEventListener(type, listener)
      for (const [type, listener] of Object.entries(keyListeners)) keys.removeEventListener(type, listener)
      host.removeEventListener('wheel', wheel)
    },
  }
}
