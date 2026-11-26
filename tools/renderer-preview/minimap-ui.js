import { mountCanvasMinimap } from '../../renderer/index.js'

// Host responsibilities only: visibility, DOM coordinates, capture, and input
// translation. Framing, hit testing, dragging and camera changes stay in engine.
// Legacy offscreen window width sweep, 2026-11-26: 840px hides the button,
// 841px shows it. The threshold itself is a DESIGN.md token, not camera logic.
export function attachMinimapUi(toolbar, host, interaction, { store, pageId, dispatch, onError }) {
  const doc = host.ownerDocument, win = doc.defaultView, button = doc.createElement('button'), panel = doc.createElement('div')
  button.type = 'button'; button.dataset.action = 'minimap'; button.textContent = '小地图'
  button.setAttribute('aria-controls', 'preview-minimap'); button.setAttribute('aria-expanded', 'false')
  panel.id = 'preview-minimap'; panel.className = 'minimap-panel'; panel.hidden = true
  toolbar.append(button, panel)
  let wanted = false, view = null, stops = [], disposed = false
  const captured = new Set()
  const modifiers = event => Object.fromEntries(['shiftKey', 'altKey', 'ctrlKey', 'metaKey'].map(key => [key, Boolean(event[key])]))
  function send(event, type) {
    const rect = view.element.getBoundingClientRect(), canvas = host.getBoundingClientRect()
    dispatch({ type, time: event.timeStamp, target: 'minimap', point: { x: event.clientX - rect.left, y: event.clientY - rect.top }, canvasPoint: { x: event.clientX - canvas.left, y: event.clientY - canvas.top }, pointerId: event.pointerId, pointerType: event.pointerType, pressure: event.pressure, button: event.button, buttons: event.buttons, ...modifiers(event), ...(type === 'wheel' && { delta: { x: event.deltaX * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1), y: event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1) } }) })
  }
  function release() {
    for (const id of captured) if (view?.element.hasPointerCapture(id)) view.element.releasePointerCapture(id)
    captured.clear()
  }
  function mount() {
    view = mountCanvasMinimap(panel, { store, pageId })
    const element = view.element
    // The minimap lives in the navigation panel, outside the canvas host; its
    // keys still belong to the canvas input context (#122), except the arrows,
    // which it dispatches itself as minimap panning (#124).
    element.dataset.canvasInputOwner = 'canvas'; element.dataset.canvasOwnArrows = ''
    function listen(type, listener, options) { element.addEventListener(type, listener, options); stops.push(() => element.removeEventListener(type, listener, options)) }
    for (const [name, type] of Object.entries({ pointerdown: 'pointer_down', pointermove: 'pointer_move', pointerup: 'pointer_up', pointercancel: 'pointer_cancel' })) {
      listen(name, event => {
        if (type === 'pointer_down') {
          if (event.button !== 0 || captured.size && !captured.has(event.pointerId)) return
          element.focus({ preventScroll: true }); element.setPointerCapture(event.pointerId); captured.add(event.pointerId)
        }
        event.preventDefault(); event.stopPropagation(); send(event, type)
        if (['pointer_up', 'pointer_cancel'].includes(type) && captured.delete(event.pointerId) && element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
      })
    }
    listen('lostpointercapture', event => { if (captured.delete(event.pointerId)) dispatch({ type: 'pointer_cancel', target: 'minimap', time: event.timeStamp, pointerId: event.pointerId }) })
    listen('dblclick', event => { event.preventDefault(); event.stopPropagation(); send(event, 'double_click') })
    listen('wheel', event => { event.preventDefault(); event.stopPropagation(); send(event, 'wheel') }, { passive: false })
    for (const [name, type] of [['keydown', 'key_down'], ['keyup', 'key_up']]) listen(name, event => {
      if (!event.key.startsWith('Arrow')) return
      event.preventDefault(); event.stopPropagation(); dispatch({ type, target: 'minimap', time: event.timeStamp, key: event.key, code: event.code, repeat: event.repeat, ...modifiers(event) })
    })
  }
  function sync() {
    if (disposed) return
    const breakpoint = parseFloat(win.getComputedStyle(button).getPropertyValue('--spacing-minimap-breakpoint'))
    const wide = host.clientWidth > breakpoint, open = wide && wanted
    button.hidden = !wide; panel.hidden = !open
    button.setAttribute('aria-expanded', String(open)); button.setAttribute('aria-pressed', String(open))
    if (open) {
      if (!view) mount()
      const rect = view.element.getBoundingClientRect()
      interaction.setMinimap({ w: rect.width, h: rect.height })
    } else {
      if (view && doc.activeElement === view.element) host.focus({ preventScroll: true })
      release(); interaction.setMinimap(null)
      for (const stop of stops.splice(0)) stop()
      view?.unmount(); view = null
    }
  }
  const safeSync = () => { try { sync() } catch (error) { onError(error) } }
  const click = () => { wanted = !wanted; safeSync() }
  const blur = () => { const ids = [...captured]; release(); for (const pointerId of ids) dispatch({ type: 'pointer_cancel', time: 0, target: 'minimap', pointerId }) }
  button.addEventListener('click', click); win.addEventListener('blur', blur)
  // Mounting the minimap resizes #navigation, which sits outside the observed
  // host. Doing that inside this callback leaves other observers of #navigation
  // undelivered (Chromium reports a ResizeObserver loop error), so run it in the
  // next task. Not requestAnimationFrame: an idle offscreen window may produce
  // no further frame, and the button would never appear (#139 smoke).
  let pending = null
  const resize = new win.ResizeObserver(() => { if (pending === null) pending = win.setTimeout(() => { pending = null; safeSync() }, 0) }); resize.observe(host); safeSync()
  return {
    update(state) { if (view && state.minimap) { view.setView(state.minimap.layout, state.selectedIds); view.element.dataset.dragging = String(state.minimap.dragging) } },
    dispose() {
      if (disposed) return
      disposed = true; resize.disconnect(); if (pending !== null) win.clearTimeout(pending); release(); interaction.setMinimap(null)
      for (const stop of stops.splice(0)) stop()
      view?.unmount(); button.removeEventListener('click', click); win.removeEventListener('blur', blur); button.remove(); panel.remove()
    },
  }
}
