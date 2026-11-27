import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { rasterFiles } from './image-fixtures.js'

export async function imageSmoke(window, output) {
  const contents = window.webContents
  const evaluate = code => contents.executeJavaScript(code)
  const check = (value, message) => { if (!value) throw new Error(message) }
  const until = async predicate => {
    for (let i = 0; i < 150; i++) { const value = await predicate(); if (value) return value; await delay(20) }
    await writeFile(join(output, 'image-failure.png'), (await contents.capturePage()).toPNG())
    throw new Error(`图片逐帧验证等待超时：${JSON.stringify(await state())}`)
  }
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const frame = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  // Electron requires a native single-click count for DOM button activation.
  // Always send 1, including the second click; no host-derived double count
  // reaches the editor's input adapter.
  const pointer = async (type, x, y) => { contents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, ...(type === 'mouseMove' && { modifiers: ['leftButtonDown'] }) }); await frame() }
  const click = async (x, y) => { await pointer('mouseMove', x, y); await pointer('mouseDown', x, y); await pointer('mouseUp', x, y) }
  const key = async keyCode => { for (const type of ['keyDown', 'keyUp']) contents.sendInputEvent({ type, keyCode }); await frame() }
  const control = async name => {
    const b = await evaluate(`(()=>{const b=document.querySelector('[data-image-action="${name}"]').getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`)
    await click(b.x, b.y)
  }
  await delay(100)
  const capture = await contents.capturePage(), pixels = capture.toBitmap(), { width } = capture.getSize(), ratio = width / 1280
  const color = (x, y) => { const offset = (Math.round(y * ratio) * width + Math.round(x * ratio)) * 4; return [pixels[offset + 2], pixels[offset + 1], pixels[offset]] }
  const same = (actual, expected, message) => { if (actual.some((c, i) => Math.abs(c - expected[i]) > 1)) throw new Error(`${message}: ${actual}, expected ${expected}`) }
  await writeFile(join(output, 'image-pixels.png'), capture.toPNG())
  same(color(120, 140), [255, 0, 0], '原图左上')
  same(color(420, 140), [0, 255, 0], 'C14 水平镜像左上必须为绿色')
  same(color(720, 140), [0, 0, 255], 'C15 垂直镜像左上必须为蓝色')
  same(color(200, 400), [0, 255, 0], 'F13 裁剪必须按原图范围取景')
  same(color(401, 381), [247, 245, 239], 'F15 圆形裁剪角落必须透明')
  same(color(440, 400), [247, 245, 239], '非正方形圆形裁剪也应为椭圆，不能变成胶囊')
  // The old drawing was exactly a plain <img width height>. Compare every
  // original-image pixel with that independent baseline on every smoke run.
  const original = (await contents.capturePage({ x:100, y:120, width:240, height:180 })).toBitmap()
  await evaluate(`(async()=>{const host=document.createElement('div');host.id='image-baseline';Object.assign(host.style,{position:'fixed',left:'100px',top:'120px'});const img=document.createElement('img');img.src=document.querySelector('[data-shape-id="shape:image-0"] img').src;img.width=240;img.height=180;host.append(img);document.body.append(host);await img.decode()})()`)
  await frame()
  const baseline = (await contents.capturePage({ x:100, y:120, width:240, height:180 })).toBitmap()
  check(original.equals(baseline), '未镜像/裁剪图片与旧 img 绘制有像素差异')
  await evaluate("document.querySelector('#image-baseline').remove()")
  const animationColor = async () => {
    const bytes = (await contents.capturePage({x:720,y:400,width:1,height:1})).toBitmap()
    return [bytes[2], bytes[1], bytes[0]].join(',')
  }
  const moving = new Set()
  for (let i = 0; i < 7; i++) { moving.add(await animationColor()); await delay(83) }
  check(moving.has('255,0,0') && moving.has('0,255,0'), `动图未真实播放：${[...moving]}`)
  await control('reduce-motion')
  await until(() => evaluate('Boolean(document.querySelector(\'[data-shape-id="shape:image-5"] [data-image-static="ready"]\'))'))
  for (let i=0;i<4;i++) { check(await animationColor() === '255,0,0', '减少动画后未保持静态首帧'); await delay(113) }
  await control('reduce-motion')
  const playing = await evaluate("import('/tools/renderer-preview/image-probe.js').then(m=>m.runImagePlayingProbe())")
  await click(220,210); await delay(425); await click(220,210)
  check(!(await state()).croppingId,'超时的两次原生点击被误识别成双击')
  await click(220,210)
  check((await state()).croppingId === 'shape:image-0','真实两次按下松开未进入裁剪')
  await control('finish'); await control('crop')
  check((await state()).croppingId === 'shape:image-0', '裁剪按钮未进入编辑层状态')
  check(await evaluate('document.querySelectorAll("[data-crop-handle]").length') === 4, '未画出四条边柄')
  const revision = (await state()).revision, snapshotReads = (await state()).snapshotReads
  await pointer('mouseMove',340,210); await pointer('mouseDown',340,210)
  await pointer('mouseMove',320,210); check((await state()).selectedShapes[0].w === 220, '右边柄第一帧不跟手')
  await pointer('mouseMove',280,210); check((await state()).selectedShapes[0].w === 180 && (await state()).revision === revision, '裁剪预览未跟手或提前提交')
  await key('Escape'); await pointer('mouseUp',280,210)
  check((await state()).selectedShapes[0].w === 240 && (await state()).revision === revision, 'Esc没有恢复裁剪')
  await pointer('mouseMove',340,210); await pointer('mouseDown',340,210); await pointer('mouseMove',280,210); await pointer('mouseUp',280,210)
  await until(async () => (await state()).revision !== revision && !(await state()).submitting)
  check(Number((await state()).revision) === Number(revision) + 1, '裁剪没有恰好提交一次')
  check((await state()).snapshotReads === snapshotReads, '裁剪帧取了完整快照')
  await writeFile(join(output, 'image-crop-handles.png'), (await contents.capturePage()).toPNG())
  await click(280,210); await click(280,210)
  await until(async () => (await state()).selectedShapes[0].w > 239)
  await control('aspect-square')
  await until(async () => (await state()).selectedShapes[0].w === 180)
  const beforeZoom = Number((await state()).revision)
  const range = await evaluate('(()=>{const b=document.querySelector("[data-image-action=zoom]").getBoundingClientRect();return{x:Math.round(b.x+8),y:Math.round(b.y+b.height/2),end:Math.round(b.right-8)}})()')
  await pointer('mouseMove',range.x,range.y); await pointer('mouseDown',range.x,range.y); await pointer('mouseMove',range.end,range.y); await pointer('mouseUp',range.end,range.y)
  await until(async () => !(await state()).submitting && Number((await state()).revision) > beforeZoom)
  check(Number((await state()).revision) === beforeZoom + 1, '滑块拖动不是一次事务')
  await key('Return'); check(!(await state()).croppingId, 'Enter没有退出裁剪')
  // Intercept only this synthetic chooser. The click is native; Chromium's
  // chooser protocol supplies a local fixture without opening a foreground OS dialog.
  const replacement = join(output, 'replacement.png')
  await writeFile(replacement, Buffer.from(rasterFiles.wide.base64, 'base64'))
  contents.debugger.attach('1.3')
  try {
    await contents.debugger.sendCommand('Page.enable')
    await contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled:true })
    const chosen = new Promise((resolve,reject) => {
      const listener = async (_event,method,params) => {
        if (method !== 'Page.fileChooserOpened') return
        contents.debugger.removeListener('message',listener)
        try { await contents.debugger.sendCommand('DOM.setFileInputFiles',{files:[replacement],backendNodeId:params.backendNodeId}); resolve() } catch(error) { reject(error) }
      }
      contents.debugger.on('message',listener)
    })
    const before = (await state()).selectedShapes[0]
    await control('replace'); await Promise.race([chosen,delay(3000).then(()=>{throw new Error('图片替换未打开文件选择器')})])
    await until(async()=>!(await state()).submitting && (await state()).selectedShapes[0].assetId !== before.assetId)
    const after = (await state()).selectedShapes[0]
    check(after.id === before.id && after.x === before.x && after.y === before.y && after.w === before.w && after.h === before.h,'替换改变了形状身份或画框')
    await writeFile(join(output,'image-replaced.png'),(await contents.capturePage()).toPNG())
  } finally { contents.debugger.detach() }
  window.setContentSize(390,800)
  await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:180,z:.3});void 0'); await frame()
  check(await evaluate('(()=>{const b=document.querySelector("#image-tools").getBoundingClientRect();return b.x>=0&&b.right<=innerWidth})()'), '窄屏裁剪浮层越界')
  await control('crop'); await frame()
  check(await evaluate('(()=>{const a=document.querySelector("#image-tools").getBoundingClientRect(),b=document.querySelector("#navigation").getBoundingClientRect();return a.bottom<=b.top})()'), '窄屏裁剪浮层覆盖导航')
  await writeFile(join(output, 'image-narrow.png'), (await contents.capturePage()).toPNG())
  check(!(await state()).lastError, '图片交互留下错误')
  return { mirrorX: true, mirrorY: true, crop: true, circle: true, unchangedPixels: true, nativeCropEscapeResetAspectZoom: true, nativeDoubleAndTimeout:true, fileReplacement: true, moving: [...moving], playing }
}

