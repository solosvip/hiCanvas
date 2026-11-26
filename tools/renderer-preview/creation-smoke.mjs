import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { creationContextSmoke } from './creation-context-smoke.mjs'

const check = (value, message) => { if (!value) throw new Error(message) }
const box = shape => [shape.x, shape.y, shape.w, shape.h]
const equal = (actual, expected, message) => check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`)

// Native offscreen input only. DOM snapshots identify controls; the public
// read-only preview state observes effects without reaching into a Store.
export async function creationSmoke(target, output) {
  const inputContext = await creationContextSmoke(target, output)
  const contents = target.webContents, evaluate = code => contents.executeJavaScript(code)
  contents.focus()
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const until = async (predicate, label) => {
    const end = Date.now() + 10000
    while (Date.now() < end) { const value = await predicate(); if (value) return value; await delay(20) }
    throw new Error(`创建工具等待超时：${label}；${JSON.stringify(await state())}`)
  }
  let held = false
  const pointer = async (type, x, y, modifiers = []) => {
    if (type === 'mouseDown') held = true
    contents.sendInputEvent({ type, x, y, ...(type !== 'mouseMove' || held ? { button: 'left' } : {}), clickCount: 1, modifiers: [...modifiers, ...(type === 'mouseMove' && held ? ['leftButtonDown'] : [])] })
    if (type === 'mouseUp') held = false
    await delay(20)
  }
  const click = async (x, y) => { await pointer('mouseMove', x, y); await pointer('mouseDown', x, y); await pointer('mouseUp', x, y) }
  const key = async (keyCode, modifiers = []) => {
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await delay(20)
  }
  const historyModifier = process.platform === 'darwin' ? 'meta' : 'control'
  const saved = revision => until(async () => { const s = await state(); return !s.submitting && s.revision !== revision && s }, '保存')
  const undo = async () => { const revision = (await state()).revision; await key('Z', [historyModifier]); return saved(revision) }
  const snapshot = await evaluate(`Array.from(document.querySelectorAll('nav button, nav select'),e=>{const b=e.getBoundingClientRect();return {tag:e.tagName,label:e.getAttribute('aria-label')||e.textContent,tool:e.dataset.tool,action:e.dataset.creationAction,x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height,options:e.options?.length}})`)
  await writeFile(join(output, 'creation-controls.json'), JSON.stringify(snapshot, null, 2))
  const tools = new Map(snapshot.filter(s => s.tool).map(s => [s.tool, s])), actions = new Map(snapshot.filter(s => s.action).map(s => [s.action, s]))
  check(tools.size === 7 && ['text', 'geo', 'frame', 'ai-image', 'ai-draft', 'ai-film', 'ai-slides'].every(id => tools.has(id)) && snapshot.some(s => s.tag === 'SELECT' && s.options === 20), '创建预览没有七种工具和20种几何选择')
  check(snapshot.filter(s => s.tool || s.action).every(s => s.h >= 44), '创建按钮点击高度不足44像素')
  const toolClick = id => { const b = tools.get(id); return click(Math.round(b.x), Math.round(b.y)) }
  const actionClick = id => { const b = actions.get(id); return click(Math.round(b.x), Math.round(b.y)) }
  const dragIn = async id => {
    const b = tools.get(id); await pointer('mouseMove', Math.round(b.x), Math.round(b.y)); await pointer('mouseDown', Math.round(b.x), Math.round(b.y))
    await pointer('mouseMove', 500, 350)
    return { beforeUp: await state(), button: b }
  }
  check((await state()).renderedShapes === 0, '创建预览必须从合成空板开始')
  let revision = (await state()).revision
  await key('R'); await click(500, 350)
  let s = await saved(revision)
  equal(box(s.selectedShapes[0]), [400, 250, 200, 200], '原生点击默认大小')
  check(s.toolId === 'select' && s.creation.recentTool.geo === 'rectangle', '完成没有回选择或记住工具')
  await undo(); check((await state()).renderedShapes === 0, '一次撤销没有删除整次创建')
  const beforeDrag = await state()
  await key('R'); await pointer('mouseDown', 500, 350); await pointer('mouseMove', 650, 430, ['shift', 'alt'])
  s = await state(); equal(box(s.selectedShapes[0]), [351, 201, 299, 299], '原生 Shift+Alt 拖动')
  check(s.revision === beforeDrag.revision && s.snapshotReads === beforeDrag.snapshotReads, '创建预览提前保存或序列化了整板')
  await writeFile(join(output, 'creation-preview.png'), (await contents.capturePage()).toPNG())
  await pointer('mouseUp', 650, 430, ['shift', 'alt']); await saved(beforeDrag.revision); await undo()
  revision = (await state()).revision
  await key('Q'); await key('O'); await click(500, 350); s = await saved(revision)
  check(s.toolId === 'geo' && s.creation.toolLocked && s.selectedShapes[0].props.geo === 'ellipse', 'Q 锁没有保留椭圆工具')
  revision = s.revision; await click(850, 500); await saved(revision)
  check((await state()).renderedShapes === 2, '工具锁没有连续创建')
  await undo(); await undo(); check((await state()).creation.toolLocked, '撤销不应撤销会话工具锁')
  await actionClick('locked'); await actionClick('recent')
  check((await state()).toolId === 'geo' && (await state()).creation.geo === 'ellipse', '最近工具没有恢复几何变体')
  await key('R')
  const beforeToolbar = await state(), drag = await dragIn('geo')
  equal(box(drag.beforeUp.selectedShapes[0]), [400, 250, 200, 200], '工具栏拖入第一帧没有跟手')
  check(drag.beforeUp.revision === beforeToolbar.revision && drag.beforeUp.creation.dragFromToolbar, '工具栏起手提前保存或走错来源')
  await pointer('mouseUp', 650, 430); s = await saved(beforeToolbar.revision)
  equal(box(s.selectedShapes[0]), [550, 330, 200, 200], '工具栏落点没有居中')
  check(s.toolId === 'select', '工具栏落点没有回选择'); await undo()
  const cancelledRevision = (await state()).revision, cancel = await dragIn('geo')
  await pointer('mouseUp', Math.round(cancel.button.x), Math.round(cancel.button.y))
  check((await state()).renderedShapes === 0 && (await state()).revision === cancelledRevision, '拖回工具栏没有取消')
  await dragIn('geo'); await pointer('mouseUp', -20, 430)
  check((await state()).renderedShapes === 0 && (await state()).revision === cancelledRevision, '拖出画布没有取消')
  await dragIn('geo'); await key('Escape'); await pointer('mouseUp', 650, 430)
  check((await state()).renderedShapes === 0 && (await state()).revision === cancelledRevision, '工具栏 Esc 留下了对象')
  // A normal up after toolbar cancellations also guards listener reuse.
  await toolClick('frame'); await click(500, 350); s = await saved(cancelledRevision)
  equal(box(s.selectedShapes[0]), [340, 260, 320, 180], '画框单击默认大小'); await undo()
  for (const [id, expected, marker] of [
    ['ai-image', [384, 58.5, 512, 683], 'cowartAiImageHolder'],
    ['ai-draft', [128, 112, 1024, 576], 'cowartAiDraftHolder'],
    ['ai-film', [128, 112, 1024, 576], 'cowartAiFilmHolder'],
    ['ai-slides', [116, 100, 1048, 600], 'cowartAiSlides'],
  ]) {
    revision = (await state()).revision; await toolClick(id); s = await saved(revision)
    equal(box(s.selectedShapes[0]), expected, `${id} 原生工具栏点击`)
    check(s.selectedShapes[0].meta[marker] && s.toolId === 'select', `${id} 身份或完成工具错误`)
    await undo()
  }
  await actionClick('dynamic'); await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:2});void 0')
  revision = (await state()).revision; await key('R'); await click(500, 350); s = await saved(revision)
  equal(box(s.selectedShapes[0]), [200, 125, 100, 100], '动态尺寸没有按视角缩放')
  check(s.selectedShapes[0].props.scale === .5 && !s.lastError, '动态笔触或创建错误')
  await undo(); revision = (await state()).revision
  await key('Z', [historyModifier, 'shift']); s = await saved(revision)
  check(s.renderedShapes === 1, '重做没有恢复绘制对象')
  // History restores the record, while selection remains session state.
  await click(400, 350)
  s = await until(async () => { const s = await state(); return s.selectedShapes.length === 1 && s }, '重做后点选')
  equal(box(s.selectedShapes[0]), [200, 125, 100, 100], '重做没有还原整次创建')
  await writeFile(join(output, 'creation-final.png'), (await contents.capturePage()).toPNG())
  return { inputContext, nativeClickAndModifiedDrag: true, oneUndoRedo: true, noSnapshotsDuringPreview: true, toolLockAndRecent: true, toolbarFirstFrameAndDrop: true, toolbarUiOutsideEscapeCancel: true, ordinaryAndFourAiFrames: true, dynamicSize: true, finalShape: s.selectedShapes[0] }
}
