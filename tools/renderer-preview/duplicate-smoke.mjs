import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const check = (value, message) => { if (!value) throw new Error(message) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Synthetic gallery only. All gestures use Chromium native input; JS sets DOM
// focus / reloads fixtures and reads state, never invokes an editor action.
export async function duplicateSmoke(target, output) {
  const contents = target.webContents, evaluate = code => contents.executeJavaScript(code), samples = []
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const flush = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const input = async event => { contents.sendInputEvent(event); await flush() }
  const key = async (keyCode, modifiers = [], type = null) => { for (const phase of type ? [type] : ['keyDown', 'keyUp']) await input({ type: phase, keyCode, modifiers }) }
  const press = async (keyCode, modifiers = []) => {
    const names = { meta: 'Meta', control: 'Control', alt: 'Alt', shift: 'Shift' }, held = []
    for (const m of modifiers) { held.push(m); await key(names[m], held, 'keyDown') }
    await key(keyCode, held)
    for (const m of [...modifiers].reverse()) { held.splice(held.indexOf(m), 1); await key(names[m], held, 'keyUp') }
  }
  const mouse = (type, x, y, modifiers = []) => input({ type, x, y, button: 'left', clickCount: 1, modifiers })
  const click = async (x, y, modifiers = []) => { await mouse('mouseMove', x, y, modifiers); await mouse('mouseDown', x, y, modifiers); await mouse('mouseUp', x, y, modifiers) }
  const mod = process.platform === 'darwin' ? 'meta' : 'control'
  async function until(predicate, label) {
    const end = Date.now() + 10000
    while (Date.now() < end) { const s = await state(); if (predicate(s)) return s; await delay(10) }
    throw new Error(`复制原生回归超时：${label}；${JSON.stringify(await state())}`)
  }
  const saved = revision => until(s => !s.submitting && s.revision !== revision, '一次保存')
  const edit = async action => { const before = await state(); await action(); return saved(before.revision) }
  const original = s => s.actionShapes.find(r => r.id === 'shape:action-a')
  const selected = s => s.actionShapes.find(r => r.id === s.selectedIds[0])
  const undo = () => edit(() => press('Z', [mod]))
  const remember = async label => { const s = await state(); samples.push({ label, ...s }); await writeFile(join(output, 'duplicate-samples.json'), JSON.stringify(samples, null, 2)); return s }
  const reset = async () => {
    await target.loadURL(new URL('/?gallery=selection-actions&edgeScrolling=0&reduceMotion=1', contents.getURL()).href)
    await until(s => s.ready && !s.error, '合成小板'); contents.focus()
    await evaluate('document.querySelector("#canvas").focus();window.__duplicateKeys=[];document.addEventListener("keydown",e=>window.__duplicateKeys.push({key:e.key,code:e.code,meta:e.metaKey,ctrl:e.ctrlKey,alt:e.altKey,target:e.target?.id}),true);void 0')
    await click(140, 240)
  }

  await reset()
  for (const x of [210, 320, 430]) {
    const s = await edit(() => press('D', [mod])); check(selected(s).x === x && selected(s).y === 200 && original(s).x === 100, 'Mod+D连续偏移/选择错误')
  }
  let s = await undo(); check(selected(s).x === 320 && s.actionShapes.length === 8, 'Mod+D一次撤销未选上一副本')
  s = await edit(() => press('Z', [mod, 'shift'])); check(selected(s).x === 430, 'Mod+D重做选择错误')
  await remember('modd-three-and-history')
  await writeFile(join(output, 'duplicate-consecutive.png'), (await contents.capturePage()).toPNG())

  await reset(); const before = await state()
  await mouse('mouseDown', 140, 240); await mouse('mouseMove', 190, 270, ['leftButtonDown'])
  check(original(await state()).x === 150, '拖动没有移动原件')
  await key('Alt', ['alt'], 'keyDown'); s = await remember('alt-down')
  const firstCopy = selected(s).id
  check(firstCopy !== 'shape:action-a' && original(s).x === 100 && selected(s).x === 150 && selected(s).y === 230 && s.revision === before.revision, 'Alt按下没有还原原件/预览副本')
  await mouse('mouseMove', 230, 300, ['alt', 'leftButtonDown'])
  await writeFile(join(output, 'duplicate-alt-preview.png'), (await contents.capturePage()).toPNG())
  await key('Alt', [], 'keyUp'); s = await remember('alt-up')
  check(s.selectedIds[0] === 'shape:action-a' && original(s).x === 190 && original(s).y === 260 && !s.actionShapes.some(r => r.id === firstCopy), 'Alt松开没有恢复移动原件')
  await key('Alt', ['alt'], 'keyDown'); s = await state(); const secondCopy = selected(s).id
  check(secondCopy !== firstCopy && original(s).x === 100 && s.revision === before.revision, '再次Alt没有新副本或提前提交')
  await mouse('mouseUp', 230, 300, ['alt']); await saved(before.revision); await key('Alt', [], 'keyUp')
  s = await undo(); check(same(s.actionShapes, before.actionShapes) && s.selectedIds[0] === 'shape:action-a', '一次撤销没有还原整次Alt切换')
  s = await edit(() => press('Z', [mod, 'shift'])); check(s.selectedIds[0] === secondCopy, 'Alt重做没有选择副本')
  s = await edit(() => press('D', [mod])); check(selected(s).x === 280 && selected(s).y === 320, 'Alt拖动(90,60)没有成为连续复制偏移')
  await remember('alt-toggle-single-undo-and-repeat')
  await mouse('mouseDown', 320, 360); await mouse('mouseMove', 350, 380, ['alt', 'leftButtonDown']); await press('Escape'); await mouse('mouseUp', 350, 380)
  s = await edit(() => press('D', [mod])); check(selected(s).x === 370 && selected(s).y === 380, '取消Alt预览丢失已有连续复制偏移')
  await remember('repeat-offset-survives-cancel')

  await reset(); const cancelBefore = await state()
  await mouse('mouseDown', 140, 240); await mouse('mouseMove', 210, 280, ['alt', 'leftButtonDown']); await press('Escape')
  await mouse('mouseUp', 210, 280); s = await state()
  check(same(s.actionShapes, cancelBefore.actionShapes) && s.revision === cancelBefore.revision && s.selectedIds[0] === 'shape:action-a', 'Esc残留副本、位移或历史')
  await evaluate('document.querySelector("#navigation button").focus();void 0')
  await press('D', [mod]); s = await state()
  check(s.inputContext.owner === 'form' && same(s.actionShapes, cancelBefore.actionShapes) && s.revision === cancelBefore.revision, '表单焦点误触Mod+D')
  await remember('escape-and-form-gate')
  const keys = await evaluate('window.__duplicateKeys')
  check(keys.some(e => e.code === 'KeyD' && (e.meta || e.ctrl)), '未送达原生Mod+D')
  await writeFile(join(output, 'duplicate-final.png'), (await contents.capturePage()).toPNG())
  return { nativeModD: true, liveAltToggle: true, newCopyIdsOnToggle: true, oneUndoPerDrag: true, transientRepeatOffset: true, escapeAndFormGate: true, samples: samples.length, screenshots: ['duplicate-consecutive.png', 'duplicate-alt-preview.png', 'duplicate-final.png'] }
}
