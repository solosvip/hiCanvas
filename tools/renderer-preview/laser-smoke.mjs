import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Native input changes tools/documents. JS only initializes synthetic views,
// focuses test fields and reads public state/DOM. No real clipboard or canvas.
export async function laserSmoke(window, output) {
  const wc = window.webContents, origin = new URL(wc.getURL()).origin
  const samples = [], consoleErrors = [], httpErrors = [], markers = []
  let assertions = 0, scenarios = 0, held = false
  let ownDebugger = false
  const check = (condition, message) => { assertions++; if (!condition) throw new Error(message) }
  const equal = (a, b, label) => check(JSON.stringify(a) === JSON.stringify(b), `${label}: ${JSON.stringify(a)}`)
  const evaluate = code => wc.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
  const trails = s => s.overlays.filter(item => item.kind === 'laser')
  const flush = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const consoleMessage = (...args) => {
    const detail = args.find(v => v && typeof v === 'object' && 'message' in v && 'level' in v)
    const level = detail?.level ?? args[1], message = detail?.message ?? args[2]
    if (level === 3 || level === 'error') consoleErrors.push(message)
    if (message === 'HICANVAS_LASER_CONSOLE_SEAM') markers.push(message)
  }
  wc.on('console-message', consoleMessage)
  wc.session.webRequest.onCompleted(detail => { if (detail.statusCode >= 400) httpErrors.push({ url: detail.url, status: detail.statusCode }) })
  async function until(predicate, timeout = 10000) {
    const end = Date.now() + timeout
    while (Date.now() < end) { const s = await state(); if (s?.error || s?.lastError) throw new Error(s.error || s.lastError.message); if (await predicate(s)) return s; await delay(10) }
    throw new Error('等待激光笔原生结果超时。')
  }
  const mouse = async (type, x, y, modifiers = [], clickCount = 1) => {
    if (type === 'mouseDown') held = true
    wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), ...(type !== 'mouseMove' || held ? { button: 'left' } : {}), clickCount,
      modifiers: [...modifiers, ...(type === 'mouseMove' && held ? ['leftButtonDown'] : [])] })
    if (type === 'mouseUp') held = false
    await flush()
  }
  const key = async (keyCode, modifiers = []) => { for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode, modifiers }); await flush() }
  const click = async (x, y) => { await mouse('mouseDown', x, y); await mouse('mouseUp', x, y) }
  const trace = async (y = 440, release = true, count = 8, dx = 20) => {
    await mouse('mouseDown', 200, y)
    for (let i = 1; i <= count; i++) await mouse('mouseMove', 200 + i * dx, y)
    if (release) await mouse('mouseUp', 200 + count * dx, y)
  }
  async function auditPage() {
    const errors = await evaluate('window.__laserRuntimeErrors || []')
    check(!errors.length, `页面异常：${JSON.stringify(errors)}`)
    check(!consoleErrors.length && !httpErrors.length, JSON.stringify({ consoleErrors, httpErrors }))
  }
  async function load(mode = 'empty', query = '') {
    await window.loadURL(`${origin}/?gallery=laser&laserCase=${mode}&edgeScrolling=0${query}`)
    await until(s => s?.ready)
    await evaluate(`document.querySelector('#canvas').style.backgroundColor='#ffffff';document.querySelector('#canvas').focus();
      window.__laserRuntimeErrors=[];window.__laserEvents=[];window.__laserExpectedTokenErrors=[];
      window.addEventListener('error',e=>{if(window.__laserExpectTokenError&&/^(?:Uncaught )?(?:Error: )?激光绘制缺少有效颜色和宽度设计令牌。$/.test(e.message)){window.__laserExpectedTokenErrors.push(e.message);e.preventDefault()}else window.__laserRuntimeErrors.push(e.message)});
      window.addEventListener('unhandledrejection',e=>window.__laserRuntimeErrors.push(String(e.reason)));
      for(const type of ['pointerdown','pointermove','pointerup','keydown','keyup'])document.addEventListener(type,e=>window.__laserEvents.push({type:e.type,t:performance.now(),trusted:e.isTrusted,key:e.key,x:e.clientX,y:e.clientY}),true);
      console.info('HICANVAS_LASER_CONSOLE_SEAM');void 0`)
    await flush(); held = false
  }
  async function remember(label) {
    await auditPage()
    const s = await state(), events = await evaluate('window.__laserEvents')
    check(events.every(event => event.trusted), '被测动作不是原生可信事件。')
    scenarios++; samples.push({ label, state: s, events })
    return s
  }
  async function capture(label, points, crossSection = null) {
    const image = await wc.capturePage(), size = image.getSize(), bytes = image.toBitmap()
    const viewport = await evaluate('({w:innerWidth,h:innerHeight})'), sx = size.width / viewport.w, sy = size.height / viewport.h
    const pixel = (x, y) => { const k = (Math.round(y * sy) * size.width + Math.round(x * sx)) * 4; return [bytes[k + 2], bytes[k + 1], bytes[k]] }
    await writeFile(join(output, `${label}.png`), image.toPNG())
    const colors = points.map(([x, y]) => pixel(x, y))
    if (crossSection) {
      const { x, y, background, expected } = crossSection
      // Integrate native screenshot coverage against independently observed
      // center paint. This sees extra parent transforms and vector-effect bugs
      // which a computed strokeWidth * zoom assertion cannot detect.
      const channel = 1, base = background === 'white' ? 255 : 0, contrast = Math.abs(base - expected[channel]) || expected[0]
      let integral = 0
      for (let row = Math.round((y - 15) * sy); row <= Math.round((y + 15) * sy); row++) {
        const rgb = pixel(x, row / sy)
        const ink = background === 'white' ? base - rgb[channel] : rgb[0]
        integral += Math.max(0, ink) / contrast / sy
      }
      check(Math.abs(integral - 4) <= .5, `原生截图真实线宽不是4 CSS px：${JSON.stringify({ label, integral })}`)
      samples.push({ label: `${label}-pixel-width`, integralCssPx: integral })
    }
    return colors
  }
  try {
    ownDebugger = !wc.debugger.isAttached()
    if (ownDebugger) wc.debugger.attach('1.3')
    await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await load(); const before = await state()
    await key('K'); check((await state()).toolId === 'laser', 'K没有进入激光。')
    await key('K'); check((await state()).toolId === 'laser', '重复K退出了激光。')
    await key('Escape'); check((await state()).toolId === 'laser', '闲置Esc退出了激光。')
    await mouse('mouseMove', 200, 440); check(trails(await state()).length === 0, '没有按下也画出轨迹。')
    await remember('entry-repeat-idle-escape-move')
    await click(200, 440); check(trails(await state())[0]?.points.length === 1, '单击没有留下一个点。')
    const dot = await capture('single-dot', [[200, 440]])
    check(dot[0][0] > dot[0][1] + 100, '单点没有真实红色像素。')
    await until(s => trails(s).length === 0 && !s.needsFrame)
    const after = await remember('click-expired')
    equal(after.laserRecords, before.laserRecords, '激光改变文档')
    equal(after.laserDocument, before.laserDocument, '激光改变完整文档记录')
    equal(after.revision, before.revision, '激光改变版本'); check(after.commitCalls === 0, '激光触发保存。')

    await load(); await key('K'); await trace(440, false)
    const heldBefore = trails(await state())[0]
    await delay(8100)
    equal(trails(await state())[0], heldBefore, '按住停住超过8秒时旧点被清掉。')
    await remember('held-over-eight-seconds')
    await mouse('mouseUp', 360, 440); await delay(900)
    equal(trails(await state())[0].points, heldBefore.points, '松手完整等待不足1200ms。')
    await until(s => trails(s).length === 0 && !s.needsFrame)
    await remember('released-geometry-expired')

    await load(); await key('K'); await trace(440, false); await key('V')
    check((await state()).toolId === 'select' && trails(await state()).length === 1, 'V没有结束活动段并保留轨迹。')
    await mouse('mouseUp', 360, 440); await remember('switch-preserves-tail')
    await until(s => trails(s).length === 0 && !s.needsFrame); await remember('tail-animates-after-tool-exit')

    await load(); await key('K'); await trace(300); await trace(400); await trace(500)
    const multiple = await state(), ids = trails(multiple).map(item => item.id)
    check(ids.length === 3 && new Set(ids).size === 3, '多段没有以不同ID共存。')
    await remember('three-separate-strokes')
    await until(s => trails(s).length === 2)
    equal(trails(await state()).map(item => item.id), ids.slice(1), '没有先清除最早的段。')
    await until(s => trails(s).length === 0); await remember('multiple-oldest-first')

    await load(); await key('K'); await trace(440); await trace(560, false, 2, 80)
    check(trails(await state()).length === 2, 'O1缺少旧段与活动段。')
    await key('Escape'); check(trails(await state()).length === 0 && (await state()).toolId === 'laser', 'O1活动Esc没有清掉全部轨迹。')
    await mouse('mouseUp', 360, 560); await remember('O1-active-escape-clears-all')

    await load(); await key('K'); await trace(440, true, 64, 2.5)
    const shrinking = await until(s => trails(s)[0]?.points.length < 65 && trails(s)[0]?.points.length > 16), oldId = trails(shrinking)[0].id
    await trace(560, false, 1, 160)
    await delay(600)
    const newHeld = await state()
    check(trails(newHeld).length === 1 && trails(newHeld)[0].id !== oldId && trails(newHeld)[0].points.length === 2, 'O2收短旧段被重画暂停或新段消失。')
    await remember('O2-shrinking-old-continues-while-new-held')
    await mouse('mouseUp', 360, 560); await delay(900)
    check(trails(await state())[0]?.points.length === 2, 'O2新段没有完整等待。')
    await until(s => trails(s).length === 0); await remember('O2-new-release-has-own-wait')

    // Two independent legacy captures for each background; expectations are
    // literal composite RGB, never inferred from the implementation's alpha.
    for (const background of ['white', 'black']) for (const z of [.5, 1, 2]) {
      await load(); await evaluate(`document.querySelector('#canvas').style.backgroundColor=${JSON.stringify(background)};window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:${z}});void 0`)
      await key('K'); await trace(440, false)
      const expected = background === 'white' ? [255, 77, 77] : [178, 0, 0]
      const [center, adjacent] = await capture(`${background}-zoom-${z}`, [[280, 440], [420, 440]], { x: 280, y: 440, background, expected })
      equal(adjacent, background === 'white' ? [255, 255, 255] : [0, 0, 0], '颜色对照背景不符')
      check(center.every((v, i) => Math.abs(v - expected[i]) <= 3), `激光合成色不符：${JSON.stringify({ center, expected, z })}`)
      const width = await evaluate("parseFloat(getComputedStyle(document.querySelector('[data-overlay-kind=laser] path')).strokeWidth)")
      check(Math.abs(width * z - 4) < .001, '缩放改变屏幕线宽。')
      const s = await remember(`${background}-width-${z}`)
      equal(trails(s)[0].points[0], { x: 200 / z, y: 440 / z }, '输入点没有转换成世界坐标')
      await mouse('mouseUp', 360, 440)
    }

    for (const active of [false, true]) for (const zooming of [false, true]) {
      await load(); await key('K'); await trace(440, !active)
      const beforeView = await state(), first = trails(beforeView)[0].points[0]
      wc.sendInputEvent({ type: 'mouseWheel', x: 360, y: 440, deltaX: zooming ? 0 : 100, deltaY: zooming ? 100 : 0, modifiers: zooming ? ['control'] : [], canScroll: true })
      const moved = await until(s => s.camera.x !== beforeView.camera.x || s.camera.z !== beforeView.camera.z)
      const box = await evaluate("(()=>{const b=document.querySelector('[data-overlay-kind=laser] path').getBoundingClientRect();return{x:b.x,y:b.y}})()")
      check(Math.abs(box.x - (first.x + moved.camera.x) * moved.camera.z) <= 3, '视角改变后稳定轨迹没有锚在世界。')
      await remember(`world-${active ? 'held' : 'released'}-${zooming ? 'zoom' : 'pan'}`)
      if (active) await mouse('mouseUp', 360, 440)
    }

    for (const redo of [false, true]) {
      await load(); await key('D'); await mouse('mouseDown', 100, 220); await mouse('mouseMove', 300, 220); await mouse('mouseUp', 300, 220)
      await until(s => !s.submitting && s.laserRecords.length === 1)
      if (redo) { await key('Z', ['meta']); await until(s => !s.submitting && s.laserRecords.length === 0) }
      await key('K'); await trace()
      await key('Z', redo ? ['meta', 'shift'] : ['meta'])
      await until(s => !s.submitting && s.laserRecords.length === Number(redo))
      await remember(redo ? 'laser-preserves-redo' : 'undo-skips-laser')
    }

    for (const tag of ['input', 'textarea', 'editable']) {
      await load(); await evaluate(`(()=>{const el=document.createElement(${JSON.stringify(tag === 'editable' ? 'div' : tag)});el.id='laser-input';${tag === 'editable' ? "el.contentEditable='true';" : ''}document.body.append(el);el.focus()})()`)
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'K' }); wc.sendInputEvent({ type: 'char', keyCode: 'k' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'K' }); await flush()
      const s = await state(), actual = await evaluate("document.activeElement.value??document.activeElement.textContent")
      check(s.toolId === 'select', `K输入归属错误：${tag}`)
      check(actual.includes('k'), '只发按键但没有实际输入k。')
      await remember(`keyboard-${tag}`)
    }
    // #209 owns the temporary bare-button mismatch with legacy L50. This
    // case guards only the existing, explicit canvas-owned control contract.
    await load(); await evaluate("(()=>{const button=document.createElement('button');button.dataset.canvasInputOwner='canvas';button.textContent='Canvas control';document.body.append(button);button.focus()})()")
    await key('K'); check((await state()).toolId === 'laser', '显式画布归属按钮没有把K交给激光笔。')
    await remember('keyboard-explicit-canvas-button')
    await load('scene'); await click(130, 215); await click(130, 215)
    await until(s => Boolean(s.textEditing)); wc.sendInputEvent({ type: 'keyDown', keyCode: 'K' }); wc.sendInputEvent({ type: 'char', keyCode: 'k' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'K' }); await flush()
    check((await state()).toolId !== 'laser' && (await evaluate('document.activeElement.textContent')).includes('k'), '激光抢走真实画布文字编辑输入。')
    await remember('actual-text-editor-keeps-k')
    for (const query of ['&shortcuts=0', '&limited=1']) {
      await load('empty', query); await key('K'); check((await state()).toolId === 'select', '关闭快捷键或未开放工具时仍切入激光。')
      await remember(`keyboard-gate${query}`)
    }
    // Exercise the public mount/setOverlays seam in Chromium, including the
    // actual SVG ref. SSR does not execute that ref. These are renderer-only
    // synthetic Stores, with one exact, counted expected ErrorEvent per bad
    // token case; every other page/console error still fails the run.
    await load()
    const tokenProbes = await evaluate(`(${async function () {
      const [{ createCanvasStore }, { mountCanvasRenderer }] = await Promise.all([import('/model/index.js'), import('/renderer/index.js')])
      const flush = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))), results = []
      for (const [color, width, valid] of [['initial', 'initial', false], ['#ff0000', '4px', false], ['#ff0000b3', 'bad', false], ['#ff0000b3', '0px', false], ['#ff0000b3', '4px', true]]) {
        const element = document.createElement('div'), store = createCanvasStore()
        element.style.cssText = 'position:fixed;left:10px;top:10px;width:80px;height:80px'
        element.style.setProperty('--color-overlay-laser-stroke', color); element.style.setProperty('--spacing-overlay-laser-stroke', width)
        store.ensureStoreIsUsable(); const before = JSON.stringify(store.getStoreSnapshot())
        let active = 0, view
        const add = store.addHistoryInterceptor.bind(store)
        store.addHistoryInterceptor = fn => { const stop = add(fn); active++; let live = true; return () => { if (live) { live = false; active--; stop() } } }
        document.body.append(element)
        const start = window.__laserExpectedTokenErrors.length
        try {
          view = mountCanvasRenderer(element, { store })
          const observers = active
          view.setOverlays([{ kind: 'laser', id: 'laser:probe', points: [] }])
          await flush()
          const emptyErrors = window.__laserExpectedTokenErrors.length - start
          window.__laserExpectTokenError = !valid
          view.setOverlays([{ kind: 'laser', id: 'laser:probe', points: [{ x: 20, y: 20 }] }])
          await flush()
          results.push({ color, width, valid, observers, afterObservers: active, emptyErrors, paintErrors: window.__laserExpectedTokenErrors.length - start,
            painted: Boolean(element.querySelector('[data-overlay-kind=laser] path')), documentUnchanged: JSON.stringify(store.getStoreSnapshot()) === before })
        } finally {
          window.__laserExpectTokenError = false
          try { view?.unmount() } finally { element.remove(); store.dispose?.() }
        }
        results.at(-1).observersAfterUnmount = active
      }
      return results
    }.toString()})()`)
    for (const probe of tokenProbes) {
      check(probe.emptyErrors === 0 && probe.paintErrors === Number(!probe.valid), `令牌延迟校验没有经过真实绘制：${JSON.stringify(probe)}`)
      check(probe.painted === probe.valid && probe.documentUnchanged, '令牌探针绘制/文档不变守卫失败。')
      check(probe.observers === 2 && probe.afterObservers === 2 && probe.observersAfterUnmount === 0, '激光新增了Store订阅或卸载未清理。')
    }
    samples.push({ label: 'first-paint-token-guards', tokenProbes }); await remember('lazy-token-validation-and-unmount')
    check(markers.length > 0, '控制台采集缺少正向标记。')
    await writeFile(join(output, 'laser-samples.json'), JSON.stringify(samples, null, 2))
    return { assertions, scenarios, compositeTolerance: 3, consoleErrors, httpErrors, consoleMarkers: markers.length, controlledNativeInput: true, realOsIme: 'not tested' }
  } catch (error) {
    await writeFile(join(output, 'laser-failure.json'), JSON.stringify({ error: error.stack, state: await state(), samples, consoleErrors, httpErrors }, null, 2))
    throw error
  } finally { wc.off('console-message', consoleMessage); wc.session.webRequest.onCompleted(null); if (ownDebugger && wc.debugger.isAttached()) wc.debugger.detach() }
}
