import { setTimeout as delay } from 'node:timers/promises'
const check = (value, message) => { if (!value) throw new Error(message) }

// Reuse the selection gallery and native input; DOM writes only prepare focus
// controls. No test shortcut dispatches selection actions or invokes handlers.
export async function selectionContextSmoke(target) {
  const contents = target.webContents, evaluate = code => contents.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const focus = id => evaluate(`document.querySelector('#${id}').focus();void 0`)
  const key = async (keyCode, modifiers = [], type) => {
    if (keyCode === 'a' && modifiers.includes('meta')) {
      // Offscreen macOS windows have no application menu to translate Cmd+A
      // into Blink's native editing command. Send that same command with the
      // native key event; the canvas may still prevent its default normally.
      const debuggerApi = contents.debugger, owned = !debuggerApi.isAttached()
      if (owned) debuggerApi.attach('1.3')
      try {
        await debuggerApi.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4, commands: ['selectAll'] })
        await debuggerApi.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 })
      } finally { if (owned) debuggerApi.detach() }
      await delay(30); return
    }
    for (const event of type ? [type] : ['keyDown', 'keyUp']) { contents.sendInputEvent({ type: event, keyCode, modifiers }); await delay(30) }
  }
  const mouse = async (type, x, y) => { contents.sendInputEvent({ type, x, y, button: 'left', modifiers: type === 'mouseMove' ? ['leftButtonDown'] : [] }); await delay(40) }
  const click = async (x, y) => { await mouse('mouseDown', x, y); await mouse('mouseUp', x, y) }
  const same = (a, b) => JSON.stringify([a.selectedIds, a.focusedGroupId, a.camera]) === JSON.stringify([b.selectedIds, b.focusedGroupId, b.camera])
  await focus('canvas'); await key('Escape'); await key('Escape'); await click(120, 120)
  const initial = await state()
  await evaluate(`(() => {
    for (const [id, tag] of [['input','input'],['textarea','textarea'],['select','select'],['editable','div'],['menu','div']]) {
      const node=document.createElement(tag); node.id='selection-probe-'+id;
      if(id==='editable')node.contentEditable='true';
      if(id==='menu'){node.setAttribute('role','menu');node.tabIndex=0}
      if(id==='select')node.add(new Option('Synthetic option','one'));
      if(['input','textarea'].includes(id))node.value='synthetic selection text';
      document.body.append(node);
    }
    window.__selectionKeys=[];
    document.addEventListener('keydown',event=>queueMicrotask(()=>window.__selectionKeys.push({key:event.key,composing:event.isComposing,prevented:event.defaultPrevented,target:event.target.id})))
  })();void 0`)
  for (const id of ['input', 'textarea', 'select', 'editable', 'menu']) {
    await focus(`selection-probe-${id}`)
    await key('a', ['meta'])
    if (['input', 'textarea'].includes(id)) check(await evaluate(`(()=>{const n=document.querySelector('#selection-probe-${id}');return n.selectionStart===0&&n.selectionEnd===n.value.length})()`), `${id} 原生全选未保留`)
    await key('Escape')
    check(same(await state(), initial), `${id} 的 Mod+A/Esc 改了画板选择或组焦点`)
  }
  for (const owner of ['input', 'menu']) for (const name of ['Tab', 'Return']) {
    await focus('canvas'); await key('Escape'); await key('Escape')
    await click(name === 'Tab' ? 120 : 620, name === 'Tab' ? 120 : 320)
    const before = await state()
    await key(name, [], 'keyDown'); await focus(`selection-probe-${owner}`); await focus('canvas'); await key(name, [], 'keyUp')
    check(same(await state(), before), `${name} 跨 ${owner} 焦点后残留待松键选择`)
  }
  await focus('selection-probe-input')
  contents.debugger.attach('1.3')
  try {
    await contents.debugger.sendCommand('Input.imeSetComposition', { text: 'han', selectionStart: 0, selectionEnd: 3 })
    const before = await state()
    await key('a', ['meta']); await key('Escape')
    check(same(await state(), before), '原生 IME 按键泄漏到选择工具')
    await contents.debugger.sendCommand('Input.insertText', { text: '汉' })
  } finally { contents.debugger.detach() }
  const ime = await evaluate('window.__selectionKeys.filter(e=>e.composing)')
  check(ime.length > 0 && ime.every(e => !e.prevented), '没有收到原生组字按键，或其默认输入被截获')
  await focus('canvas'); await key('Escape'); await key('Escape')
  // A long gap is a fresh first click; its comma down/up pairs must then count
  // as two canvas clicks through dispatchCore, not as host dblclick events.
  await delay(450); contents.sendInputEvent({ type: 'mouseMove', x: 620, y: 320 }); await delay(35)
  await key(','); await key(',')
  const group = await state()
  check(group.focusedGroupId === 'shape:outer' && group.selectedIds.includes('shape:e'), '逗号连续两击没有经编辑层计次进入组')
  await key(',', [], 'keyDown'); await key('Escape'); await key(',', [], 'keyUp')
  check(same(await state(), group), '逗号活动 Esc 额外清选择或退出当前组')
  await key('Escape'); await key('Escape')
  contents.sendInputEvent({ type: 'mouseMove', x: 620, y: 320 }); await delay(35)
  await key(',', [], 'keyDown'); await focus('selection-probe-input'); await focus('canvas'); await key(',', [], 'keyUp')
  await click(620, 320)
  check((await state()).focusedGroupId === 'page:page', '逗号失焦取消后普通点击被残留连击误认成双击')
  await key('Escape'); await key('Escape'); await click(120, 120)
  contents.sendInputEvent({ type: 'mouseMove', x: 130, y: 130 }); await delay(35); await key(',', [], 'keyDown')
  contents.sendInputEvent({ type: 'mouseMove', x: 160, y: 150 }); await delay(35)
  check((await state()).mode === 'dragging', '逗号失焦反例未开始活动手势')
  await focus('selection-probe-input'); await focus('canvas'); await key(',', [], 'keyUp')
  check((await state()).mode === 'idle' && (await state()).selectedShapes[0]?.x === 100, '逗号失焦未取消预览')
  const beforeReload = await state()
  check(beforeReload.revision === initial.revision, '上下文检查写入了画板')
  const load = async disabled => {
    const url = new URL(contents.getURL()); if (disabled) url.searchParams.set('shortcuts', '0'); else url.searchParams.delete('shortcuts')
    await target.loadURL(url.href)
    for (let i = 0; i < 500; i++) { const s = await state(); if (s?.error) throw new Error(s.error); if (s?.ready) break; await delay(20) }
    check((await state())?.ready, '切换快捷键预览未准备好'); await focus('canvas')
  }
  await load(true); await click(120, 120)
  const disabled = await state(); check(disabled.shortcutsEnabled === false, '普通快捷键开关未关闭')
  await key('a', ['meta']); await key('Escape'); check(same(await state(), disabled), '关闭普通快捷键仍全选或空闲清选择')
  await mouse('mouseDown', 130, 130); await mouse('mouseMove', 160, 150)
  check((await state()).mode === 'dragging', '关闭快捷键的取消反例未开始活动手势')
  await key('Escape'); await mouse('mouseUp', 160, 150)
  check((await state()).mode === 'idle' && (await state()).selectedShapes[0]?.x === 100 && (await state()).revision === disabled.revision, '关闭普通快捷键后必需 Esc 不能取消手势')
  await load(false); await click(120, 120); await key('a', ['meta'])
  check((await state()).selectedIds.length > 1, '重新启用后没有恢复全选'); await key('Escape')
  check((await state()).selectedIds.length === 0, '重新启用后没有恢复空闲清选择')
  return { nativeFormSelectAll: true, formAndMenuIsolation: true, pendingKeysCleared: true, nativeImeEvents: ime.length, commaDoubleClickAndCancel: true, commaEscapePreservesSelection: true, cancelledClickResets: true, disabledIdleAndEssentialEscape: true, enabledRestored: true, revisionUnchanged: true }
}
