import { app, BrowserWindow, nativeImage, clipboard } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { measureFrameTitlePerformance } from './frame-title-performance.mjs'
import { handleSmoke } from './handle-smoke.mjs'
import { cameraSmoke } from './camera-smoke.mjs'
import { minimapSmoke } from './minimap-smoke.mjs'
import { keyboardSmoke } from './keyboard-smoke.mjs'
import { selectionSemanticsSmoke } from './selection-semantics-smoke.mjs'
import { selectionSmoke } from './selection-smoke.mjs'
import { creationSmoke } from './creation-smoke.mjs'
import { measureSelectionPointer } from './selection-perf.mjs'
import { externalSamples } from './external-samples.js'
import { imageSmoke, prepareImageProbe, imageImportSmoke } from './image-smoke.mjs'
import { prepareVideoProbe, videoSmoke } from './video-smoke.mjs'
import {captureSmoke} from '../content-host/capture-smoke.mjs'
import {filmSmoke} from '../content-host/film-smoke.mjs'
import {channelSmoke} from '../content-host/channel-smoke.mjs'
import { drawSmoke } from './draw-smoke.mjs'
import { textEditingSmoke } from './text-editing-smoke.mjs'
import { connectionSmoke } from './connection-smoke.mjs'
import { checkShapeCompositing } from './compositing-guard.mjs'
import { checkCameraGeometry } from './camera-geometry-guard.mjs'
import { checkOpaqueBorderCut } from './clip-negative-guard.mjs'
import { actionsSmoke } from './actions-smoke.mjs'
import { noteSmoke } from './note-smoke.mjs'
import { duplicateSmoke } from './duplicate-smoke.mjs'
import { snappingSmoke } from './snapping-smoke.mjs'
import { frameSmoke } from './frame-smoke.mjs'
import { svgImportSmoke, svgSecuritySmoke } from './svg-smoke.mjs'
import { eraserSmoke } from './eraser-smoke.mjs'
import { mediaCleanupSmoke } from './media-cleanup-smoke.mjs'
import { laserSmoke } from './laser-smoke.mjs'

import { prepareNodeTextLayout } from '../../server/text-layout.mjs'
import { measureText, layoutText } from '../../renderer/geometry.js'
import { textLayoutCorpus } from './text-layout-corpus.js'
prepareNodeTextLayout()
const nodeTextCorpus = textLayoutCorpus(measureText, layoutText)