export async function prepareImageProbe(window) {
  const wc = window.webContents
  await window.loadURL('data:text/html,<title>isolated image probe</title>')
  wc.on('before-input-event', (event, input) => { if ((input.meta || input.control) && ['c', 'x', 'v'].includes(input.key.toLowerCase())) event.preventDefault() })
  const debug = wc.debugger
  debug.attach('1.3')
  await debug.sendCommand('Page.enable')
  await debug.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })
  await debug.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  await debug.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    window.__imageClipboardViolations = []; window.__imageUncaught = []; window.__imageCommits = 0;
    const realFetch = window.fetch; window.fetch = (url,...args) => { if (new URL(url,location.href).pathname === '/__interaction/commit') window.__imageCommits++; return realFetch(url,...args) };
    const denied = () => { window.__imageClipboardViolations.push('system clipboard'); throw new Error('System clipboard blocked by image probe') };
    Object.defineProperty(navigator, 'clipboard', { value: Object.freeze({ read: denied, readText: denied, write: denied, writeText: denied }) });
    const exec = document.execCommand.bind(document); document.execCommand = (name,...args) => ['copy','cut','paste'].includes(name.toLowerCase()) ? denied() : exec(name,...args);
    addEventListener('error', e => window.__imageUncaught.push(e.message));
    addEventListener('unhandledrejection', e => window.__imageUncaught.push(String(e.reason)));
  })()` })
}

export async function imageImportSmoke(window, output, files) {
  const wc = window.webContents, debug = wc.debugger, evaluate = code => wc.executeJavaScript(code)
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const commits = () => evaluate('window.__imageCommits')
  const check = (value, message) => { if (!value) throw new Error(message) }
  const until = async (predicate, label, allowSubmitting = false) => { const end = Date.now() + 15000; while (Date.now() < end) { const value = await predicate(); if (value && (allowSubmitting || !(await state()).submitting)) return value; await delay(30) } throw new Error(`图片原生检查超时：${label}`) }
  const shapes = value => value.imageRecords.filter(r => r.typeName === 'shape')
  const click = async (x, y) => { wc.sendInputEvent({ type: 'mouseMove', x, y }); for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 }); await delay(80) }
  const key = async (keyCode, modifiers = []) => { for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode, modifiers }); await delay(60) }
  const control = async id => {
    const box = await evaluate(`(() => {const n=document.querySelector('[data-image-action="${id}"]'),b=n.getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2),disabled:n.disabled}})()`)
    check(!box.disabled, `图片控件不可用：${id}`); await click(box.x, box.y)
  }
  const stages = [], record = async label => { const value = await state(); stages.push({ label, state: value }); await writeFile(join(output, 'image-native.json'), JSON.stringify(stages, null, 2)); return value }
  const chooser = async (paths, replace = false) => {
    let listener, timer
    const chosen = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('图片文件选择器未打开。')), 5000)
      listener = (_event, method, params) => { if (method === 'Page.fileChooserOpened') void debug.sendCommand('DOM.setFileInputFiles', { files: paths, backendNodeId: params.backendNodeId }).then(resolve, reject) }
      debug.on('message', listener)
    })
    try { await control(replace ? 'replace' : 'import'); await chosen }
    finally { clearTimeout(timer); debug.removeListener('message', listener) }
  }
  const drop = async (paths, x = 550, y = 420) => {
    for (const type of ['dragEnter', 'dragOver', 'drop']) await debug.sendCommand('Input.dispatchDragEvent', { type, x, y, data: { items: [], files: paths, dragOperationsMask: 1 } })
  }
  // ClipboardEvent/DataTransfer are private synthetic inputs, never OS paste.
  // They enter exactly the shared public host adapter, with hostile HTML too.
  const pasteFiles = async (paths, selector = '#canvas') => {
    const entries = await Promise.all(paths.map(async path => ({ bytes: (await readFile(path)).toString('base64'), mime: path.endsWith('.webm') ? 'video/webm' : 'image/png', name: path.endsWith('.webm') ? 'synthetic.webm' : 'synthetic.png' })))
    return evaluate(`(() => {const dt=new DataTransfer();for(const file of ${JSON.stringify(entries)})dt.items.add(new File([Uint8Array.from(atob(file.bytes),c=>c.charCodeAt(0))],file.name,{type:file.mime}));dt.setData('text/html','<p>不得创建这段HTML</p>');const host=document.querySelector(${JSON.stringify(selector)});host.focus();const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt});host.dispatchEvent(event);return event.defaultPrevented})()`)
  }
  const resetCamera = async () => { await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:1});void 0'); await delay(60) }
  const assertPixels = async id => {
    await until(() => evaluate(`(() => {const n=document.querySelector('[data-shape-id="${id}"] img');return n?.complete && n.naturalWidth>0})()`), '真实图片解码')
    const b = await evaluate(`(() => {const b=document.querySelector('[data-shape-id="${id}"] img').getBoundingClientRect();return {x:Math.ceil(b.x),y:Math.ceil(b.y),width:Math.min(16,Math.floor(b.width)),height:Math.min(16,Math.floor(b.height))}})()`)
    check(b.width > 0 && b.height > 0, '图片没有可见像素')
    // A decoded <img> can still be one frame away from the compositor; capture
    // until the colour shows (bounded by until's timeout) so only an image that
    // never paints fails, instead of a busy machine capturing the frame before.
    const count = async () => {
      const bitmap = (await wc.capturePage(b)).toBitmap()
      let colored = 0
      for (let i = 0; i < bitmap.length; i += 4) if (Math.max(bitmap[i], bitmap[i + 1], bitmap[i + 2]) - Math.min(bitmap[i], bitmap[i + 1], bitmap[i + 2]) > 60) colored++
      return colored
    }
    try { return await until(count, '图片像素') } catch { throw new Error('图片只显示空白或灰色占位') }
  }
  const subject = 'shape:image-0'
  await record('initial')
  await click(210, 210)
  check((await state()).selectedIds.includes(subject), '没有真实选中图片')
  await control('edit-alt'); await wc.insertText('图片：<文字> & 描述')
  await writeFile(join(output, 'image-alt-edit.png'), (await wc.capturePage()).toPNG())
  // Hold the HTTP save at its I/O boundary: no race against an assumed delay.
  await evaluate(`(() => {const real=fetch;window.__imageSaveFetch=real;window.__imageSaveWaiting=false;window.fetch=async(url,...args)=>{if(new URL(url,location.href).pathname==='/__interaction/commit'){window.__imageSaveWaiting=true;await new Promise(resolve=>window.__imageSaveRelease=resolve)}return real(url,...args)}})();void 0`)
  try {
    await key('Return')
    await until(() => evaluate('window.__imageSaveWaiting'), '受控保存已暂停', true)
    await drop([files.png])
    await until(() => evaluate("document.querySelector('#status').textContent.includes('请先结束当前操作')"), '保存中导入错误可见', true)
    await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:1,y:0,z:1});void 0'); await delay(60)
    check((await state()).submitting && (await state()).camera.x === 1, '没有在受控保存期间触发实际刷新')
    check(await evaluate("document.querySelector('#status').textContent.includes('请先结束当前操作')"), '保存期间刷新吞掉新文件错误')
  } finally { await evaluate('window.fetch=window.__imageSaveFetch;window.__imageSaveRelease?.();delete window.__imageSaveFetch;void 0') }
  await until(async () => (await state()).imageRecords.find(r => r.id === subject).props.altText === '图片：<文字> & 描述', 'Enter保存描述')
  await resetCamera()
  check(await evaluate(`document.querySelector('[data-shape-id="${subject}"] img').alt === '图片：<文字> & 描述'`), '图片无障碍描述没有更新')
  let revision = (await state()).revision
  await control('edit-alt'); await wc.insertText('取消这段'); await key('Escape')
  check((await state()).revision === revision && (await state()).imageRecords.find(r => r.id === subject).props.altText === '图片：<文字> & 描述', 'Escape写入了描述或历史')
  window.setContentSize(390, 800); await delay(80); await control('edit-alt')
  check(await evaluate(`(() => {const a=document.querySelector('[data-image-action="alt-text"]').getBoundingClientRect(),b=document.querySelector('#image-tools').getBoundingClientRect(),n=document.querySelector('#navigation').getBoundingClientRect();return a.width>0&&a.x>=0&&a.right<=innerWidth&&b.x>=0&&b.right<=innerWidth&&b.bottom<=n.top})()`), '窄屏描述输入越界或遮挡导航')
  await writeFile(join(output, 'image-alt-narrow.png'), (await wc.capturePage()).toPNG()); await key('Escape')
  window.setContentSize(1280, 800); await delay(80)
  await control('edit-alt'); await wc.insertText('点外面保存'); await click(1100, 100)
  await until(async () => (await state()).imageRecords.find(r => r.id === subject).props.altText === '点外面保存', '外点保存描述')
  await click(210, 210)
  const before = (await state()).imageRecords.find(r => r.id === subject)
  await chooser([files.portrait], true)
  await until(async () => (await state()).imageRecords.find(r => r.id === subject).props.assetId !== before.props.assetId, '真实选择器替换')
  const replaced = (await state()).imageRecords.find(r => r.id === subject)
  check([replaced.id, replaced.x, replaced.y, replaced.props.w, replaced.props.h, replaced.props.flipX, replaced.props.flipY, replaced.props.altText].join('|') === [before.id, before.x, before.y, before.props.w, before.props.h, before.props.flipX, before.props.flipY, before.props.altText].join('|'), '替换改变了身份、位置、外框、镜像或描述')
  check(Math.abs(replaced.props.crop.topLeft.y - .3125) < 1e-9 && replaced.props.crop.topLeft.x === 0, '替换没有按新图重新居中')
  await record('replaced-and-alt')
  const mod = process.platform === 'darwin' ? 'meta' : 'control'
  await key('z', [mod]); await until(async () => (await state()).imageRecords.find(r => r.id === subject).props.assetId === before.props.assetId, '替换撤销')
  await key('z', [mod, 'shift']); await until(async () => (await state()).imageRecords.find(r => r.id === subject).props.assetId === replaced.props.assetId, '替换重做')
  let ids = new Set(shapes(await state()).map(r => r.id))
  await chooser([files.png])
  await until(async () => shapes(await state()).length === ids.size + 1, '媒体选择器导入PNG')
  const chosen = shapes(await state()).find(r => !ids.has(r.id))
  check(chosen.x === 480 && chosen.y === 310 && chosen.props.w === 320 && chosen.props.h === 180, '选择文件没有自然尺寸或视口居中')
  const pixels = { png: await assertPixels(chosen.id) }
  for (const type of ['jpeg', 'webp', 'gif', 'apng', 'avif']) {
    ids = new Set(shapes(await state()).map(r => r.id)); await drop([files[type]], 850, 220)
    await until(async () => shapes(await state()).length === ids.size + 1, `原生文件拖入${type}`)
    const value = await state(), shape = shapes(value).find(r => !ids.has(r.id)), asset = value.imageRecords.find(r => r.id === shape.props.assetId)
    check(asset.props.mimeType === `image/${type}` && asset.props.src.startsWith('/c/'), '图片类型或本机资源路径不符')
    check(shape.props.w === (type === 'gif' ? 2 : 320) && shape.props.h === (type === 'gif' ? 2 : 180), '导入没有保留自然尺寸')
    check(asset.props.isAnimated === ['gif', 'apng'].includes(type), '动画标志丢失或把静态图误标动画')
    pixels[type] = await assertPixels(shape.id)
  }
  await record('six-formats')
  const formCount = shapes(await state()).length, formRevision = (await state()).revision
  await control('edit-alt')
  check(await pasteFiles([files.png], '[data-image-action="alt-text"]') === false, '文件粘贴拦住了表单')
  await key('Escape'); check(shapes(await state()).length === formCount && (await state()).revision === formRevision, '表单粘贴修改画板')
  await evaluate(`document.querySelector('#canvas').focus();document.querySelector('#canvas').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));void 0`)
  check(await pasteFiles([files.png]) === false, '组字期间拦截文件粘贴')
  await evaluate(`document.querySelector('#canvas').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));void 0`)
  check(shapes(await state()).length === formCount, '组字期间导入了文件')
  ids = new Set(shapes(await state()).map(r => r.id)); revision = (await state()).revision
  let beforeCommits = await commits()
  check(await pasteFiles([files.png]) === true, '文件粘贴没有走共享适配器')
  await until(async () => shapes(await state()).length === ids.size + 1, '私有文件剪贴板PNG')
  const pasted = shapes(await state()).filter(r => !ids.has(r.id))
  const pastedState = await record('pasted-png')
  check(pasted.length === 1 && pasted[0].type === 'image' && pasted[0].x === 480 && pasted[0].y === 310 && pastedState.revision !== revision && await commits() === beforeCommits + 1, `文件+HTML重复粘贴或没有按中心落点：${JSON.stringify({ pasted, beforeRevision: revision, revision: pastedState.revision, camera: pastedState.camera })}`)
  ids = new Set(shapes(await state()).map(r => r.id)); revision = (await state()).revision; beforeCommits = await commits()
  check(await pasteFiles([files.png, files.webm]) === true, '混合媒体文件粘贴未接收')
  await until(async () => shapes(await state()).length === ids.size + 2, '图片和WebM共用粘贴入口')
  const mixed = shapes(await state()).filter(r => !ids.has(r.id)).sort((a, b) => a.x - b.x)
  check(mixed.map(r => r.type).join(',') === 'image,video' && (await state()).revision !== revision && await commits() === beforeCommits + 1, '混合文件被拆成多次事务或混入HTML')
  await until(() => evaluate(`(() => {const v=document.querySelector('[data-shape-id="${mixed[1].id}"] video');return v?.readyState>=2&&v.paused})()`), '粘贴的WebM真实解码且默认暂停')
  await key('z', [mod]); await until(async () => shapes(await state()).length === ids.size, '混合粘贴一次撤销')
  await key('z', [mod, 'shift']); await until(async () => shapes(await state()).length === ids.size + 2, '混合粘贴一次重做')
  await record('private-file-paste')
  await resetCamera(); ids = new Set(shapes(await state()).map(r => r.id)); revision = (await state()).revision; beforeCommits = await commits()
  await drop([files.png, files.portrait])
  await until(async () => shapes(await state()).length === ids.size + 2, '两文件批量导入')
  const batch = shapes(await state()).filter(r => !ids.has(r.id)).sort((a, b) => b.props.w - a.props.w)
  check(JSON.stringify(batch.map(r => [r.x, r.y, r.props.w, r.props.h])) === JSON.stringify([[310, 260, 320, 180], [630, 260, 160, 320]]), '批量间距/顶部/居中读数不符')
  check((await state()).revision !== revision && await commits() === beforeCommits + 1, '批量不是一次事务')
  await key('z', [mod]); await until(async () => shapes(await state()).length === ids.size, '整批一次撤销')
  await key('z', [mod, 'shift']); await until(async () => shapes(await state()).length === ids.size + 2, '整批一次重做')
  ids = new Set(shapes(await state()).map(r => r.id)); await drop([files.wide])
  await until(async () => shapes(await state()).length === ids.size + 1 && (await state()).camera.z === .28125, '4096宽图视角适配')
  check(shapes(await state()).find(r => !ids.has(r.id)).props.w === 4096, '大图被缩成512宽')
  await resetCamera(); const count = shapes(await state()).length
  await chooser([files.svg]); await until(async () => shapes(await state()).length === count + 1, 'SVG选择器净化后导入')
  await drop([files['svg-bad-xml']]); await until(() => evaluate("document.querySelector('#status').textContent.includes('SVG')"), '坏SVG明确失败反馈')
  check(shapes(await state()).length === count + 1, '坏SVG留下了形状')
  await drop([files.png, files.text]); await until(async () => shapes(await state()).length === count + 2, '有效文件与TXT混合过滤')
  await until(() => evaluate("document.querySelector('#status').textContent.includes('已过滤')"), '混合格式提示被成功状态吞掉')
  const failedCount = shapes(await state()).length
  await drop([files.png, files.bad]); await until(() => evaluate("document.querySelector('#status').textContent.includes('损坏')"), '损坏文件提示')
  check(shapes(await state()).length === failedCount, '损坏的第二项留下半批图片')
  await evaluate(`window.__imageRealFetch=fetch;window.__imageUploads=0;window.fetch=(url,options)=>new URL(url,location.href).pathname==='/api/canvas/reference'&&++window.__imageUploads===2?Promise.resolve(Response.json({error:'合成上传失败'},{status:503})):window.__imageRealFetch(url,options);void 0`)
  try {
    await drop([files.png, files.portrait]); await until(() => evaluate("window.__imageUploads===2 && document.querySelector('#status').textContent.includes('合成上传失败')"), '真实第二次上传失败反馈')
    check(shapes(await state()).length === failedCount, '上传失败留下半批图片')
  } finally { await evaluate('window.fetch=window.__imageRealFetch;delete window.__imageRealFetch;void 0') }
  const final = await record('failure-boundaries')
  const audit = await evaluate('({clipboard:window.__imageClipboardViolations,uncaught:window.__imageUncaught})')
  check(!audit.clipboard.length && !audit.uncaught.length, `图片回归触碰系统剪贴板或留下未捕获错误：${JSON.stringify(audit)}`)
  await writeFile(join(output, 'image-import.png'), (await wc.capturePage()).toPNG())
  await window.loadURL(wc.getURL())
  await until(async () => (await state())?.ready, '刷新恢复')
  check(JSON.stringify((await state()).imageRecords.sort((a, b) => a.id.localeCompare(b.id))) === JSON.stringify(final.imageRecords.sort((a, b) => a.id.localeCompare(b.id))), '刷新丢失形状/资产/描述')
  await record('reloaded')
  return { chooser: true, nativeFileDrop: true, privateFilePaste: true, mixedImageWebmPaste: true, fileOverHtml: true, formAndCompositionUntouched: true, formats: Object.keys(pixels), coloredPixels: pixels, altEnterEscapeOutside: true, altNarrow: true, errorDuringSave: true, replacementIdentityCropAndUndo: true, batchAndUndo: true, largeCamera: true, sanitizedSvg: true, corruptSvgRejected: true, corruptBatchRollback: true, uploadBatchRollback: true, reload: true, audit }
}
