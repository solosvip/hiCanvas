import { canvasActions } from '../../engine/index.js'

// Synthetic preview only. Labels, availability and execution come from the
// editing layer; native controls reuse the existing navigation component style.
export function attachActionsUi(toolbar, host, interaction, onError, clipboardOnly = false) {
  const doc = host.ownerDocument, buttons = new Map(), listeners = []
  for (const { id, label } of canvasActions.filter(action => clipboardOnly ? ['copy', 'cut', 'paste', 'paste-at-cursor'].includes(action.id) : !action.binding)) {
    const button = doc.createElement('button'); button.type = 'button'; button.dataset.selectionAction = id; button.textContent = label
    const run = () => {
      try { if (['copy', 'cut', 'paste', 'paste-at-cursor'].includes(id)) host.focus({ preventScroll: true }); Promise.resolve(interaction.runAction(id)).then(() => host.focus({ preventScroll: true })).catch(onError) } catch (error) { onError(error) }
    }
    button.addEventListener('click', run); listeners.push(() => button.removeEventListener('click', run))
    toolbar.append(button); buttons.set(id, button)
  }
  const update = () => {
    const actions = new Map(interaction.getActions().map(action => [action.id, action]))
    for (const [id, button] of buttons) {
      button.disabled = !actions.get(id).available
      button.title = button.disabled ? '请选择适用的可编辑对象，并结束当前操作' : ''
      if (id === 'paste-at-cursor') button.setAttribute('aria-pressed', String(interaction.state.get().pasteAtCursor))
    }
  }
  update()
  return { update, dispose() { for (const stop of listeners) stop(); for (const button of buttons.values()) button.remove() } }
}
