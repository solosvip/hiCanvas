// Host controls are a view of editing-layer state. URL preparation, validation,
// cancellation and the single save/undo boundary stay outside the DOM.
export function attachBookmarksUi(toolbar, host, interaction, onError, visible = false) {
  const doc = host.ownerDocument, stops = [], buttons = []
  let disposed = false, opened = false, composing = false
  const listen = (node, name, handler) => { node.addEventListener(name, handler); stops.push(() => node.removeEventListener(name, handler)) }
  const attempt = fn => { try { Promise.resolve(fn()).catch(error => { if (!disposed) onError(error) }) } catch (error) { if (!disposed) onError(error) } }
  function button(parent, action, label) {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = label; node.dataset.bookmarkAction = action
    listen(node, 'click', () => attempt(() => interaction.bookmark({ type: action }))); parent.append(node); buttons.push(node); return node
  }
  const edit = button(toolbar, 'open', '编辑书签网址'), refresh = button(toolbar, 'refresh', '刷新书签信息')
  const cancelRead = doc.createElement('button'); cancelRead.type = 'button'; cancelRead.dataset.bookmarkAction = 'cancel-read'; cancelRead.textContent = '取消读取'
  listen(cancelRead, 'click', () => attempt(() => { for (const job of interaction.state.get().bookmarkJobs) interaction.bookmark({ type: 'cancel', id: job.id }) }))
  toolbar.append(cancelRead); buttons.push(cancelRead)
  const dialog = doc.createElement('dialog'); dialog.className = 'embed-dialog'; dialog.setAttribute('aria-label', '编辑书签网址')
  const form = doc.createElement('form'), title = doc.createElement('h2'), label = doc.createElement('label'), input = doc.createElement('input'), help = doc.createElement('p')
  title.textContent = '编辑书签网址'; label.textContent = '书签网址 '
  input.type = 'url'; input.maxLength = 8192; input.required = true; input.dataset.bookmarkAction = 'url'; input.setAttribute('aria-label', '书签网址')
  help.id = 'bookmark-url-help'; help.setAttribute('role', 'status'); help.setAttribute('aria-live', 'polite'); input.setAttribute('aria-describedby', help.id)
  label.append(input); form.append(title, label, help)
  const submit = doc.createElement('button'); submit.type = 'submit'; submit.dataset.bookmarkAction = 'submit'; submit.textContent = '保存并补齐'; form.append(submit)
  const only = button(form, 'save-url-only', '仅保存网址'), cancel = button(form, 'cancel', '取消')
  dialog.append(form); toolbar.append(dialog)
  listen(input, 'input', () => attempt(() => interaction.bookmark({ type: 'update', url: input.value })))
  listen(input, 'compositionstart', () => { composing = true })
  listen(input, 'compositionend', () => { composing = false })
  listen(form, 'submit', event => { event.preventDefault(); if (!composing) attempt(() => interaction.bookmark({ type: 'submit' })) })
  listen(dialog, 'cancel', event => { event.preventDefault(); if (!composing && !interaction.state.get().inputContext.isComposing) attempt(() => interaction.bookmark({ type: 'cancel' })) })
  function update(state) {
    if (disposed) return
    edit.hidden = refresh.hidden = !visible
    edit.disabled = refresh.disabled = !interaction.canBookmark() || !!state.bookmarkEditing
    const active = state.bookmarkJobs || []
    cancelRead.hidden = !visible || !active.length
    cancelRead.disabled = !active.some(job => job.phase !== 'submitting')
    const draft = state.bookmarkEditing
    if (!draft) {
      if (dialog.open) { dialog.close(); if (opened) host.focus({ preventScroll: true }) }
      opened = false; return
    }
    const saving = draft.phase === 'submitting', reading = ['fetching', 'ready'].includes(draft.phase)
    input.disabled = saving; if (input.value !== draft.url) input.value = draft.url
    input.setAttribute('aria-invalid', String(Boolean(draft.url && !draft.valid)))
    submit.disabled = saving || reading || !draft.valid
    submit.textContent = draft.phase === 'failed' ? '重试' : '保存并补齐'
    only.hidden = draft.phase !== 'failed'; only.disabled = saving
    cancel.disabled = saving
    help.textContent = saving ? '正在保存。' : reading ? '正在读取信息，尚未保存；可以取消。' : draft.error ? `${draft.error}尚未保存，可以重试或仅保存网址。` : '填写完整 HTTP(S) 网址。确认后先读取信息，再一次保存。'
    if (!dialog.open) { dialog.showModal(); input.focus({ preventScroll: true }); input.select() }
    opened = true
  }
  return { update, dispose() {
    if (disposed) return
    disposed = true; for (const stop of stops) stop()
    interaction.bookmark({ type: 'cancel' }); dialog.remove(); for (const node of buttons) node.remove()
  } }
}
