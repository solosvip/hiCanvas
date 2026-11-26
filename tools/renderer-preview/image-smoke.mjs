import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

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
  const replacement = join(output, 'replacement.svg')
  await writeFile(replacement, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><path fill="magenta" d="M0 0h400v100H0z"/></svg>')
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
