// Synthetic host controls for the public text actions. Formatting UI is #150.
export function attachTextUi(toolbar, interaction, store, onError) {
  const doc = toolbar.ownerDocument, group = doc.createElement('span'), controls = new Map(), disposers = []
  group.dataset.textStyles = ''; group.setAttribute('role', 'group'); group.setAttribute('aria-label', '文字样式')
  const target = () => {
    const state = interaction.state.get()
    return store.get(state.textEditing?.id || (state.selectedIds.length === 1 ? state.selectedIds[0] : ''))
  }
  const run = action => { try { Promise.resolve(interaction.editText(action)).catch(onError) } catch (error) { onError(error) } }
  for (const [field, label, choices] of [
    ['size', '字号', [['s', '小'], ['m', '中'], ['l', '大'], ['xl', '特大']]],
    ['font', '字体', [['draw', '手写'], ['sans', '无衬线'], ['serif', '衬线'], ['mono', '等宽']]],
    ['horizontal', '水平对齐', [['start', '左'], ['middle', '中'], ['end', '右']]],
    ['verticalAlign', '垂直对齐', [['start', '上'], ['middle', '中'], ['end', '下']]],
  ]) {
    const button = doc.createElement('button'); button.type = 'button'; button.dataset.textStyle = field
    const change = () => {
      const shape = target(); if (!shape) return
      const key = field === 'horizontal' ? shape.type === 'text' ? 'textAlign' : 'align' : field
      const current = choices.findIndex(([value]) => value === shape.props[key])
      run({ type: 'style', id: shape.id, changes: { [key]: choices[(current + 1) % choices.length][0] } })
    }
    button.addEventListener('click', change); disposers.push(() => button.removeEventListener('click', change))
    controls.set(field, { button, choices, label }); group.append(button)
  }
  const auto = doc.createElement('button'); auto.type = 'button'; auto.textContent = '自动大小'; auto.dataset.textAutoSize = ''
  const toggle = () => { const shape = target(); if (shape) run({ type: 'auto-size', id: shape.id, enabled: !shape.props.autoSize }) }
  auto.addEventListener('click', toggle); disposers.push(() => auto.removeEventListener('click', toggle)); group.append(auto); toolbar.append(group)
  return {
    update(_state, submitting) {
      const shape = target(), type = shape?.type, supported = ['text', 'geo', 'arrow'].includes(type)
      group.hidden = !supported
      for (const [field, { button, choices, label }] of controls) {
        const applicable = field === 'horizontal' ? ['text', 'geo'].includes(type) : field === 'verticalAlign' ? type === 'geo' : supported
        button.disabled = submitting || !applicable
        const value = applicable ? shape.props[field === 'horizontal' ? type === 'text' ? 'textAlign' : 'align' : field] : ''
        button.dataset.value = value
        button.textContent = `${label}：${choices.find(choice => choice[0] === value)?.[1] || '不适用'}`
        button.setAttribute('aria-label', `${button.textContent}，点击切换`)
      }
      auto.disabled = submitting || type !== 'text'; auto.setAttribute('aria-pressed', String(type === 'text' && shape.props.autoSize))
    },
    dispose() { disposers.forEach(stop => stop()); group.remove() },
  }
}
