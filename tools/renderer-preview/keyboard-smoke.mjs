import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
const check = (value, message) => { if (!value) throw new Error(message) }
const until = async predicate => {
  const end = Date.now() + 15000
  while (Date.now() < end) { const value = await predicate(); if (value) return value; await delay(20) }
  throw new Error('键盘输入状态等待超时。')
}

// Native Chromium key/composition input, isolated preview and read-only state.
// Temporary controls test host ownership without adding product UI or styles.
export async function keyboardSmoke(target, output) {
  const contents = target.webContents, evaluate = code => contents.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const key = async (keyCode, type, modifiers = []) => {
    for (const event of type ? [type] : ['keyDown', 'keyUp']) contents.sendInputEvent({ type: event, keyCode, modifiers })
    await delay(35)
  }
  const pointer = async (x, y) => { contents.sendInputEvent({ type: 'mouseMove', x, y }); await delay(35) }
  const focus = () => evaluate("document.querySelector('#canvas').focus();void 0")
  const reset = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:1});void 0')
  const load = async disabled => {
    const url = new URL(contents.getURL()); url.search = disabled ? '?count=500&shortcuts=0' : '?count=500'
    await target.loadURL(url.href)
    await until(async () => { const value = await state(); if (value?.error) throw new Error(value.error); return value?.ready })
    await reset(); await focus()
  }
  await load(false)
  await key('h'); check((await state()).toolId === 'hand', '画布 H 正例没有切换工具')
  await key('v')
  const initial = await state()
  await evaluate(`(() => {
    const input=document.createElement('input'); input.id='keyboard-probe-form';
    const menu=document.createElement('div'); menu.id='keyboard-probe-menu'; menu.setAttribute('role','menu'); menu.tabIndex=0;
    const text=document.createElement('div'); text.id='keyboard-probe-text'; text.contentEditable='true'; text.dataset.canvasInputOwner='text-editing';
    document.body.append(input,menu,text); window.__keyboardProbe=[];
    document.addEventListener('keydown',event=>queueMicrotask(()=>window.__keyboardProbe.push({key:event.key,isComposing:event.isComposing,prevented:event.defaultPrevented})))
  })();void 0`)
  for (const [id, owner] of [['form', 'form'], ['menu', 'menu'], ['text', 'text-editing']]) {
    await evaluate(`document.querySelector('#keyboard-probe-${id}').focus();void 0`)
    for (const code of ['h', '=', 'z', ',']) await key(code)
    await key('z', null, ['meta'])
    const value = await state()
    check(value.inputContext.owner === owner && value.toolId === 'select' && value.camera.z === 1 && value.mode === 'idle', `${owner} 的按键漏到画布`)
    check(value.revision === initial.revision && !value.lastError, `${owner} 的原生撤销误触画板历史`)
  }
  await evaluate("document.querySelector('#keyboard-probe-form').focus();void 0")
  contents.debugger.attach('1.3')
  try {
    await contents.debugger.sendCommand('Input.imeSetComposition', { text: 'han', selectionStart: 0, selectionEnd: 3 })
    await key('h'); await key('=')
    check((await state()).toolId === 'select' && (await state()).camera.z === 1, '原生输入法组字触发画布快捷键')
    await contents.debugger.sendCommand('Input.insertText', { text: '汉' })
  } finally { contents.debugger.detach() }
  const ime = await evaluate('window.__keyboardProbe.filter(event=>event.isComposing)')
  check(ime.length >= 2 && ime.every(event => !event.prevented), 'IME 反例没有产生真实 isComposing 按键，或默认输入被截获')
  await focus(); await key('Space', 'keyDown')
  check((await state()).temporaryTool === 'hand', '空格正例没有临时手形')
  await evaluate("document.querySelector('#keyboard-probe-form').focus();void 0")
  check((await state()).temporaryTool === null, '焦点转移没有释放临时工具')
  await key('Space', 'keyUp'); await focus()
  await pointer(40, 40); await key(',', 'keyDown')
  const pressed = await state()
  check(pressed.mode === 'pointing' && pressed.selectedShapes.length === 1, '原生逗号没有在当前指针按下')
  await pointer(60, 50)
  const moved = await state()
  check(moved.mode === 'dragging' && moved.selectedShapes[0].x === pressed.selectedShapes[0].x + 20 && moved.selectedShapes[0].y === pressed.selectedShapes[0].y + 10, '逗号按住后移动没有跟手')
  check(moved.revision === pressed.revision, '逗号移动提前保存了手势')
  await key(',', 'keyUp'); await until(async () => !(await state()).submitting)
  const saved = await state()
  check(saved.mode === 'idle' && saved.revision !== pressed.revision, '逗号松键没有整次保存')
  await reset(); await key('Space', 'keyDown'); await key('Right'); await key('Space', 'keyUp')
  await until(async () => !(await state()).needsFrame)
  const pan = (await state()).camera
  check(pan.x === -1280 && pan.y === 0, '空格方向键未按视口宽度平移')
  await writeFile(join(output, 'keyboard-context.png'), (await contents.capturePage()).toPNG())
  await load(true)
  check((await state()).shortcutsEnabled === false, '预览没有接入快捷键会话开关')
  for (const code of ['h', '=', 'z', ',']) await key(code)
  const disabled = await state()
  check(disabled.toolId === 'select' && disabled.camera.z === 1 && disabled.mode === 'idle' && !disabled.lastError, '关闭普通快捷键后仍执行工具动作')
  await key('Space', 'keyDown'); await key('Down'); await key('Space', 'keyUp')
  await until(async () => !(await state()).needsFrame)
  const essential = await state()
  check(essential.camera.y === -800 && essential.revision === disabled.revision, '关闭普通快捷键后必需无障碍平移失效或改了画板')
  return { form: true, menu: true, textEditingBoundary: true, nativeImeEvents: ime.length, lostKeyUp: true, comma: { before: pressed.selectedShapes[0], after: saved.selectedShapes[0] }, pan, disabledEssentialPan: essential.camera }
}
