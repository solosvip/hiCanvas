// The shell only normalizes host events. Camera and selection are owned by the
// interaction module; neither this adapter nor the renderer is a second source.
export function attachPreviewInput(host, interaction, { onError = () => {} } = {}) {
  const keys = host.ownerDocument?.defaultView || host
  let captured = null, lastTime = 0
  const point = event => {
    const box = host.getBoundingClientRect?.() || { left: 0, top: 0 }
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  const modifiers = event => Object.fromEntries(['shiftKey', 'altKey', 'ctrlKey', 'metaKey'].map(key => [key, Boolean(event[key])]))
  const send = input => {
    lastTime = Math.max(lastTime, Number.isFinite(input.time) ? input.time : lastTime)
    try { Promise.resolve(interaction.dispatch({ ...input, time: lastTime })).catch(onError) } catch (error) { onError(error) }
  }
  const pointer = type => event => {
    if (type === 'pointer_down') {
      if (![0, 1].includes(event.button) || captured !== null && captured !== event.pointerId) return
      host.focus?.({ preventScroll: true }); host.setPointerCapture?.(event.pointerId); captured = event.pointerId
    }
    event.preventDefault()
    send({ type, time: event.timeStamp, ...(Number.isFinite(event.clientX) && { point: point(event) }), pointerId: event.pointerId, pointerType: event.pointerType, pressure: event.pressure, button: event.button, buttons: event.buttons, ...modifiers(event) })
    if (['pointer_up', 'pointer_cancel'].includes(type) && captured === event.pointerId) {
      captured = null
      if (host.hasPointerCapture?.(event.pointerId)) host.releasePointerCapture(event.pointerId)
    }
  }
  const lost = event => {
    if (captured !== event.pointerId) return
    captured = null; send({ type: 'pointer_cancel', time: event.timeStamp, pointerId: event.pointerId })
  }
  const wheel = event => {
    event.preventDefault()
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1
    send({ type: 'wheel', time: event.timeStamp, point: point(event), delta: { x: event.deltaX * scale, y: event.deltaY * scale }, ...modifiers(event) })
  }
  const key = type => event => {
    if (event.key === 'Escape') event.preventDefault()
    send({ type, time: event.timeStamp, key: event.key, code: event.code, repeat: event.repeat, ...modifiers(event) })
  }
  const blur = () => { captured = null; send({ type: 'key_down', time: 0, key: 'Escape' }) }
  const pointerListeners = { pointerdown: pointer('pointer_down'), pointermove: pointer('pointer_move'), pointerup: pointer('pointer_up'), pointercancel: pointer('pointer_cancel'), lostpointercapture: lost }
  const keyListeners = { keydown: key('key_down'), keyup: key('key_up'), blur }
  for (const [type, listener] of Object.entries(pointerListeners)) host.addEventListener(type, listener)
  for (const [type, listener] of Object.entries(keyListeners)) keys.addEventListener(type, listener)
  host.addEventListener('wheel', wheel, { passive: false })
  return {
    getCamera: () => ({ ...interaction.state.get().camera }),
    resetCamera(camera) { interaction.setCamera(camera) },
    dispose() {
      blur()
      for (const [type, listener] of Object.entries(pointerListeners)) host.removeEventListener(type, listener)
      for (const [type, listener] of Object.entries(keyListeners)) keys.removeEventListener(type, listener)
      host.removeEventListener('wheel', wheel)
    },
  }
}
