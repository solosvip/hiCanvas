// A preview shell for the common interaction API; it owns no camera rules.
export function attachNavigationUi(host, interaction, onError, navigate) {
  const doc = host.ownerDocument, toolbar = doc.createElement('nav')
  toolbar.id = 'navigation'; toolbar.setAttribute('aria-label', '画板视角')
  const buttons = new Map(), listeners = []
  const actions = [
    ['first-content', '跳到画布内容'], ['wrap-mode', '完全包含框选'], ['select', '选择 V'], ['hand', '手形 H'], ['draw', '画笔 D/B/X'], ['highlight', '荧光笔 ⇧D'], ['exit-pen', '退出手写笔模式'], ['zoom-out', '缩小 −'], ['reset-zoom', '恢复 100%'],
    ['zoom-in', '放大 +'], ['fit-all', '适合全部 ⇧1'], ['fit-selection', '适合选中 ⇧2'], ['edge-scrolling', '边缘平移'], ['return-content', '返回内容'],
  ]
  for (const [action, label] of actions) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = label
    button.dataset.action = action; button.setAttribute('aria-label', label)
    const click = event => {
      try {
        if (action === 'first-content') interaction.select('first')
        else if (action === 'wrap-mode') interaction.setWrapMode(!interaction.state.get().isWrapMode)
        else if (['hand', 'select', 'draw', 'highlight'].includes(action)) interaction.setTool(action)
        else if (action === 'exit-pen') interaction.setPenMode(false)
        else if (action === 'edge-scrolling') interaction.setEdgeScrolling(!interaction.state.get().edgeScrolling)
        else navigate(action, event.shiftKey && ['zoom-in', 'zoom-out'].includes(action) ? { atPointer: true } : null, event.timeStamp)
        host.focus({ preventScroll: true })
      } catch (error) { onError(error) }
    }
    button.addEventListener('click', click); listeners.push(() => button.removeEventListener('click', click)); buttons.set(action, button); toolbar.append(button)
  }
  doc.body.append(toolbar)
  return {
    element: toolbar,
    update(state) {
      for (const action of ['hand', 'select', 'draw', 'highlight']) buttons.get(action).setAttribute('aria-pressed', String(state.toolId === action))
      buttons.get('exit-pen').hidden = !state.isPenMode
      buttons.get('wrap-mode').setAttribute('aria-pressed', String(state.isWrapMode))
      buttons.get('edge-scrolling').setAttribute('aria-pressed', String(state.edgeScrolling))
      buttons.get('fit-selection').disabled = state.selectedIds.length === 0
      buttons.get('return-content').dataset.visible = String(state.contentOffscreen)
      buttons.get('return-content').disabled = !state.contentOffscreen
      buttons.get('return-content').setAttribute('aria-hidden', String(!state.contentOffscreen))
      host.style.cursor = state.toolId === 'select' && !state.temporaryTool && state.mode !== 'panning' ? state.handleCursor || '' : ''
      host.dataset.cursor = state.mode === 'panning' ? 'grabbing' : state.temporaryTool === 'zoom' ? 'zoom-in' : state.toolId === 'hand' || state.temporaryTool === 'hand' ? 'grab' : ['draw', 'highlight'].includes(state.toolId) ? 'crosshair' : 'default'
    },
    dispose() { for (const stop of listeners) stop(); toolbar.remove() },
  }
}
