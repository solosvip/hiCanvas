import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const check = (value, message) => { if (!value) throw new Error(message) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const pose = s => s.actionShapes.map(r => [r.id, r.parentId, r.x, r.y, r.rotation, r.props, r.isLocked]).sort((a, b) => a[0] < b[0] ? -1 : 1)

// Actions enter through native keys/buttons. JS only reads state/DOM, installs
// an input observer, sets DOM focus, and reloads this synthetic fixture between cases.
export async function actionsSmoke(target, output) {
  const contents = target.webContents, evaluate = code => contents.executeJavaScript(code), samples = []
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  async function until(predicate, label) {
    const end = Date.now() + 10000
    while (Date.now() < end) { const value = await state(); if (predicate(value)) return value; await delay(10) }
    throw new Error(`动作验证超时：${label}；${JSON.stringify(await state())}`)
  }
  const flush = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const input = async value => { contents.sendInputEvent(value); await flush() }
  const click = async (x, y, modifiers = []) => {
    await input({ type: 'mouseMove', x, y, modifiers })
    for (const type of ['mouseDown', 'mouseUp']) await input({ type, x, y, button: 'left', clickCount: 1, modifiers })
  }
  const key = async (keyCode, modifiers = [], type = null) => {
    for (const phase of type ? [type] : ['keyDown', 'keyUp']) await input({ type: phase, keyCode, modifiers })
  }
  const press = async (name, modifiers = []) => {
    const names = { shift: 'Shift', alt: 'Alt', meta: 'Meta', control: 'Control' }, held = []
    for (const modifier of modifiers) { held.push(modifier); await key(names[modifier], held, 'keyDown') }
    await key(name, held)
    for (const modifier of [...modifiers].reverse()) { held.splice(held.indexOf(modifier), 1); await key(names[modifier], held, 'keyUp') }
  }
  const remember = async label => { const value = await state(); samples.push({ label, ...value }); await writeFile(join(output, 'actions-samples.json'), JSON.stringify(samples, null, 2)); return value }
  const shape = (s, id) => s.actionShapes.find(r => r.id === `shape:action-${id}`)
  const saved = revision => until(s => !s.submitting && s.revision !== revision, '保存')
  const edit = async callback => { const revision = (await state()).revision; await callback(); return saved(revision) }
  const mod = process.platform === 'darwin' ? 'meta' : 'control'
  const undo = () => edit(() => press('Z', [mod]))
  const reset = async () => {
    await target.loadURL(new URL('/?gallery=selection-actions&edgeScrolling=0&reduceMotion=1', target.webContents.getURL()).href)
    await until(s => s.ready && !s.error, '初始小板'); contents.focus()
    await evaluate('document.querySelector("#canvas").focus();window.__actionKeys=[];document.addEventListener("keydown",e=>window.__actionKeys.push({key:e.key,code:e.code,repeat:e.repeat,alt:e.altKey,targetAction:e.target?.dataset.action}),true);void 0')
  }
  async function button(id) {
    const b = await evaluate(`(()=>{const b=document.querySelector('[data-selection-action="${id}"]'),r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,h:r.height,disabled:b.disabled}})()`)
    check(!b.disabled && b.h >= 44, `${id} 不可用或点击高度不足44px`)
    await click(Math.round(b.x), Math.round(b.y))
  }
  const selectThree = async () => { await click(130, 230); await click(350, 280, ['shift']); await click(640, 420, ['shift']); check((await state()).selectedIds.length === 3, '原生加选没有三项') }

  await reset(); await click(130, 230)
  contents.debugger.attach('1.3')
  try {
    for (let i = 0; i < 4; i++) { await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 124, autoRepeat: i > 0 }); await flush() }
    const preview = await remember('repeat-preview')
    check(shape(preview, 'a').x === 104 && preview.revision === '0', '按住没有逐帧预览或提前保存')
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 124 })
    await saved('0')
  } finally { contents.debugger.detach() }
  const repeats = await evaluate('window.__actionKeys.filter(e=>e.key==="ArrowRight").map(e=>e.repeat)')
  check(same(repeats, [false, true, true, true]), '没有真正的DOM自动重复标记')
  check(shape(await undo(), 'a').x === 100, '一次撤销没有还原整次按住')
  check(shape(await edit(() => press('Z', [mod, 'shift'])), 'a').x === 104, '重做没有恢复按住结果')
  for (let i = 0; i < 2; i++) await edit(() => press('Right'))
  check(shape(await undo(), 'a').x === 105, '分开的两次按键没有各自撤销')
  await remember('repeat-and-discrete-undo')

  await reset(); await click(130, 230)
  let s = await edit(() => press('Down', ['shift'])); check(shape(s, 'a').y === 210, 'Shift不是10画布单位'); await undo()
  s = await edit(() => press('.', ['shift'])); check(Math.abs(shape(s, 'a').rotation - Math.PI / 12) < 1e-9, '旋转不是15度'); await undo()
  s = await edit(() => press('.', ['alt', 'shift'])); check(Math.abs(shape(s, 'a').rotation - Math.PI / 192) < 1e-9, '细转不是15度/16'); await undo()
  s = await edit(() => press('=', [mod, 'alt', 'shift'])); check(Math.abs(shape(s, 'a').props.w - 110) < 1e-9 && s.camera.z === 1, '对象放大误改视角'); await undo()
  await press('H', ['shift']); check((await state()).toolId === 'select', '单项镜像退化成H手形')
  await press('D'); await press('Escape'); check((await state()).toolId === 'select' && (await state()).selectedIds.length === 1, '画笔空闲Esc清空选择')
  await press('D', ['shift']); await press('Escape'); check((await state()).toolId === 'select' && (await state()).selectedIds.length === 1, '荧光笔空闲Esc错误')

  await reset(); await selectThree()
  contents.debugger.attach('1.3')
  try {
    const revision = (await state()).revision
    for (const type of ['keyDown', 'keyUp']) await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'å', code: 'KeyA', modifiers: 1, windowsVirtualKeyCode: 65 })
    s = await saved(revision)
  } finally { contents.debugger.detach() }
  check(s.selectedIds.every(id => s.actionShapes.find(r => r.id === id).x === 100), 'Option+A特殊字符没有对齐')
  check((await evaluate('window.__actionKeys')).some(e => e.key === 'å' && e.code === 'KeyA' && e.alt), 'Option样本未送达DOM')
  s = await edit(() => press('H', ['shift'])); check(s.toolId === 'select', '多选镜像误切工具')
  await remember('option-align-and-flip')

  for (const id of ['stretch-x', 'stretch-y', 'stack-x', 'stack-y', 'pack']) {
    await reset(); await selectThree(); const before = await state()
    s = await edit(() => button(id)); check(s.selectedIds.length === 3 && !same(pose(s), pose(before)), `${id} 没有修改/保留选择`)
    if (id === 'pack') {
      // 2026-11-26 isolated legacy native context-menu sample, same three shapes.
      check(same(['a', 'b', 'c'].map(id => [shape(s, id).x, shape(s, id).y]), [[340, 240], [340, 330], [340, 190]]), '紧凑排布次序或整体落点不符旧版菜单读数')
      await remember('pack-exact-positions')
      await writeFile(join(output, 'actions-pack.png'), (await contents.capturePage()).toPNG())
    }
    check(same(pose(await undo()), pose(before)), `${id} 一次撤销未还原`)
    if (id === 'pack') check(same(pose(await edit(() => press('Z', [mod, 'shift']))), pose(s)), '紧凑排布重做没有恢复精确落点')
  }
  await reset(); await selectThree()
  s = await edit(() => press('G', [mod])); check(s.selectedIds.length === 1 && s.actionShapes.find(r => r.id === s.selectedIds[0]).type === 'group', '组合未选新组')
  s = await edit(() => press('G', [mod])); check(s.selectedIds.length === 3, 'ModG未切换解组')
  s = await edit(() => press('L', ['shift'])); check(!s.selectedIds.length, '锁定未清选择')
  s = await edit(() => button('unlock-all')); check(!s.selectedIds.length && s.actionShapes.every(r => !r.isLocked), '全部解锁或选择策略错误')
  await remember('group-lock-unlock')

  await reset(); await click(1180, 400)
  check((await state()).selectedIds[0] === 'shape:action-frame', '没有选中框')
  s = await edit(() => button('fit-frame')); const frame = shape(s, 'frame')
  check(same([frame.x, frame.y, frame.props.w, frame.props.h], [950, 220, 160, 140]), '适配框未留50或内容跳位')
  await writeFile(join(output, 'actions-fit-frame.png'), (await contents.capturePage()).toPNG())
  s = await edit(() => press('F', [mod, 'shift'])); check(same(s.selectedIds, ['shape:action-child']) && shape(s, 'child').x === 1000 && shape(s, 'child').y === 270, '移除框没有保留内容位置/选择')

  await reset(); await click(130, 230)
  await input({ type: 'mouseDown', x: 140, y: 240, button: 'left', clickCount: 1 })
  await input({ type: 'mouseMove', x: 180, y: 260, button: 'left', modifiers: ['leftButtonDown'] })
  const active = await state(); await press('Enter'); s = await state()
  check(s.mode === active.mode && s.revision === '0', '活动拖动被Enter提前完成')
  await input({ type: 'mouseUp', x: 180, y: 260, button: 'left', clickCount: 1 }); await saved('0')
  // Button mouse-down does not focus it on every macOS Chromium setting.
  // Set real DOM focus as fixture setup; the host must derive its own owner.
  await evaluate('document.querySelector("#navigation button").focus();void 0')
  const beforeButton = await state()
  check(await evaluate('document.activeElement?.dataset.action === "first-content"'), '真实按钮没有获得DOM焦点')
  const keysBeforeButton = await evaluate('window.__actionKeys.length')
  // An offscreen inactive document may defer focus events; the native key's
  // target must still report the new button owner before the canvas handles it.
  s = await edit(() => press('Delete'))
  const buttonKeys = await evaluate(`window.__actionKeys.slice(${keysBeforeButton})`)
  check(buttonKeys.some(e => ['Delete', 'Backspace'].includes(e.key) && e.targetAction === 'first-content'), '原生删除键没有送达真实按钮')
  check(beforeButton.selectedIds.length === 1 && s.inputContext.owner === 'button' && s.commitCalls === beforeButton.commitCalls + 1 && !s.selectedIds.length && s.actionShapes.length === beforeButton.actionShapes.length - 1 && !shape(s, 'a'), '按钮Delete没有只删除选中对象一次')
  s = await undo()
  check(s.commitCalls === beforeButton.commitCalls + 1 && same(pose(s), pose(beforeButton)), '按钮Delete没有一次撤销完整恢复')
  await click(180, 260)
  check(same((await state()).selectedIds, beforeButton.selectedIds), '真实input保护须先选回可删除对象')
  await evaluate('(()=>{const node=document.createElement("input");node.id="actions-form-probe";node.value="synthetic";document.body.append(node);node.focus()})();void 0')
  check(await evaluate('document.activeElement?.id === "actions-form-probe"'), '真实input没有获得DOM焦点')
  const beforeForm = await state()
  await press('Delete'); s = await state()
  check(s.inputContext.owner === 'form' && s.revision === beforeForm.revision && s.commitCalls === beforeForm.commitCalls && same(s.selectedIds, beforeForm.selectedIds) && same(pose(s), pose(beforeForm)), '真实input中的删除键误改文档、选区或位置')
  await remember('enter-and-form-gate')
  await writeFile(join(output, 'actions-final.png'), (await contents.capturePage()).toPNG())
  return { nativeRepeatFlags: repeats, singleUndoPerHold: true, separatePressesUndoSeparately: true, optionCodeAlignment: true, toolbarActions: 7, framePaddingAndSelection: true, groupLockSelection: true, enterKeepsGesture: true, buttonDeleteSingleUndo: true, formGate: true, screenshots: ['actions-fit-frame.png', 'actions-final.png'], samples: samples.length }
}