const manifest = JSON.parse(await readFile(process.argv.at(-1), 'utf8'))
const origin = new URL(manifest.url).origin
if (!origin.startsWith('http://127.0.0.1:')) throw new Error('仅允许本机合成预览。')
app.setName('hiCanvas renderer smoke')
app.setPath('userData', manifest.profile)
app.setPath('sessionData', manifest.profile)
if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
app.on('window-all-closed', () => {})
const samples = [], errors = [], blocked = [], simulated = []
const fakeSources = new Map(externalSamples.filter(sample => sample.src).map(sample => [new URL(sample.src).href.split('#')[0], sample.id]))
let window,contentPort=manifest.contentPort
const evaluate = code => window.webContents.executeJavaScript(code)
async function state() { return evaluate('window.__HICANVAS_RENDERER_PREVIEW__?.getState()') }
async function until(predicate) {
  const end = Date.now() + 30000
  while (Date.now() < end) { const value = await predicate(); if (value) return value; await delay(20) }
  throw new Error('等待渲染器就绪超时。')
}
const check = (condition, message) => { if (!condition) throw new Error(message) }
async function cameraLayoutProbe(selected = false) {
  const contents = window.webContents
  await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:100,y:100,z:1});void 0')
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const x = selected ? 140 : 50, y = selected ? 140 : 50
  for (const type of ['mouseDown', 'mouseUp']) contents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 })
  await until(async () => (await state()).selectedIds.length === Number(selected))
  contents.debugger.attach('1.3')
  try {
    await contents.debugger.sendCommand('Performance.enable')
    const metrics = async () => Object.fromEntries((await contents.debugger.sendCommand('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]))
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const before = await metrics()
    let zoom = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getCamera().z')
    for (const deltaY of [-3, 3, -3, 3]) {
      contents.sendInputEvent({ type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY, modifiers: ['control'], canScroll: true })
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const next = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getCamera().z')
      check(next !== zoom, '布局回归检查的真实滚轮没有改变缩放')
      zoom = next
    }
    const pan = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getCamera()')
    contents.sendInputEvent({ type: 'mouseMove', x: 640, y: 400 })
    contents.sendInputEvent({ type: 'mouseDown', x: 640, y: 400, button: 'middle', clickCount: 1 })
    contents.sendInputEvent({ type: 'mouseMove', x: 680, y: 430, button: 'middle', modifiers: ['middleButtonDown'] })
    contents.sendInputEvent({ type: 'mouseUp', x: 680, y: 430, button: 'middle', clickCount: 1 })
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const moved = await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getCamera()')
    check(moved.x !== pan.x && moved.y !== pan.y, '布局回归检查的真实中键没有改变平移')
    const after = await metrics(), layouts = after.LayoutCount - before.LayoutCount
    check(layouts === 0, `相机平移缩放触发了 ${layouts} 次布局；静态内容不应逐帧重排`)
    return { selected, cameraLayouts: layouts }
  } finally { contents.debugger.detach() }
}
function createWindow(key, audit = null) {
  const target = new BrowserWindow({ show: false, width: 1280, height: 800, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: `renderer-${process.pid}-${key}` } })
  target.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const service = fakeSources.get(details.url)
    if (service && details.resourceType === 'subFrame') {
      simulated.push({ service, source: details.url })
      callback({ redirectURL: `${origin}/tools/renderer-preview/fake-embed.html?service=${service}` }); return
    }
    const url = new URL(details.url), contentAllowed = (manifest.scriptUrl && url.origin === new URL(manifest.scriptUrl).origin || /^[a-f0-9]{48}\.localhost$/.test(url.hostname) && Number(url.port) === contentPort), allowed = contentAllowed || url.origin === origin || url.protocol === 'ws:' && url.host === new URL(origin).host || ['data:', 'blob:'].includes(url.protocol)
    if (audit && ['http:', 'https:', 'file:', 'ws:', 'wss:'].includes(url.protocol) && !(details.resourceType === 'mainFrame' && details.url === audit.expectedDocument)) audit.requests.push(details.url)
    if (!allowed) (audit?.blocked || blocked).push(details.url)
    callback({ cancel: !allowed })
  })
  target.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  target.webContents.on('console-message', detail => { if (audit && detail.message.includes('HICANVAS_SVG_EXEC')) audit.executions.push(detail.message); if (detail.level === 'error') (audit?.errors || errors).push(detail.message.slice(0, 500)) })
  target.webContents.on('render-process-gone', (_event, detail) => errors.push(`renderer gone: ${detail.reason}`))
  return target
}

