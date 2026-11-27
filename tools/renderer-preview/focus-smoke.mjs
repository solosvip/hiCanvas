import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { keyboardSmoke } from './keyboard-smoke.mjs'
import { minimapSmoke } from './minimap-smoke.mjs'

// Programmatic setup only creates/focuses temporary controls. Canvas edits,
// shortcuts, native activation and text use trusted Chromium input throughout.
export async function focusSmoke(target, output) {
  const wc = target.webContents, samples = [], navigation = []
  let assertions = 0, failure = null
  const check = (value, label) => { assertions++; if (!value) throw new Error(label) }
  const evaluate = code => wc.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const flush = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const until = async (predicate, label) => {
    const end = Date.now() + 15000
    while (Date.now() < end) { const s = await state(); if (s?.error || s?.lastError) throw new Error(s.error || s.lastError.message); if (await predicate(s)) return s; await delay(20) }
    throw new Error(`焦点回归等待超时：${label}`)
  }
  const preventNavigation = (event, url) => { event.preventDefault(); navigation.push(url) }
  wc.on('will-navigate', preventNavigation)
  wc.setWindowOpenHandler(({ url }) => { navigation.push(url); return { action: 'deny' } })
  async function load(query = 'gallery=focus-keys') {
    const url = new URL(wc.getURL()); url.search = `?${query}&edgeScrolling=0&reduceMotion=1`
    await target.loadURL(url.href); await until(s => s.ready, 'ready')
    await evaluate(`document.querySelector('#canvas').focus();window.__focusEvents=[];window.__focusLast=null;
      for(const type of ['keydown','keyup','click','input','change']) document.addEventListener(type,e=>{
        if(type==='keydown')window.__focusLast=e;
        setTimeout(()=>window.__focusEvents.push({type,key:e.key,code:e.code,repeat:e.repeat,trusted:e.isTrusted,prevented:e.defaultPrevented,id:e.target.id,tag:e.target.tagName}),0)
      },true);void 0`)
  }
  const mouse = async (type, x, y, modifiers = []) => { wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers: type === 'mouseMove' ? ['leftButtonDown', ...modifiers] : modifiers }); await flush() }
  const click = async (x, y, modifiers) => { await mouse('mouseDown', x, y, modifiers); await mouse('mouseUp', x, y, modifiers) }
  async function key(code, modifiers = [], char, repeat = false) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: code, modifiers, isAutoRepeat: repeat }); await flush()
    const prevented = await evaluate('Boolean(window.__focusLast?.defaultPrevented)')
    if (char && !prevented) { wc.sendInputEvent({ type: 'char', keyCode: char, modifiers }); await flush() }
    wc.sendInputEvent({ type: 'keyUp', keyCode: code, modifiers }); await flush()
    return prevented
  }
  async function focusCanvas() { await evaluate("document.querySelector('#canvas').focus();void 0") }
  async function selectA() {
    await focusCanvas(); await key('V'); await click(380, 250)
    check(JSON.stringify((await state()).selectedIds) === '["shape:focus-a"]', '选择正例必须是原始a')
  }
  async function control(kind, expanded = false) {
    await evaluate(`(() => {
      document.querySelector('#focus-probes')?.remove();const root=document.createElement('div');root.id='focus-probes';
      const kind=${JSON.stringify(kind)}, expanded=${expanded};let el=document.createElement(kind==='anchor'||kind==='anchor-empty'?'a':kind==='select'?'select':kind==='input'?'input':kind==='textarea'?'textarea':kind==='editable'?'div':'button');
      el.id='focus-control';el.textContent='Focus control';
      if(kind==='anchor'){el.href=location.origin+'/?focus-navigation=blocked';el.tabIndex=0}
      if(kind==='anchor-empty')el.tabIndex=0;
      if(kind==='select'){el.replaceChildren(...['Alpha','King','Zulu'].map(s=>{const o=document.createElement('option');o.textContent=s;return o}));el.selectedIndex=0}
      if(kind==='input'||kind==='textarea')el.value='seed';
      if(kind==='editable'){el.contentEditable='true';el.textContent='seed'}
      if(kind==='toolbar'){root.setAttribute('role','toolbar');const next=document.createElement('button');next.id='focus-next';next.textContent='Next';root.append(next);root.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();(e.target===el?next:el).focus()}})}
      if(kind==='trigger'){el.setAttribute('aria-haspopup','menu');el.setAttribute('aria-expanded',String(expanded));const menu=document.createElement('div');menu.id='focus-menu';menu.setAttribute('role','menu');menu.hidden=!expanded;const item=document.createElement('button');item.id='focus-menu-item';item.textContent='Menu item';menu.append(item);root.append(menu);el.addEventListener('click',()=>{menu.hidden=false;el.setAttribute('aria-expanded','true');item.focus()});menu.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();menu.hidden=true;el.setAttribute('aria-expanded','false');el.focus()}})}
      if(kind==='menu'||kind==='dialog'||kind==='listbox')root.setAttribute('role',kind);
      if(kind==='text-owner')root.dataset.canvasInputOwner='text-editing';
      if(kind==='video-owner')root.dataset.canvasInputOwner='video';
      if(kind==='canvas-owner')root.dataset.canvasInputOwner='canvas';
      if(kind==='span'||kind==='svg'){const child=document.createElementNS(kind==='svg'?'http://www.w3.org/2000/svg':'http://www.w3.org/1999/xhtml',kind);child.id='focus-child';child.setAttribute('tabindex','0');el.append(child)}
      root.prepend(el);document.body.append(root);(kind==='span'||kind==='svg'?el.firstElementChild:el).focus();
    })();void 0`)
    const id = await evaluate('document.activeElement.id')
    check(id === (['span', 'svg'].includes(kind) ? 'focus-child' : 'focus-control'), `${kind}焦点前提失败：${id}`)
  }
  async function remember(label, extra = {}) {
    const s = await state(), active = await evaluate('({id:document.activeElement.id,tag:document.activeElement.tagName,role:document.activeElement.getAttribute("role")})')
    const events = await evaluate('window.__focusEvents.splice(0)')
    check(events.filter(e => ['keydown', 'keyup', 'click', 'input', 'change'].includes(e.type)).every(e => e.trusted), `${label}包含伪造输入`)
    samples.push({ label, state: s, active, events, ...extra })
    await writeFile(join(output, 'focus-cases.json'), JSON.stringify({ assertions, samples, navigation }, null, 2))
  }
  try {
    for (const kind of ['button', 'toolbar', 'anchor', 'trigger']) {
      await load(); await selectA(); await control(kind)
      for (const [code, modifiers, tool] of [
        ['H', [], 'hand'], ['D', [], 'draw'], ['B', [], 'draw'], ['X', [], 'draw'], ['E', [], 'eraser'],
        ['R', [], 'geo'], ['O', [], 'geo'], ['G', [], 'geo'], ['F', [], 'frame'], ['T', [], 'text'],
        ['N', [], 'note'], ['L', [], 'line'], ['K', [], 'laser'], ['D', ['shift'], 'highlight'], ['V', [], 'select'],
      ]) {
        check(await key(code, modifiers, code.toLowerCase()), `${kind}/${code}未阻止画布绑定默认`)
        check((await state()).toolId === tool, `${kind}/${code}没有沿用工具绑定`)
      }
      await key('A'); await until(s => !s.submitting && s.focusRecords.some(r => r.type === 'frame'), `${kind}/A占位`)
      check(!(await evaluate('window.__focusEvents.some(e=>e.type==="click"&&e.id?.startsWith("focus-"))')), `${kind}工具键误激活控件`)
      await remember(`${kind}-all-tool-bindings`)

      await load(); await selectA(); await control(kind)
      check(await key('D', ['meta']), `${kind}/ModD未处理`)
      const duplicate = await until(s => !s.submitting && s.focusRecords.length === 4, `${kind}/duplicate`)
      check(duplicate.selectedShapes[0].x === 470, `${kind}复制偏移错误`)
      await key('Z', ['meta']); await until(s => !s.submitting && s.focusRecords.length === 3, 'undo duplicate')
      await key('Z', ['meta', 'shift']); await until(s => !s.submitting && s.focusRecords.length === 4, 'redo duplicate')
      await key('A', ['meta']); check((await state()).selectedIds.length === 4, `${kind}/ModA未全选`)
      await key('G', ['meta']); await until(s => !s.submitting && s.selectedShapes[0]?.type === 'group', 'group')
      await key('G', ['meta', 'shift']); await until(s => !s.submitting && s.selectedIds.length === 4, 'ungroup')
      await key('=', ['meta']); check((await state()).camera.z === 2, `${kind}/Mod=未缩放`)
      await key('1', ['shift'], '!'); check((await state()).camera.z !== 2, `${kind}/Shift1未适配`)
      await remember(`${kind}-actions-history-camera`)

      for (const code of ['Delete', 'Backspace']) {
        await load(); await selectA(); await control(kind); await key(code)
        const deleted = await until(s => !s.submitting && s.focusRecords.length === 2, `${kind}/${code}`)
        check(!deleted.focusRecords.some(r => r.id === 'shape:focus-a'), `${kind}/${code}未删除目标`)
        await remember(`${kind}-${code}`)
      }
      await load(); await selectA(); await control(kind)
      const before = await state()
      for (const code of ['Left', 'Right', 'Up', 'Down']) {
        await key(code)
        check((await state()).selectedShapes[0].x === 300 && (await state()).revision === before.revision, `${kind}/${code}误改文档`)
        // A roving toolbar may focus its second button; both remain toolbar-owned.
      }
      const clicksBefore = await evaluate('window.__focusEvents.filter(e=>e.type==="click").length')
      await key('Return', [], '\r')
      const afterEnter = await state()
      check(!afterEnter.textEditing && afterEnter.revision === before.revision, `${kind}/Enter穿透到文字`)
      check(await evaluate('window.__focusEvents.filter(e=>e.type==="click").length') === clicksBefore + 1, `${kind}/Enter未只激活一次`)
      if (kind === 'anchor') check(navigation.length > 0, '链接激活未记录被阻断的导航意图')
      if (kind === 'trigger') {
        check(await evaluate('document.activeElement.id') === 'focus-menu-item', '触发器Enter未打开菜单')
        await key('K', [], 'k'); check((await state()).toolId === 'select', '菜单内K穿透')
        await key('Escape')
        check(await evaluate('document.activeElement.id') === 'focus-control', '菜单Esc未关闭/还焦触发器')
        check(JSON.stringify((await state()).selectedIds) === JSON.stringify(before.selectedIds), '有意差异：菜单Esc不应清选择')
      }
      await control(kind)
      const clicks = await evaluate('window.__focusEvents.filter(e=>e.type==="click").length')
      await key('Space', [], ' ')
      const afterSpace = await state()
      check(afterSpace.temporaryTool === null && JSON.stringify(afterSpace.camera) === JSON.stringify(before.camera), `${kind}/Space进入画布平移`)
      if (kind === 'button' || kind === 'toolbar') check(await evaluate('window.__focusEvents.filter(e=>e.type==="click").length') === clicks + 1, `${kind}/Space未只激活一次`)
      await control(kind)
      const selection = (await state()).selectedIds
      await key('Escape')
      if (kind === 'toolbar') {
        check((await state()).selectedIds.length === 0 && await evaluate('document.activeElement.id') === 'canvas', '工具栏Esc未清选择并回焦')
      } else check(JSON.stringify((await state()).selectedIds) === JSON.stringify(selection), `${kind}/Esc不应清选择`)
      check(!await key('F24'), '未知键不应阻止默认')
      await remember(`${kind}-native-activation-and-escape`)
      await writeFile(join(output, `focus-${kind}.png`), (await wc.capturePage()).toPNG())

      await load(); await selectA(); await control(kind)
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); await flush()
      wc.sendInputEvent({ type: 'char', keyCode: ' ' }); await flush()
      for (const code of ['Left', 'Right', 'Up', 'Down']) await key(code)
      check((await state()).temporaryTool === null && (await state()).camera.x === 0 && (await state()).camera.y === 0, `${kind}/Space方向误平移`)
      await mouse('mouseDown', 1100, 650); await mouse('mouseMove', 1150, 680); await mouse('mouseUp', 1150, 680)
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Space' }); await flush()
      check((await state()).camera.x === 0 && (await state()).camera.y === 0, `${kind}/Space拖动误平移`)
      await remember(`${kind}-space-arrows-drag`)

      await load(); await selectA(); await control(kind); await focusCanvas()
      await mouse('mouseDown', 380, 250); await mouse('mouseMove', 410, 270)
      check((await state()).selectedShapes[0].x === 330, '活动Esc需要可见拖动预览')
      await control(kind)
      check((await state()).selectedShapes[0].x === 330 && (await state()).mode === 'dragging', `${kind}转焦点提前取消拖动`)
      await key('Escape')
      if (kind === 'toolbar') check((await state()).selectedShapes[0].x === 300 && await evaluate('document.activeElement.id') === 'canvas', '工具栏活动Esc未回滚和回焦')
      else check((await state()).selectedShapes[0].x === 330 && (await state()).mode === 'dragging', `${kind}活动Esc不应取消`)
      await mouse('mouseUp', 410, 270); await until(s => !s.submitting, 'drag release')
      await remember(`${kind}-active-escape`)
    }

    for (const kind of ['span', 'svg', 'anchor-empty']) {
      await load(); await control(kind); await key('K', [], 'k')
      check((await state()).toolId === 'laser', `${kind}没有找到控件祖先`)
      await remember(`nested-${kind}`)
    }
    for (const kind of ['select', 'input', 'textarea', 'editable', 'menu', 'dialog', 'listbox', 'text-owner', 'video-owner']) {
      await load(); await selectA(); await control(kind)
      const before = await state()
      check(!await key('K', [], 'k'), `${kind}没有保留K默认输入`)
      const after = await state()
      check(after.toolId === 'select' && after.revision === before.revision && JSON.stringify(after.selectedIds) === JSON.stringify(before.selectedIds), `${kind}键泄漏画布`)
      if (kind === 'select') check(await evaluate('document.activeElement.value') === 'King', 'select原生字符选项未生效')
      if (['input', 'textarea', 'editable'].includes(kind)) check((await evaluate('document.activeElement.value??document.activeElement.textContent')).includes('k'), `${kind}字符没有真实插入`)
      await remember(`protected-${kind}`)
    }
    await load(); await control('canvas-owner')
    check(await key('K', [], 'k') && (await state()).toolId === 'laser', '显式canvas按钮必须保留K契约')
    check(await key('Space', [], ' '), '显式canvas按钮仍把Space交给画布')
    await remember('explicit-canvas-control')
    await load(); await selectA(); await control('trigger', true)
    check(!await key('K', [], 'k') && (await state()).toolId === 'select', '展开触发器没有保护K')
    await remember('expanded-trigger')

    // Actual TipTap, not merely a contenteditable marker.
    await load(); await click(330, 465); await click(330, 465)
    await until(s => s.textEditing?.id === 'shape:focus-text', 'TipTap')
    await key('K', [], 'k'); await key('Space', [], ' ')
    check((await state()).textEditing?.id === 'shape:focus-text' && (await state()).toolId === 'select', '真实文字K/Space被画布抢走')
    check((await evaluate('document.activeElement.textContent')).includes('k '), 'TipTap未保留字符/空格')
    await remember('actual-tiptap-k-space')

    // Decoded local synthetic video with its real native controls active.
    await load('gallery=focus-keys&focusCase=video'); await click(700, 240); await click(700, 240)
    await until(s => s.interactingVideoId === 'shape:focus-video', 'video controls')
    await evaluate("document.querySelector('video').focus();void 0")
    check(await evaluate('document.querySelector("video").readyState>=2&&document.querySelector("video").paused'), '视频保护需要已解码且暂停的前提')
    await key('K', [], 'k'); await key('Space', [], ' ')
    check((await state()).toolId === 'select' && (await state()).temporaryTool === null, '真实视频K/Space泄漏画布')
    await until(() => evaluate('!document.querySelector("video").paused'), 'video native Space')
    check((await state()).revision === '0', '播放进度不应修改画板')
    await remember('actual-video-k-space')

    await load('count=500')
    const keyboard = await keyboardSmoke(target, output)
    await load('count=500')
    await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:1});void 0'); await flush()
    await click(40, 40)
    check((await state()).selectedIds.length === 1, '真实小地图保护须先选中可微移对象')
    const minimap = await minimapSmoke(target, output)
    check(Boolean(keyboard.form && keyboard.nativeImeEvents && keyboard.lostKeyUp && minimap), '原样键盘/小地图回归未返回断言结果')
    return { assertions, samples: samples.length, keyboard, minimap, navigation, realOsIme: 'not tested', nativeSelectPopup: 'not tested: offscreen confinement unknown' }
  } catch (error) {
    failure = error
    console.error(error)
    throw error
  } finally {
    wc.removeListener('will-navigate', preventNavigation)
    try { await writeFile(join(output, 'focus-cases.json'), JSON.stringify({ assertions, samples, navigation }, null, 2)) }
    catch (error) { if (!failure) throw error; console.error('保存焦点诊断失败，保留原断言错误：', error) }
  }
}
