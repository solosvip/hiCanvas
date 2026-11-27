// Host DOM only. Draft validation, availability and every write belong to the
// interaction seam; a real form preserves native Enter/Tab/button semantics.
export function attachShapeLinksUi(toolbar, host, interaction, onError) {
  const doc = host.ownerDocument, listeners = [], buttons = []
  let disposed = false, shownId = null
  const attempt = fn => { try { Promise.resolve(fn()).catch(error => { if (!disposed) onError(error) }) } catch (error) { if (!disposed) onError(error) } }
  const listen = (node, type, handler) => { node.addEventListener(type, handler); listeners.push(() => node.removeEventListener(type, handler)) }
  function button(parent, id, text, run) {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = text; node.dataset.shapeLinkAction = id
    listen(node, 'click', () => attempt(run)); parent.append(node); buttons.push(node); return node
  }
  const open = button(toolbar, 'open', '编辑链接', () => interaction.link({ type: 'open' }))
  const dialog = doc.createElement('dialog'); dialog.className = 'embed-dialog shape-link-dialog'; dialog.setAttribute('aria-label', '编辑链接')
  const form = doc.createElement('form'), title = doc.createElement('h2'), label = doc.createElement('label'), input = doc.createElement('input'), help = doc.createElement('p')
  title.textContent = '编辑链接'; label.textContent = '网址 '
  input.type = 'text'; input.inputMode = 'url'; input.maxLength = 8192; input.autocomplete = 'url'; input.spellcheck = false; input.dataset.shapeLinkAction = 'url'
  input.setAttribute('aria-label', '形状链接网址'); input.setAttribute('aria-describedby', 'shape-link-help'); label.append(input)
  help.id = 'shape-link-help'; help.setAttribute('role', 'status')
  form.append(title, label, help)
  const submit = doc.createElement('button'); submit.type = 'submit'; submit.textContent = '继续'; submit.dataset.shapeLinkAction = 'submit'; form.append(submit)
  const clear = button(form, 'clear', '清除', () => interaction.link({ type: 'clear' }))
  button(form, 'cancel', '取消', () => interaction.link({ type: 'cancel' }))
  button(form, 'close', '关闭', () => interaction.link({ type: 'cancel' }))
  dialog.append(form); toolbar.append(dialog)
  listen(input, 'input', () => attempt(() => interaction.link({ type: 'update', url: input.value })))
  listen(form, 'submit', event => { event.preventDefault(); attempt(() => interaction.link({ type: 'submit' })) })
  listen(dialog, 'cancel', event => { event.preventDefault(); attempt(() => interaction.link({ type: 'cancel' })) })
  listen(dialog, 'click', event => {
    const b = dialog.getBoundingClientRect()
    if (event.target === dialog && (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom)) attempt(() => interaction.link({ type: 'cancel' }))
  })
  return {
    update(state, submitting = false) {
      if (disposed) return
      open.disabled = !interaction.getLinks().canEdit
      const draft = state.linkEditing
      if (!draft) {
        if (dialog.open) { dialog.close(); host.focus({ preventScroll: true }) }
        shownId = null; return
      }
      if (input.value !== draft.url) input.value = draft.url
      input.setAttribute('aria-invalid', String(!draft.valid))
      help.textContent = draft.message || state.lastError?.message || '支持 HTTP(S) 网址；裸域名会补 https://，空值表示清除。'
      input.disabled = submitting; submit.disabled = submitting || !draft.valid; clear.disabled = submitting
      if (!dialog.open) dialog.showModal()
      if (shownId !== draft.id) input.focus({ preventScroll: true })
      shownId = draft.id
    },
    dispose() { disposed = true; for (const stop of listeners) stop(); interaction.link({ type: 'cancel' }); dialog.remove(); for (const node of buttons) node.remove() },
  }
}