async function run() {
  // Only the full renderer preview hosts isolated content and answers
  // /api/health. The interaction previews behind the native *-check entries
  // refuse it (403, empty body); they have no content port to allow.
  if (!contentPort) { const health = await fetch(origin + '/api/health'); if (health.ok) contentPort = (await health.json()).contentHost?.port }
  try {
    app.dock?.hide()
    if (manifest.framesOnly) {
      window = createWindow('frames')
      await window.loadURL(`${manifest.url}/?gallery=frame-interaction&edgeScrolling=0`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ frames: await frameSmoke(window, manifest.output) })
      check(!errors.length && !blocked.length, JSON.stringify({ errors, blocked }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2)); window.destroy(); app.exit(0); return
    }
    if (manifest.imagesOnly) {
      const clipboardCalls = []
      for (const name of Object.keys(clipboard)) if (typeof clipboard[name] === 'function') clipboard[name] = () => { clipboardCalls.push(name); throw new Error(`System clipboard blocked: ${name}`) }
      window = createWindow('image-import')
      await prepareImageProbe(window)
      await window.loadURL(`${manifest.url}/?gallery=image-import&edgeScrolling=0`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ images: await imageImportSmoke(window, manifest.output, manifest.imageFiles) })
      samples.push({ svg: await svgImportSmoke(window, manifest.output, manifest.imageFiles), svgSecurity: await svgSecuritySmoke(createWindow, origin, manifest.svgSecurity, manifest.output) })
      samples.push({ mediaCleanup: await mediaCleanupSmoke(window, manifest.output, manifest.imageFiles) })
      check(!errors.length && !blocked.length && !clipboardCalls.length, JSON.stringify({ errors, blocked, clipboardCalls }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, clipboardCalls, runtime: process.versions }, null, 2)); window.destroy(); app.exit(0); return
    }
    if (manifest.videosOnly) {
      window = createWindow('videos')
      await prepareVideoProbe(window)
      await window.loadURL(`${manifest.url}/?gallery=videos&edgeScrolling=0`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ videos: await videoSmoke(window, manifest.output, manifest.videoFiles) })
      samples.push({ mediaCleanup: await mediaCleanupSmoke(window, manifest.output, manifest.videoFiles, 'video') })
      check(!errors.length && !blocked.length, JSON.stringify({ errors, blocked }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2)); window.destroy(); app.exit(0); return
    }
    if (manifest.snappingOnly) {
      window = createWindow('snapping')
      await window.loadURL(`${manifest.url}/?gallery=snapping&snapping=1&edgeScrolling=0`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ snapping: await snappingSmoke(window, manifest.output) })
      check(!errors.length && !blocked.length, JSON.stringify({ errors, blocked }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2)); window.destroy(); app.exit(0); return
    }
    if (manifest.notesOnly) {
      window = createWindow('note-editing')
      await window.loadURL(`${manifest.url}/?gallery=note-editing&edgeScrolling=0`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ notes: await noteSmoke(window, manifest.output) })
      check(!errors.length && !blocked.length, JSON.stringify({ errors, blocked }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2)); window.destroy(); app.exit(0); return
    }
    if (manifest.connectionsOnly) {
      window = createWindow('connection-editing')
      await window.loadURL(`${manifest.url}/?gallery=connection-editing&edgeScrolling=0`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ connections: await connectionSmoke(window, manifest.output) })
      check(!errors.length && !blocked.length, JSON.stringify({ errors, blocked }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2)); window.destroy(); app.exit(0); return
    }
    if (manifest.textEditingOnly) {
      window = createWindow('text-editing')
      await window.loadURL(`${manifest.url}/?gallery=text-editing&edgeScrolling=0`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ textEditing: await textEditingSmoke(window, manifest.output) })
      check(!errors.length && !blocked.length, JSON.stringify({ errors, blocked }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2)); window.destroy(); app.exit(0); return
    }
    if (manifest.actionsOnly) {
      window = createWindow('selection-actions')
      await window.loadURL(`${manifest.url}/?gallery=selection-actions&edgeScrolling=0&reduceMotion=1`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ actions: await actionsSmoke(window, manifest.output) })
      samples.push({ duplicates: await duplicateSmoke(window, manifest.output) })
      check(!errors.length && !blocked.length, JSON.stringify({ errors, blocked }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2)); window.destroy(); app.exit(0); return
    }
    if (manifest.lasersOnly) {
      window = createWindow('laser')
      await window.loadURL(`${manifest.url}/?gallery=laser&edgeScrolling=0`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ laser: await laserSmoke(window, manifest.output) })
      if (errors.length || blocked.length) throw new Error(JSON.stringify({ errors, blocked }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions, sourceHash: manifest.sourceHash }, null, 2)); window.destroy(); app.exit(0); return
    }
    if (manifest.erasersOnly) {
      window = createWindow('eraser')
      await window.loadURL(`${manifest.url}/?gallery=eraser&edgeScrolling=0`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ eraser: await eraserSmoke(window, manifest.output, manifest.eraserColorOnly) })
      check(!errors.length && !blocked.length, JSON.stringify({ errors, blocked }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2)); window.destroy(); app.exit(0); return
    }
    if (manifest.drawOnly) {
      window = createWindow('draw-input')
      await window.loadURL(`${manifest.url}/?gallery=draw-input`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ draw: await drawSmoke(window, manifest.output) })
      check(!errors.length && !blocked.length, JSON.stringify({ errors, blocked }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2)); window.destroy(); app.exit(0); return
    }
    if (manifest.creationOnly) {
      window = createWindow('creation')
      await window.loadURL(`${manifest.url}/?gallery=creation&edgeScrolling=0`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ creation: await creationSmoke(window, manifest.output) })
      check(!errors.length && !blocked.length, JSON.stringify({ errors, blocked }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2)); window.destroy(); app.exit(0); return
    }
    if (manifest.keyboardOnly || manifest.selectionSemanticsOnly) {
      const selectionOnly = manifest.selectionSemanticsOnly
      window = createWindow(selectionOnly ? 'selection-semantics' : 'keyboard')
      await window.loadURL(`${manifest.url}/?${selectionOnly ? 'gallery=selection-semantics' : 'count=500'}`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push(selectionOnly ? { selectionSemantics: await selectionSemanticsSmoke(window, manifest.output) } : { keyboard: await keyboardSmoke(window, manifest.output) })
      check(!errors.length && !blocked.length, JSON.stringify({ errors, blocked }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2)); window.destroy(); app.exit(0); return
    }
    if (manifest.handlesOnly) {
      window = createWindow('handles')
      await window.loadURL(`${manifest.url}/?count=500`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ handles: await handleSmoke(window, manifest.output), cameraLayout: await cameraLayoutProbe(true) })
      check(!errors.length && !blocked.length, JSON.stringify({ errors, blocked }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2)); window.destroy(); app.exit(0); return
    }
    if(manifest.contentFilmOnly){
      window=createWindow('content-film')
      const result=await filmSmoke(window,manifest)
      check(blocked.length===0,`影片回归不应请求公网：${blocked.join('; ')}`)
      check(errors.length===0,`影片回归控制台错误：${errors.join('; ')}`)
      await writeFile(manifest.result,JSON.stringify({...result,errors,blocked,runtime:process.versions},null,2))
      window.destroy();app.exit(0);return
    }
    if(manifest.contentCaptureOnly){
      window=createWindow('content-capture')
      const result=await captureSmoke(window,manifest)
      check(blocked.length===0,`截图回归不应请求公网：${blocked.join('; ')}`)
      check(errors.length===0,`截图回归控制台错误：${errors.join('; ')}`)
      await writeFile(manifest.result,JSON.stringify({...result,errors,blocked,runtime:process.versions},null,2))
      window.destroy();app.exit(0);return
    }
    if(manifest.contentChannelOnly){
      window=createWindow('content-channel')
      const result=await channelSmoke(window,manifest,()=>createWindow('channel-preview'))
      check(blocked.length===0,`实例通道冒烟不应请求公网：${blocked.join('; ')}`)
      check(errors.length===0,`实例通道冒烟控制台错误：${errors.join('; ')}`)
      await writeFile(manifest.result,JSON.stringify({...result,errors,blocked,runtime:process.versions},null,2))
      window.destroy();app.exit(0);return
    }
    if (manifest.contentSecurityOnly) {
      window = createWindow('content-security')
      await window.loadURL(manifest.url)
      await until(() => evaluate('typeof window.runContentSecurity === "function"'))
      const result = await evaluate(`window.runContentSecurity(${JSON.stringify({ scriptUrl: manifest.scriptUrl })})`)
      check(blocked.length === 0, `安全门禁不应请求公网：${blocked.join('; ')}`)
      await writeFile(manifest.result, JSON.stringify({ ...result, blocked, runtime: process.versions }, null, 2))
      window.destroy(); app.exit(0); return
    }
    if (manifest.cameraOnly) {
      window = createWindow('camera')
      await window.loadURL(`${manifest.url}/?count=500`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ camera: await cameraSmoke(window, manifest.output, { persistent: true }) })
      check(!errors.length && !blocked.length, JSON.stringify({ errors, blocked }))
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked }, null, 2)); window.destroy(); app.exit(0); return
    }
    if (manifest.selectionOnly) {
      window = createWindow('selection')
      await window.loadURL(`${manifest.url}/?count=500`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      // Handles undo their edits before the existing selection workflow starts.
      samples.push({ handles: await handleSmoke(window, manifest.output), selection: await selectionSmoke(window, manifest.output, { persistent: true }) })
      window.destroy(); window = createWindow('selection-perf')
      await window.loadURL(`${manifest.url}/?count=5000`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ count: 5000, pointer: await measureSelectionPointer(window) })
      check(!errors.length && !blocked.length, `浏览器错误／外部请求：${JSON.stringify({ errors, blocked })}`)
      await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, runtime: process.versions }, null, 2))
      window.destroy(); app.exit(0); return
    }
    for (const count of manifest.counts || (manifest.galleries ? [] : [500, 2000, 5000])) {
      window = createWindow(count)
      await window.loadURL(`${manifest.url}/?count=${count}`)
      const initial = await until(async () => { const value = await state(); if (value?.error) throw new Error(value.error); return value?.ready && value })
      check(initial.renderedShapes === count && initial.imageCount === count / 5 && initial.decodedImages === count / 5, `元素/图片数量不符：${JSON.stringify(initial)}`)
      const snapshot = (await window.webContents.capturePage()).toPNG()
      await writeFile(join(manifest.output, `${count}-elements.png`), snapshot)
      const cameraGeometry = await checkCameraGeometry(window.webContents, count, { directory: manifest.output, label: `${count}-clip`, failureOnly: true })
      const opaqueBorderCut = count === 500 ? await checkOpaqueBorderCut(window.webContents, { directory: manifest.output, label: 'opaque-one-css-cut', failureOnly: true }, nativeImage.createFromBuffer) : undefined
      window.webContents.sendInputEvent({ type: 'mouseWheel', x: 640, y: 400, deltaX: 20, deltaY: 30, canScroll: true })
      const pan = await until(async () => { const value = await state(); return value.camera.x !== initial.camera.x && value })
      window.webContents.sendInputEvent({ type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: -40, modifiers: ['control'], canScroll: true })
      const zoom = await until(async () => { const value = await state(); return value.camera.z !== pan.camera.z && value })
      let lifecycle, cameraLayout, text, fonts, textLayout, frameTitles, scalingDispatch, compositing
      if (count === 5000) {
        cameraLayout = { empty: await cameraLayoutProbe(), selected: await cameraLayoutProbe(true) }
        await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera(${JSON.stringify(initial.camera)});void 0`)
        compositing = await checkShapeCompositing(window.webContents, count)
      }
      if (count === 5000) frameTitles = await measureFrameTitlePerformance(window.webContents, manifest.output)
      if (count === 500) {
        scalingDispatch = await evaluate("import('/tools/renderer-preview/scale-render-probe.js').then(module => module.runScaleRenderProbe())")
        lifecycle = await evaluate("import('/tools/renderer-preview/probe.js').then(module => module.runLifecycleProbe())")
        text = await evaluate("import('/tools/renderer-preview/text-probe.js').then(module => module.runTextProbe())")
        fonts = await evaluate("import('/tools/renderer-preview/font-probe.js').then(module => module.runFontProbe())")
        textLayout = await evaluate(`import('/tools/renderer-preview/text-layout-probe.js').then(module => module.runTextLayoutProbe(${JSON.stringify(nodeTextCorpus)}))`)
      }
      const camera = count === 500 ? await cameraSmoke(window, manifest.output) : undefined
      const selection = count === 500 ? await selectionSmoke(window, manifest.output) : undefined
      const minimap = count === 500 ? await minimapSmoke(window, manifest.output) : undefined
      const keyboard = count === 500 ? await keyboardSmoke(window, manifest.output) : undefined
      samples.push({ count, initial, pan: pan.camera, zoom: zoom.camera, lifecycle, cameraLayout, text, fonts, textLayout, selection, frameTitles, camera, minimap, scalingDispatch, keyboard, compositing, cameraGeometry, opaqueBorderCut })
      console.log(`${count} 元素与 ${initial.decodedImages} 张图片通过；真实滚轮平移/缩放通过。`)
      window.destroy(); window = undefined
    }
    const galleryCounts = { images: 6, shapes: 20, styles: 82, metrics: 22, 'metrics-long': 22, 'metrics-curves': 10, embeds: null, bookmarks: null, external: null, arrows: null, routes: null, lines: null, bindings: null, 'bound-elbows': null, draw: 16, 'draw-filled': 16, 'note-colors': 13, 'note-text': 12, 'note-layout': 15, 'note-fonts': 4, 'note-whitespace': 4, 'frame-titles': 7 }
    for (const [gallery, count] of Object.entries(galleryCounts)) {
      if (manifest.galleries && !manifest.galleries.includes(gallery)) continue
      window = createWindow(gallery)
      await window.loadURL(`${manifest.url}/?gallery=${gallery}`)
      const initial = await until(async () => { const value = await state(); if (value?.error) throw new Error(value.error); return value?.ready && value })
      const type = gallery === 'images' ? 'image' : gallery.startsWith('note-') ? 'note' : gallery === 'frame-titles' ? 'frame' : 'geo'
      check(initial.renderedShapes === initial.count && (gallery === 'embeds' ? initial.counts.embed === 6 && initial.counts.bookmark === 1 : gallery === 'bookmarks' ? initial.counts.bookmark === 9 : gallery === 'external' ? initial.counts.embed === 18 : count === null || initial.counts[type] === count), '图鉴元素未完整绘制')
      if (gallery === 'embeds') {
        const instanceReady = '!!document.documentElement?.dataset.instance'
        // A navigating frame may not have parsed its root yet. Exercise that
        // state deliberately; caught executeJavaScript failures still pollute
        // the renderer console and must never be hidden by the readiness loop.
        const pending = createWindow('embed-readiness')
        try {
          await pending.loadURL('data:text/html,<html></html>')
          await pending.webContents.executeJavaScript("document.documentElement.dataset.instance='ready';void 0")
          check(await pending.webContents.executeJavaScript(instanceReady) === true, '已就绪的实例没有被识别')
          await pending.webContents.executeJavaScript('document.documentElement.remove();void 0')
          check(await pending.webContents.executeJavaScript(instanceReady) === false, '未解析根节点的实例不得就绪')
        } finally { pending.destroy() }
        await until(async () => {
          const values=await Promise.all(window.webContents.mainFrame.frames.map(frame=>frame.executeJavaScript(instanceReady).catch(()=>false)))
          return values.filter(Boolean).length===3
        })
      }
      await writeFile(join(manifest.output, `${gallery}-gallery.png`), (await window.webContents.capturePage()).toPNG())
      // The images gallery holds an animated GIF whose frames change between the
      // clip pixel captures. Pause it with the gallery's own reduce-motion control
      // for this check only, then resume so imageSmoke still sees it play.
      const pauseImages = async paused => {
        check(await evaluate(`(() => { const box = document.querySelector('[data-image-action="reduce-motion"]'); if (box.checked !== ${paused}) box.click(); return box.checked })()`) === paused, '图片图鉴的减少动画开关没有切换')
        if (paused) await until(() => evaluate(`Boolean(document.querySelector('[data-image-static="ready"]'))`))
      }
      if (gallery === 'images') await pauseImages(true)
      const cameraGeometry = await checkCameraGeometry(window.webContents, initial.count, { directory: manifest.output, label: `${gallery}-clip`, failureOnly: true })
      if (gallery === 'images') await pauseImages(false)
      const images = gallery === 'images' ? await imageSmoke(window, manifest.output) : undefined
      const geometry = gallery === 'shapes' ? await evaluate("import('/tools/renderer-preview/geo-probe.js').then(module => module.runGeoProbe())") : undefined
      const handDrawn = gallery === 'draw' ? await evaluate("import('/tools/renderer-preview/hand-drawn-probe.js').then(module => module.runHandDrawnProbe())") : undefined
      const embeds = gallery === 'embeds' ? await evaluate("import('/tools/renderer-preview/embed-probe.js').then(module => module.runEmbedProbe())") : undefined
      const notes = gallery === 'note-layout' ? await evaluate("import('/tools/renderer-preview/note-probe.js').then(module => module.runNoteProbe())") : undefined
      const titles = gallery === 'frame-titles' ? await evaluate("import('/tools/renderer-preview/note-probe.js').then(module => module.runFrameTitleProbe())") : undefined
      const notePaint = ['note-colors', 'note-text', 'note-whitespace'].includes(gallery) ? await evaluate(`import('/tools/renderer-preview/note-probe.js').then(module => module.checkNoteGallery('${gallery}'))`) : undefined
      const bookmarks = gallery === 'bookmarks' ? await evaluate("import('/tools/renderer-preview/bookmark-probe.js').then(module => module.runBookmarkProbe())") : undefined
      const external = gallery === 'external' ? await evaluate("import('/tools/renderer-preview/external-probe.js').then(module => module.runExternalProbe())") : undefined
      if (['embeds', 'bookmarks', 'external'].includes(gallery)) {
        window.setContentSize(390, 800)
        await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x: 15, y: 180, z: ${gallery === 'external' ? .13 : .26}})`)
        await delay(100)
        await writeFile(join(manifest.output, `${gallery}-narrow.png`), (await window.webContents.capturePage()).toPNG())
      }
      const connections = gallery === 'bindings' ? await evaluate("import('/tools/renderer-preview/arrow-probe.js').then(module => module.runConnectionProbe())") : undefined
      samples.push({ gallery, initial, images, geometry, embeds, bookmarks, external, connections, handDrawn, notes, titles, notePaint, cameraGeometry })

      window.destroy(); window = undefined
    }
    if (!manifest.galleries || manifest.galleries.includes('creation')) {
      window = createWindow('creation')
      await window.loadURL(`${manifest.url}/?gallery=creation&edgeScrolling=0`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ creation: await creationSmoke(window, manifest.output) })
      window.destroy(); window = undefined
    }
    if (!manifest.galleries || manifest.galleries.includes('connection-editing')) {
      window = createWindow('connection-editing')
      await window.loadURL(`${manifest.url}/?gallery=connection-editing&edgeScrolling=0`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ connections: await connectionSmoke(window, manifest.output) })
      window.destroy(); window = undefined
    }
    if (!manifest.galleries || manifest.galleries.includes('note-editing')) {
      window = createWindow('note-editing')
      await window.loadURL(`${manifest.url}/?gallery=note-editing&edgeScrolling=0`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ notes: await noteSmoke(window, manifest.output) })
      window.destroy(); window = undefined
    }
    if (!manifest.galleries || manifest.galleries.includes('videos')) {
      window = createWindow('videos')
      await prepareVideoProbe(window)
      await window.loadURL(`${manifest.url}/?gallery=videos&edgeScrolling=0`)
      await until(async () => { const s = await state(); if (s?.error) throw new Error(s.error); return s?.ready })
      samples.push({ videos: await videoSmoke(window, manifest.output) }); window.destroy(); window = undefined
    }
    for (const gallery of ['stroke-styles', 'stroke-details', 'stroke-highlights', 'stroke-transforms']) {
      if (manifest.galleries && !manifest.galleries.includes(gallery)) continue
      window = createWindow(gallery)
      await window.loadURL(`${manifest.url}/?gallery=${gallery}`)
      const initial = await until(async () => { const value = await state(); if (value?.error) throw new Error(value.error); return value?.ready && value })
      check(initial.renderedShapes === initial.count && initial.counts.draw + initial.counts.highlight > 0, '笔迹图鉴未完整绘制')
      const capture = await window.webContents.capturePage()
      await writeFile(join(manifest.output, `${gallery}-gallery.png`), capture.toPNG())
      const cameraGeometry = await checkCameraGeometry(window.webContents, initial.count, { directory: manifest.output, label: `${gallery}-clip`, failureOnly: true })
      let overlaps
      if (gallery === 'stroke-highlights') {
        const size = capture.getSize(), bytes = capture.toBitmap(), ratio = size.width / 1280
        overlaps = Array.from({ length: 4 }, (_, col) => {
          const x = (130 + col * 280 + initial.camera.x) * initial.camera.z, y = (600 + initial.camera.y) * initial.camera.z
          const offset = (Math.round(y * ratio) * size.width + Math.round(x * ratio)) * 4
          return [bytes[offset + 2], bytes[offset + 1], bytes[offset]]
        })
        check(overlaps.every(rgb => rgb.every((value, i) => Math.abs(value - [87, 188, 181][i]) <= 2)), `荧光笔全局叠色顺序或透明度不符：${JSON.stringify(overlaps)}`)
      }
      const strokes = gallery === 'stroke-styles' ? await evaluate("import('/tools/renderer-preview/stroke-probe.js').then(module => module.runStrokeProbe())") : undefined
      samples.push({ gallery, initial, strokes, overlaps, cameraGeometry })
      window.destroy(); window = undefined
    }
    check(errors.length === 0 && blocked.length === 0, `浏览器错误：${errors.join('; ')}；外部请求：${blocked.join('; ')}`)
    await writeFile(manifest.result, JSON.stringify({ samples, errors, blocked, simulated, runtime: process.versions }, null, 2))
    app.exit(0)
  } catch (error) {
    await writeFile(manifest.result, JSON.stringify({ error: error.stack, samples, errors, blocked, simulated }, null, 2))
    if (window && !window.isDestroyed()) { window.webContents.invalidate(); await writeFile(join(manifest.output, 'failure.png'), (await window.webContents.capturePage()).toPNG()) }
    window?.destroy(); console.error(error); app.exit(1)
  }
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1) })
