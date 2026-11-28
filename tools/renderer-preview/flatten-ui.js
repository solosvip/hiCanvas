import { react } from '@tldraw/state'

// Synthetic preview only; both the button and Shift+F use the same engine
// action. No system clipboard, download, chooser or direct Store writes.
export function attachFlattenUi(toolbar, interaction, onError) {
  const doc = toolbar.ownerDocument, button = doc.createElement('button'), cancel = doc.createElement('button'), status = doc.createElement('output')
  button.type = cancel.type = 'button'; button.textContent = '扁平化成图片'; cancel.textContent = '取消扁平化'
  button.dataset.flattenAction = 'start'; cancel.dataset.flattenAction = 'cancel'; status.dataset.flattenStatus = ''; status.setAttribute('role', 'status')
  const start = async () => {
    button.disabled = true
    try { const result = await interaction.flatten({ type: 'start', origin: 'toolbar' }); status.textContent = result.status === 'complete' ? ['扁平化完成', ...(result.warnings || [])].join('；') : result.message || result.reason || result.status }
    catch (error) { status.textContent = error.message; onError(error) }
    finally { button.disabled = false }
  }
  const stop = () => { status.textContent = interaction.flatten({ type: 'cancel' }) ? '已请求取消' : '当前无法取消' }
  button.addEventListener('click', start); cancel.addEventListener('click', stop); toolbar.append(button, cancel, status)
  const stopWatching = react('flatten preview controls', () => {
    const phase = interaction.state.get().flattenStatus?.phase || 'idle'
    button.disabled = phase !== 'idle'; cancel.disabled = !['rendering', 'uploading'].includes(phase)
  })
  return { dispose() { stopWatching(); button.removeEventListener('click', start); cancel.removeEventListener('click', stop); button.remove(); cancel.remove(); status.remove() } }
}
