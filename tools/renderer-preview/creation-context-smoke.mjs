import { setTimeout as delay } from 'node:timers/promises'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const check = (value, message) => { if (!value) throw new Error(message) }
const scope = state => ({ toolId: state.toolId, creation: state.creation, camera: state.camera, mode: state.mode, count: state.renderedShapes, revision: state.revision })

// Synthetic host controls exercise real focus/composition routing; saved
// document records remain observable only through the preview's public state.
export async function creationContextSmoke(target, output) {
  const contents = target.webContents, evaluate = code => contents.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const key = async (keyCode, modifiers = []) => {
    for (const type of ['keyDown', 'keyUp']) contents.sendInputEvent({ type, keyCode, modifiers })
    await delay(25)
  }
  const load = async disabled => {
    const url = new URL(contents.getURL()); url.search = `?gallery=creation&edgeScrolling=0${disabled ? '&shortcuts=0' : ''}`
    await target.loadURL(url.href)
    const end = Date.now() + 10000
    while (Date.now() < end) {
      const value = await state()
      if (value?.error) throw new Error(value.error)
      if (value?.ready) { await evaluate("document.querySelector('#canvas').focus();void 0"); return }
      await delay(20)
    }
    throw new Error('创建上下文预览未就绪')
  }
  await load(false)
  await key('R'); check((await state()).toolId === 'geo', '创建上下文正例 R 未切工具')
  await key('V')
  await evaluate(`(() => {
    const definitions=[['input','input'],['textarea','textarea'],['select','select'],['editable','div'],['text','div'],['menu','div']];
    for(const [id,tag] of definitions){const node=document.createElement(tag);node.id='creation-probe-'+id;
      if(id==='select')node.append(new Option('first','first'),new Option('other','other'));
      if(id==='editable'||id==='text')node.contentEditable='true';
      if(id==='text')node.dataset.canvasInputOwner='text-editing';
      if(id==='menu'){node.setAttribute('role','menu');node.tabIndex=0}
      document.body.append(node)
    }
    window.__creationKeys=[];document.addEventListener('keydown',event=>queueMicrotask(()=>window.__creationKeys.push({key:event.key,composing:event.isComposing,prevented:event.defaultPrevented})))
  })();void 0`)
  const contexts = []
  for (const [id, owner] of [['input','form'],['textarea','form'],['select','form'],['editable','form'],['text','text-editing'],['menu','menu']]) {
    await evaluate(`document.querySelector('#creation-probe-${id}').focus();void 0`)
    const before = scope(await state())
    for (const code of ['R','O','F','G','Q','A']) await key(code)
    await key('Z', ['meta']); await key('Z', ['control'])
    const after = await state()
    check(after.inputContext.owner === owner && JSON.stringify(scope(after)) === JSON.stringify(before) && !after.lastError, `${id} 原生按键触发创建或画板撤销`)
    contexts.push({ id, owner, unchanged: true })
  }
  const ordinary = await evaluate('window.__creationKeys.slice()')
  check(ordinary.length === 48 && ordinary.every(event => !event.prevented), '表单/菜单没有保留全部原生默认按键')
  await evaluate("document.querySelector('#creation-probe-text').focus();void 0")
  contents.debugger.attach('1.3')
  try {
    await contents.debugger.sendCommand('Input.imeSetComposition', { text: 'han', selectionStart: 0, selectionEnd: 3 })
    const before = scope(await state())
    for (const code of ['R','O','F','G','Q','A']) await key(code)
    check(JSON.stringify(scope(await state())) === JSON.stringify(before), '真实组字按键触发创建')
    await contents.debugger.sendCommand('Input.insertText', { text: '汉' })
  } finally { contents.debugger.detach() }
  const composing = await evaluate('window.__creationKeys.filter(event=>event.composing)')
  check(composing.length >= 6 && composing.every(event => !event.prevented), '没有得到真实 isComposing 按键或原生输入被拦截')
  await evaluate("document.querySelector('#canvas').focus();void 0")
  await key('O')
  check((await state()).toolId === 'geo' && (await state()).creation.geo === 'ellipse', '焦点返回画布没有恢复创建快捷键')
  await load(true)
  const disabled = scope(await state())
  for (const code of ['R','O','F','G','Q','A']) await key(code)
  check((await state()).shortcutsEnabled === false && JSON.stringify(scope(await state())) === JSON.stringify(disabled), '快捷键总开关关闭后仍可创建')
  await load(false)
  await key('F'); check((await state()).toolId === 'frame', '重新开启后 F 没有恢复')
  await load(false)
  const result = { contexts, nativeDefaultKeys: ordinary.length, nativeComposingKeys: composing.length, restoredCanvas: true, disabledAndRestored: true }
  await writeFile(join(output, 'creation-context.json'), JSON.stringify(result, null, 2))
  return result
}
