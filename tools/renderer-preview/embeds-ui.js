import { EMBED_SERVICES } from '../../model/index.js'

// Thin host controls: service/URL drafts and availability belong to interaction.
// Native dialog focus stays outside the canvas; existing navigation buttons
// supply the shared token-based control styles, including disabled/focus states.
export function attachEmbedsUi(toolbar, host, interaction, onError, showActions = true) {
  const doc = host.ownerDocument, listeners = [], controls = new Map()
  let disposed = false, previousStage = null
  const conversionIntents = new Map(), conversionButtons = new Map()
  const attempt = fn => { try { Promise.resolve(fn()).catch(error => { if (!disposed) onError(error) }) } catch (error) { if (!disposed) onError(error) } }
  function listen(node, type, handler) { node.addEventListener(type, handler); listeners.push(() => node.removeEventListener(type, handler)) }
  function button(parent, id, text, run) {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = text; node.dataset.embedAction = id
    listen(node, 'click', () => attempt(run)); parent.append(node); controls.set(id, node); return node
  }
  const open = button(toolbar, 'open', '创建嵌入', () => interaction.embed({ type: 'open' }))
  open.hidden = !showActions
  open.setAttribute('aria-keyshortcuts', 'Control+i Meta+i')
  const finish = button(toolbar, 'finish-interaction', '退出嵌入互动', () => { interaction.embed({ type: 'finish-interaction' }); host.focus({ preventScroll: true }) })
  finish.hidden = true
  for (const [to, text] of [['bookmark', '转换为书签'], ['embed', '转换为嵌入']]) {
    const node = button(toolbar, `convert-${to}`, text, () => {
      const intent = conversionIntents.get(to)
      if (intent) return Promise.resolve(interaction.embed(intent)).then(() => host.focus({ preventScroll: true }))
    })
    node.hidden = !showActions; conversionButtons.set(to, node)
  }
  const dialog = doc.createElement('dialog'); dialog.className = 'embed-dialog'; dialog.setAttribute('aria-label', '创建嵌入')
  const form = doc.createElement('form'), title = doc.createElement('h2'), choices = doc.createElement('fieldset'), legend = doc.createElement('legend')
  title.textContent = '创建嵌入'; legend.textContent = '选择服务'; choices.append(legend)
  for (const service of EMBED_SERVICES) {
    const node = button(choices, `service-${service.id}`, service.name, () => interaction.embed({ type: 'service', serviceId: service.id }))
    node.disabled = !service.available
    if (!service.available) node.title = '此服务暂不可用'
  }
  const address = doc.createElement('fieldset'), label = doc.createElement('label'), input = doc.createElement('input'), help = doc.createElement('p')
  label.textContent = '服务网址 '; input.type = 'url'; input.maxLength = 8192; input.size = 40; input.required = true; input.dataset.embedAction = 'url'; input.setAttribute('aria-label', '嵌入网址')
  label.append(input); help.id = 'embed-url-help'; help.textContent = '填写所选服务的完整 HTTPS 网址。'; input.setAttribute('aria-describedby', help.id)
  address.append(label, help)
  button(address, 'back', '返回', () => interaction.embed({ type: 'back' }))
  const submit = doc.createElement('button'); submit.type = 'submit'; submit.textContent = '创建'; submit.dataset.embedAction = 'submit'; address.append(submit)
  button(form, 'cancel', '取消', () => interaction.embed({ type: 'cancel' }))
  form.prepend(title, choices, address); dialog.append(form); toolbar.append(dialog)
  listen(input, 'input', () => attempt(() => interaction.embed({ type: 'update', url: input.value })))
  listen(form, 'submit', event => { event.preventDefault(); attempt(() => interaction.embed({ type: 'submit' })) })
  listen(dialog, 'cancel', event => { event.preventDefault(); attempt(() => interaction.embed({ type: 'cancel' })) })
  function update(state, submitting = false) {
    if (disposed) return
    finish.hidden = !state.interactingEmbedId
    open.disabled = !interaction.canEmbed()
    for (const [to, node] of conversionButtons) {
      const intent = interaction.embed({ type: 'conversion-intent', to })
      conversionIntents.set(to, intent); node.disabled = !intent
    }
    const draft = state.embedEditing, stage = !draft ? null : draft.serviceId || 'services'
    if (!draft) {
      if (dialog.open) { dialog.close(); host.focus({ preventScroll: true }) }
      previousStage = null; return
    }
    choices.hidden = !!draft.serviceId; address.hidden = !draft.serviceId
    title.textContent = draft.serviceId ? `嵌入 ${EMBED_SERVICES.find(service => service.id === draft.serviceId).name}` : '创建嵌入'
    if (input.value !== draft.url) input.value = draft.url
    input.setAttribute('aria-invalid', String(Boolean(draft.url && !draft.valid)))
    input.disabled = submitting; submit.disabled = submitting || !draft.valid
    controls.get('back').disabled = submitting; controls.get('cancel').disabled = submitting
    if (!dialog.open) dialog.showModal()
    if (stage !== previousStage) {
      if (draft.serviceId) input.focus({ preventScroll: true })
      else choices.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
    }
    previousStage = stage
  }
  return { update, dispose() { disposed = true; for (const stop of listeners) stop(); interaction.embed({ type: 'cancel' }); dialog.remove(); for (const node of controls.values()) node.remove() } }
}
