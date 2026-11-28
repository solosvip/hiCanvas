import { app, BrowserWindow, clipboard } from 'electron'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { checkClipPixels } from './clip-pixel-guard.mjs'
import { prepareEmbedsProbe } from './embeds-smoke.mjs'

const manifest = JSON.parse(await readFile(process.argv.at(-1), 'utf8')), origin = new URL(manifest.url).origin
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/)
assert.equal(createHash('sha256').update(manifest.baseline).digest('hex'), manifest.baselineHash)
app.setName('hiCanvas clip visibility smoke')
app.setPath('userData', manifest.profile); app.setPath('sessionData', manifest.profile)
if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
app.on('window-all-closed', () => {})
const errors = [], blocked = [], clipboardCalls = [], guards = new Map()
for (const name of Object.getOwnPropertyNames(clipboard)) if (typeof clipboard[name] === 'function') {
  const denied = () => { clipboardCalls.push(name); throw new Error(`System clipboard blocked: ${name}`) }
  Object.defineProperty(clipboard, name, { value: denied }); guards.set(name, denied)
}
assert.ok(guards.has('readText') && guards.has('writeText') && [...guards].every(([name, denied]) => clipboard[name] === denied))
assert.throws(() => clipboard.readText(), /System clipboard blocked/)
assert.deepEqual(clipboardCalls.splice(0), ['readText'])
let window, browserProof, oldUrl, red, closed, opened, green, shadowPoint, openedRefusal, zeroShadow
const evaluate = code => window.webContents.executeJavaScript(code)
const modulePath = '/tools/renderer-preview/clip-pixel-mask.js'
const metadata = path => evaluate(`import(${JSON.stringify(path)}).then(m=>{try{return m.beginClipPixelProbe({overflowProbe:false})}finally{if(m.endClipPixelProbe()!==true)throw Error('Probe state not restored')}})`)
const covers = (box, x, y) => box.width > 0 && box.height > 0 && x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height
async function still(name) {
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await delay(300)
  let previous = await window.webContents.capturePage()
  for (let attempt = 0; attempt < 6; attempt++) {
    await delay(100)
    const current = await window.webContents.capturePage()
    if (current.toBitmap().equals(previous.toBitmap())) { await writeFile(join(manifest.output, `${name}.png`), current.toPNG()); return current }
    previous = current
  }
  throw new Error(`可见性截图未停稳：${name}`)
}
function changedPixelIn(on, off, area, viewport) {
  const { width, height } = on.getSize(), scale = width / viewport.width
  assert.deepEqual(off.getSize(), { width, height }); assert.equal(height / viewport.height, scale)
  const a = on.toBitmap(), b = off.toBitmap()
  for (let y = Math.max(0, Math.ceil(area.y * scale)); y < Math.min(height, Math.floor((area.y + area.height) * scale)); y++) {
    for (let x = Math.max(0, Math.ceil(area.x * scale)); x < Math.min(width, Math.floor((area.x + area.width) * scale)); x++) {
      const offset = (y * width + x) * 4
      if (!a.subarray(offset, offset + 4).equals(b.subarray(offset, offset + 4))) return { x: (x + .5) / scale, y: (y + .5) / scale }
    }
  }
  return null
}
async function refusal(contents, label) {
  try { await checkClipPixels(contents, { directory: manifest.output, label }); assert.fail('整视口兜底未拒绝取证') }
  catch (error) { assert.match(error.message, /溢出守卫的采样点意外落在视口框内/); return error.message }
}
async function run() {
  try {
    app.dock?.hide()
    window = new BrowserWindow({ show: false, width: 1280, height: 800, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: `clip-${process.pid}` } })
    const wc = window.webContents
    wc.session.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url), allowed = url.origin === origin || url.protocol === 'ws:' && url.host === new URL(origin).host || ['data:', 'blob:'].includes(url.protocol)
      if (!allowed) blocked.push(details.url)
      callback({ cancel: !allowed })
    })
    wc.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    wc.setWindowOpenHandler(details => { blocked.push(details.url); return { action: 'deny' } })
    wc.session.on('will-download', event => { event.preventDefault(); errors.push('Unexpected download') })
    wc.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) { event.preventDefault(); blocked.push(url) } })
    wc.on('console-message', detail => { if (detail.level === 'error') errors.push(detail.message) })
    wc.on('render-process-gone', (_event, detail) => errors.push(`renderer gone: ${detail.reason}`))
    browserProof = await prepareEmbedsProbe(window)
    await window.loadURL(`${manifest.url}/?gallery=styles&edgeScrolling=0`)
    const deadline = Date.now() + 30000
    while (true) {
      const state = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()')
      if (state?.error) throw new Error(state.error)
      if (state?.ready) break
      if (Date.now() > deadline) throw new Error('等待合成预览就绪超时')
      await delay(20)
    }
    assert.equal(await evaluate('window.__hicanvasEmbedClipboardBoundary?.check()'), true)
    // Use an integer camera for this visibility fixture's exact restoration.
    // Fractional-scale clip checks remain in the unmodified renderer:smoke.
    await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:20,y:25,z:1});void 0')
    const before = await still('before'), original = await metadata(modulePath)
    oldUrl = await evaluate(`URL.createObjectURL(new Blob([${JSON.stringify(manifest.baseline)}],{type:'text/javascript'}))`)
    const dialog = await evaluate(`(()=>{
      const d=document.createElement('dialog');d.id='clip-visibility-dialog';d.style.cssText='position:fixed;left:900px;top:560px;margin:0;width:160px;height:100px;padding:0;border:0;background:rgb(8,8,8);box-shadow:20px 0px 0px 4px black;z-index:2147483647';
      document.querySelector('#navigation').append(d);
      return {tag:d.tagName,open:d.open,display:getComputedStyle(d).display,shadow:getComputedStyle(d).boxShadow};
    })()`)
    assert.equal(dialog.tag, 'DIALOG'); assert.equal(dialog.open, false); assert.equal(dialog.display, 'none'); assert.notEqual(dialog.shadow, 'none')
    const old = await metadata(oldUrl)
    assert.ok(old.opaqueBoxes.some(box => box.x === 0 && box.y === 0 && box.width === old.viewport.width && box.height === old.viewport.height), '旧版没有重现全视口误登记')
    closed = await metadata(modulePath)
    assert.deepEqual(closed, original, '关闭对话框仍贡献遮挡区域')
    assert.ok((await still('closed')).toBitmap().equals(before.toBitmap()), '关闭对话框实际改变了画面')
    // Route only the import to the preserved real old module. All screenshots,
    // modes, pixel classifiers and assertions execute unchanged in Chromium.
    let routed = 0
    const legacyContents = { capturePage: () => wc.capturePage(), executeJavaScript: code => {
      if (code.includes(`import(${JSON.stringify(modulePath)})`)) { routed++; code = code.replace(`import(${JSON.stringify(modulePath)})`, `import(${JSON.stringify(oldUrl)})`) }
      return wc.executeJavaScript(code)
    } }
    red = await refusal(legacyContents, 'old-closed')
    assert.ok(routed > 2, '未重放真实旧版probe')
    await evaluate(`(()=>{for(const kind of ['display','visibility','zero']){
      const n=document.createElement('div');n.dataset.shapeId='shape:clip-hidden-'+kind;n.dataset.shapeType='geo';n.dataset.clipHiddenFixture='';
      n.style.cssText='position:fixed;width:0;height:0;opacity:.4';if(kind==='display')n.style.display='none';
      n.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="'+(kind==='zero'?0:24)+'" height="'+(kind==='zero'?0:24)+'" style="'+(kind==='visibility'?'visibility:hidden':'')+'"></svg>';document.body.append(n);
    }})()`)
    assert.deepEqual((await metadata(modulePath)).semiShapes, closed.semiShapes, '隐藏或零尺寸半透明SVG仍进入取证清单')
    green = await checkClipPixels(wc, { directory: manifest.output, label: 'new-closed' })
    assert.equal(green.overflowProbe, true)
    await evaluate("document.querySelectorAll('[data-clip-hidden-fixture]').forEach(n=>n.remove());void 0")
    await evaluate("document.querySelector('#clip-visibility-dialog').show();void 0")
    opened = await metadata(modulePath)
    const box = await evaluate("(()=>{const d=document.querySelector('#clip-visibility-dialog'),r=d.getBoundingClientRect();if(!d.open||getComputedStyle(d).display==='none')throw Error('对话框没有打开');return {x:r.x,y:r.y,width:r.width,height:r.height}})()")
    assert.ok(opened.opaqueBoxes.some(value => JSON.stringify(value) === JSON.stringify(box)), '可见浮层实际外框漏登记')
    assert.ok(opened.opaqueBoxes.some(value => covers(value, box.x + box.width / 2, box.y + box.height / 2)), '浮层内部墨迹没有保护')
    assert.equal(opened.opaqueBoxes.some(value => value.x === 0 && value.y === 0 && value.width === opened.viewport.width && value.height === opened.viewport.height), true, '可见阴影的保守绘制范围被削弱')
    const visible = await still('opened')
    assert.ok(!visible.toBitmap().equals(before.toBitmap()), '打开阳性没有实际像素变化')
    await evaluate("document.querySelector('#clip-visibility-dialog').style.boxShadow='none';void 0")
    const withoutShadow = await still('opened-without-shadow')
    shadowPoint = changedPixelIn(visible, withoutShadow, { x: box.x + box.width + 1, y: box.y, width: 23, height: box.height }, opened.viewport)
    assert.ok(shadowPoint && !covers(box, shadowPoint.x, shadowPoint.y), '没有真实的布局框外阴影像素')
    assert.ok(opened.opaqueBoxes.some(value => covers(value, shadowPoint.x, shadowPoint.y)), '布局框外真实阴影错误获得差异许可')
    await evaluate("document.querySelector('#clip-visibility-dialog').style.boxShadow='20px 0px 0px 4px black';void 0")
    openedRefusal = await refusal(wc, 'new-opened-shadow')
    await evaluate("document.querySelector('#clip-visibility-dialog').close();document.querySelector('#clip-visibility-dialog').remove();void 0")
    const zero = await evaluate(`(()=>{
      const n=document.createElement('div');n.id='clip-zero-effect';n.style.cssText='position:fixed;left:900px;top:700px;width:0;height:0;padding:0;border:0;z-index:2147483647;pointer-events:none';document.querySelector('#navigation').append(n);
      const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,layoutRects:n.getClientRects().length,display:getComputedStyle(n).display};
    })()`)
    assert.equal(zero.width, 0); assert.equal(zero.height, 0); assert.ok(zero.layoutRects > 0); assert.notEqual(zero.display, 'none')
    const zeroPlain = await still('zero-without-shadow')
    assert.ok(zeroPlain.toBitmap().equals(before.toBitmap()), '无效果的零尺寸元素改变了画面')
    await evaluate("document.querySelector('#clip-zero-effect').style.boxShadow='20px 0px 0px 4px black';void 0")
    const zeroMetadata = await metadata(modulePath), zeroPaint = await still('zero-shadow')
    assert.ok(zeroMetadata.opaqueBoxes.every(value => value.width > 0 && value.height > 0), '登记了零尺寸外框')
    assert.ok(zeroMetadata.opaqueBoxes.some(value => value.x === 0 && value.y === 0 && value.width === zeroMetadata.viewport.width && value.height === zeroMetadata.viewport.height), '零尺寸可见阴影缺少保守兜底')
    const point = changedPixelIn(zeroPaint, zeroPlain, { x: zero.x + 16, y: zero.y - 4, width: 8, height: 8 }, zeroMetadata.viewport)
    if (point) assert.ok(zeroMetadata.opaqueBoxes.some(value => covers(value, point.x, point.y)), '真实零尺寸扩展阴影未受保护')
    // Report a Chromium that paints no zero-size shadow honestly; it must still
    // retain the conservative fallback and reject the original pixel probe.
    zeroShadow = { ...zero, painted: Boolean(point), point, rejection: await refusal(wc, 'zero-shadow') }
    await evaluate("document.querySelector('#clip-zero-effect').remove();void 0")
    assert.deepEqual(await metadata(modulePath), original, '清理后元数据没有还原')
    assert.ok((await still('restored')).toBitmap().equals(before.toBitmap()), '清理后画面没有还原')
    assert.deepEqual(await evaluate('window.__embedClipboardViolations'), [])
    assert.deepEqual(clipboardCalls, []); assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
    await writeFile(manifest.result, JSON.stringify({ pid: process.pid, sourceHash: manifest.sourceHash, baselineHash: manifest.baselineHash, dialog, red, green, closed, opened, shadowPoint, openedRefusal, zeroShadow, browserProof, guarded: [...guards.keys()], clipboardCalls, errors, blocked, restored: true, runtime: process.versions }, null, 2))
    window.destroy(); app.exit(0)
  } catch (error) {
    await writeFile(manifest.result, JSON.stringify({ error: error.stack, red, closed, opened, shadowPoint, openedRefusal, zeroShadow, errors, blocked, clipboardCalls, browserProof }, null, 2))
    window?.destroy(); app.exit(1)
  }
}
// Electron emits ready after main-module evaluation; awaiting it at top level
// would keep this ESM entry itself unfinished and prevent startup.
app.whenReady().then(run).catch(error => { console.error(error); window?.destroy(); app.exit(1) })
