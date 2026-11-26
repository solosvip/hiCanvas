// Preview-only DOM adapter. Tool choices and gestures remain in interaction;
// this shell passes the native toolbar pointer-down into the common input path.
export function attachCreationUi(host, interaction, controls, onError) {
  const doc = host.ownerDocument, toolbar = doc.createElement('nav'), listeners = [], buttons = new Map()
  toolbar.id = 'creation'; toolbar.dataset.creationToolbar = ''; toolbar.setAttribute('aria-label', '创建形状')
  const listen = (node, name, callback) => { node.addEventListener(name, callback); listeners.push(() => node.removeEventListener(name, callback)) }
  const safely = callback => event => { try { callback(event) } catch (error) { onError(error) } }
  const geo = doc.createElement('select'); geo.setAttribute('aria-label', '几何形状')
  for (const [value, label] of [
    ['rectangle','矩形'],['ellipse','椭圆'],['triangle','三角形'],['diamond','菱形'],['pentagon','五边形'],['hexagon','六边形'],['octagon','八边形'],['star','星形'],['rhombus','斜方形'],['rhombus-2','反斜方形'],['oval','胶囊'],['trapezoid','梯形'],['arrow-right','右箭头'],['arrow-left','左箭头'],['arrow-up','上箭头'],['arrow-down','下箭头'],['x-box','叉号框'],['check-box','勾号框'],['cloud','云形'],['heart','心形'],
  ]) { const option = doc.createElement('option'); option.value = value; option.textContent = label; geo.append(option) }
  listen(geo, 'change', safely(() => { interaction.setCreationOptions({ geo: geo.value }); interaction.setTool('geo'); host.focus({ preventScroll: true }) }))
  toolbar.append(geo)
  for (const [toolId, label] of [['text','文字 T'],['geo','几何 G'],['frame','画框 F'],['ai-image','AI 图片 A'],['ai-draft','AI 网页'],['ai-film','AI 影片'],['ai-slides','AI 幻灯片']]) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.tool = toolId
    listen(button, 'pointerdown', safely(event => { if (event.button === 0) controls().beginToolDrag(event, { toolId }) }))
    // Keyboard activation arms the tool for the next canvas pointer gesture.
    listen(button, 'click', safely(event => { if (event.detail === 0) { interaction.setTool(toolId); host.focus({ preventScroll: true }) } }))
    toolbar.append(button); buttons.set(toolId, button)
  }
  for (const [action, label] of [['recent','最近工具'],['locked','锁定工具 Q'],['dynamic','动态尺寸']]) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.creationAction = action
    listen(button, 'click', safely(() => {
      const state = interaction.state.get().creation
      if (action === 'recent') interaction.useRecentTool()
      else interaction.setCreationOptions(action === 'locked' ? { toolLocked: !state.toolLocked } : { dynamicSize: !state.dynamicSize })
      host.focus({ preventScroll: true })
    }))
    toolbar.append(button); buttons.set(action, button)
  }
  doc.body.append(toolbar)
  return {
    element: toolbar,
    update(state, submitting) {
      geo.value = state.creation.geo; geo.disabled = submitting
      for (const [id, button] of buttons) { button.disabled = submitting; button.setAttribute('aria-pressed', String(id === 'locked' ? state.creation.toolLocked : id === 'dynamic' ? state.creation.dynamicSize : state.toolId === id)) }
      host.dataset.creationTool = String(buttons.has(state.toolId) && !state.temporaryTool)
    },
    dispose() { for (const stop of listeners) stop(); toolbar.remove(); delete host.dataset.creationTool },
  }
}
