import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const check = (condition, message) => { if (!condition) throw new Error(message) }
export async function prepareVideoProbe(window) {
  const debug = window.webContents.debugger
  if (!debug.isAttached()) debug.attach('1.3')
  await window.loadURL('data:text/html,<title>isolated video probe</title>')
  await debug.sendCommand('Page.enable')
  await debug.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })
  await debug.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const denied = () => { throw new Error('System clipboard blocked by video probe') }; for (const name of ['read','readText','write','writeText']) Object.defineProperty(navigator.clipboard, name, { value: denied }); const exec = document.execCommand.bind(document); document.execCommand = (name, ...args) => name.toLowerCase() === 'paste' ? denied() : exec(name, ...args); })()` })
}
export async function videoSmoke(window, output, files = null) {
  const wc = window.webContents, evaluate = code => wc.executeJavaScript(code), debug = wc.debugger
  const state = () => evaluate('window.__HICANVAS_RENDERER_PREVIEW__.getState()')
  const until = async (predicate, label = '视频操作') => { const end = Date.now() + 20000; while (Date.now() < end) { const value = await predicate(); if (value) return value; await delay(30) } throw new Error(`${label}超时`) }
  const click = async (x, y, count = 1) => { wc.sendInputEvent({ type: 'mouseMove', x, y }); for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x, y, button: 'left', clickCount: count }); await delay(80) }
  const subject = 'shape:video-0'
  const videoState = (id = subject) => evaluate(`(() => { const v = document.querySelector('[data-shape-id="${id}"] video'); if (!v) return null; const b = v.getBoundingClientRect(); return { time:v.currentTime, paused:v.paused, duration:v.duration, controls:v.controls, seeking:v.seeking, ready:v.readyState, src:v.currentSrc.slice(0,100), box:{x:b.x,y:b.y,w:b.width,h:b.height}, fit:getComputedStyle(v).objectFit, buffered:Array.from({length:v.buffered.length},(_,i)=>[v.buffered.start(i),v.buffered.end(i)]) } })()`)
  const stages = [], record = async label => { const s = await state(); stages.push({ label, state: { revision: s.revision, selectedIds: s.selectedIds, interactingVideoId: s.interactingVideoId, videoPlayback: s.videoPlayback, shapes: s.videoRecords?.filter(r => r.typeName === 'shape') }, video: await videoState() }); await writeFile(join(output, 'video-native.json'), JSON.stringify({ stages }, null, 2)); return s }
  await until(async () => (await videoState())?.ready >= 2)
  const before = await record('initial'), original = before.videoRecords.find(r => r.id === subject)
  check((await videoState()).fit === 'cover' && (await videoState()).box.w === 320, 'F19 视频外框或 cover 不符')
  check(await evaluate("document.querySelectorAll('[data-video-state=missing]').length === 2"), '缺资源/外链占位未显示')
  await evaluate(`window.__videoNode = document.querySelector('[data-shape-id="${subject}"] video'); window.__unrelatedMutations=0; window.__unrelatedObserver=new MutationObserver(list=>window.__unrelatedMutations+=list.length); window.__unrelatedObserver.observe(document.querySelector('[data-shape-id="shape:video-unrelated"]'),{attributes:true,childList:true,subtree:true,characterData:true}); void 0`)
  await click(200, 150); await click(200, 150, 2)
  await until(async () => (await state()).interactingVideoId === subject)
  check((await videoState()).controls, '双击未打开原生控件')
  const box = (await videoState()).box
  await click(Math.round(box.x + 24), Math.round(box.y + box.h - 48))
  await until(async () => !(await videoState()).paused && (await videoState()).time > .05, '原生播放')
  await record('playing')
  await click(Math.round(box.x + 24), Math.round(box.y + box.h - 48))
  await until(async () => (await videoState()).paused, '原生暂停')
  async function seek(fraction, id = subject) {
    const b = (await videoState(id)).box, x = Math.round(b.x + 24 + (b.w - 48) * fraction), y = Math.round(b.y + b.h - 22)
    await click(x, y)
    const target = (await videoState(id)).duration * fraction
    await until(async () => !(await videoState(id)).seeking && (await videoState(id)).ready >= 2 && Math.abs((await videoState(id)).time - target) < Math.max(.15, (await videoState(id)).duration * .01), '原生进度跳转')
    return videoState(id)
  }
  await seek(.8); await record('seeked')
  await click(1100, 650)
  check((await state()).interactingVideoId === null && !(await videoState()).controls, '点外面未退出视频互动')
  check((await state()).revision === before.revision, '播放操作写入画板版本')
  check(JSON.stringify((await state()).videoRecords.find(r => r.id === subject)) === JSON.stringify(original), '播放操作修改视频记录')
  await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:5,y:5,z:1.05});void 0'); await delay(80)
  check(await evaluate(`window.__videoNode === document.querySelector('[data-shape-id="${subject}"] video') && window.__unrelatedMutations === 0`), '相机或视频进度重新加载视频/重绘无关形状')
  await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:1});void 0'); await delay(80)
  if (files) {
    await click(200, 150)
    const altBox = await evaluate("(() => {const b=document.querySelector('[data-video-action=alt-text]').getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()")
    await click(altBox.x,altBox.y); await wc.insertText('合成彩色格视频')
    const saveBox = await evaluate("(() => {const b=document.querySelector('[data-video-action=save-alt-text]').getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()")
    await click(saveBox.x,saveBox.y)
    await until(async () => (await state()).videoRecords.find(r=>r.id===subject)?.props.altText === '合成彩色格视频', 'TL-F21替代文字')
    check(await evaluate(`document.querySelector('[data-shape-id="${subject}"] video').getAttribute('aria-label') === '合成彩色格视频'`), '替代文字没有提供无障碍名称')
    await record('alt-text')
    const button = await evaluate("(() => {const b=document.querySelector('[data-video-action=replace]').getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()")
    const chooser = new Promise(resolve => { const listener = (_event, method, params) => { if (method !== 'Page.fileChooserOpened') return; debug.removeListener('message', listener); resolve(params.backendNodeId) }; debug.on('message', listener) })
    await click(button.x, button.y)
    await debug.sendCommand('DOM.setFileInputFiles', { files: [files.portrait], backendNodeId: await chooser })
    await until(async () => (await state()).selectedShapes[0]?.w === 160, 'F20 替换')
    const replaced = await record('replaced'), next = replaced.videoRecords.find(r => r.id === subject)
    check(next.x === original.x && next.y === original.y && next.id === original.id && next.props.h === 320 && next.props.assetId !== original.props.assetId && next.props.time === 0, 'F20 替换位置/尺寸/资源身份不符')
    const asset = replaced.videoRecords.find(r => r.id === next.props.assetId)
    check(asset.props.src.startsWith('/c/') && !asset.props.src.startsWith('data:'), '新视频未以相对路径保存')
    // File events use only supplied synthetic bytes; no system clipboard APIs.
    const inject = async (filePath, mime, kind = 'drop') => {
      const bytes = (await readFile(filePath)).toString('base64')
      await evaluate(`(() => {const bytes=Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0)), f=new File([bytes],'synthetic.${mime === 'video/webm' ? 'webm' : mime === 'video/quicktime' ? 'mov' : 'mp4'}',{type:${JSON.stringify(mime)}}), dt=new DataTransfer();dt.items.add(f);const host=document.querySelector('#canvas');host.focus();host.dispatchEvent(${kind === 'drop' ? "new DragEvent('drop',{bubbles:true,cancelable:true,clientX:700,clientY:600,dataTransfer:dt})" : "new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt})"});})()`)
    }
    for (const [path, mime, kind] of [[files.mp4,'video/mp4','drop'], [files.webm,'video/webm','paste'], [files.mov,'video/quicktime','drop']]) {
      const count = (await state()).videoRecords.filter(r => r.typeName === 'shape').length
      await inject(path, mime, kind)
      await until(async () => (await state()).videoRecords.filter(r => r.typeName === 'shape').length === count + 1, `F07 ${mime} ${kind}`)
    }
    const count = (await state()).videoRecords.filter(r => r.typeName === 'shape').length
    await inject(files.bad, 'video/mp4')
    await until(() => evaluate("document.querySelector('#status').textContent.includes('损坏')"), '损坏视频错误提示')
    check((await state()).videoRecords.filter(r => r.typeName === 'shape').length === count, '坏视频留下形状')
    await evaluate(`window.__videoRealFetch=window.fetch; window.__videoUploadFailureUsed=0; window.fetch=(url,options)=>new URL(url,location.href).pathname==='/api/canvas/reference' ? (window.__videoUploadFailureUsed++,Promise.resolve(new Response(JSON.stringify({error:'合成上传失败'}),{status:503,headers:{'content-type':'application/json'}}))) : window.__videoRealFetch(url,options);void 0`)
    try {
      await inject(files.mp4, 'video/mp4')
      await until(() => evaluate("window.__videoUploadFailureUsed===1 && document.querySelector('#status').textContent.includes('合成上传失败')"), '上传失败反馈')
      check((await state()).videoRecords.filter(r=>r.typeName==='shape').length===count, '上传失败留下形状')
    } finally { await evaluate('window.fetch=window.__videoRealFetch;delete window.__videoRealFetch;void 0') }
    await record('file-imports')
    await inject(files.mp4, 'video/mp4')
    await until(async () => (await state()).videoRecords.filter(r => r.typeName === 'shape').length === count + 1, '小视频跳转夹具')
    const smallState = await state(), candidates = smallState.videoRecords.filter(r => r.typeName === 'shape' && r.type === 'video' && !['shape:video-0','shape:video-1','shape:video-2','shape:video-3'].includes(r.id))
    const small = candidates.find(r => { const asset = smallState.videoRecords.find(a => a.id === r.props.assetId); return asset?.props.mimeType === 'video/mp4' && asset.props.src.startsWith('/c/') && r.props.w === 320 })
    await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:${100-small.x},y:${100-small.y},z:1});void 0`); await delay(80)
    await click(200,150); await click(200,150,2)
    const activeSmall = (await state()).interactingVideoId
    const smallBox = (await videoState(activeSmall)).box
    if (!(await videoState(activeSmall)).paused) await click(Math.round(smallBox.x+24),Math.round(smallBox.y+smallBox.h-48))
    const smallMiddle = await seek(.5, activeSmall), smallEnd = await seek(.9, activeSmall)
    const sb = smallEnd.box
    if ((await videoState(activeSmall)).paused) await click(Math.round(sb.x+24),Math.round(sb.y+sb.h-48))
    await until(async () => !(await videoState(activeSmall)).paused)
    const smallPlayingSeek = await seek(.6, activeSmall)
    stages.push({ label: 'small-relative-seeks', middle:smallMiddle, end:smallEnd, playingSeek:smallPlayingSeek })
    await click(1100,650)
    if (files.large) {
      // A constrained download proves seeking while the 30+ MB file is not
      // already fully buffered. Upload itself keeps the normal local speed.
      await debug.sendCommand('Network.enable')
      await evaluate('window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:0,y:0,z:1});void 0'); await delay(80)
      await inject(files.large, 'video/mp4')
      await until(async () => (await state()).videoRecords.filter(r => r.typeName === 'shape').length === count + 2, '大视频插入')
      const s = await state(), large = s.videoRecords.find(r => r.typeName === 'shape' && r.type === 'video' && r.props.w === 640 && r.props.h === 360)
      check(large.props.w === 640 && large.props.h === 360, '大视频自然尺寸不符')
      const largeId = large.id
      await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:${100-large.x},y:${100-large.y},z:1});void 0`); await delay(80)
      // Reload via native browser reload under throughput limit. The persisted
      // source is unchanged, and the new media element starts with an empty buffer.
      await debug.sendCommand('Network.emulateNetworkConditions', { offline:false, latency:20, downloadThroughput:2*1024*1024, uploadThroughput:-1 })
      await new Promise(resolve => { wc.once('did-finish-load', resolve); wc.reload() }); await until(async () => (await state())?.ready, '大视频重载')
      await evaluate(`window.__HICANVAS_RENDERER_PREVIEW__.resetCamera({x:${100-large.x},y:${100-large.y},z:1});void 0`); await delay(80)
      await click(300, 200); await click(300, 200, 2)
      await until(async () => (await state()).interactingVideoId === largeId)
      const largeBox = (await videoState(largeId)).box
      if (!(await videoState(largeId)).paused) await click(Math.round(largeBox.x+24),Math.round(largeBox.y+largeBox.h-48))
      const loaded = await videoState(largeId)
      check(loaded.duration >= 60 && loaded.buffered.every(([, end]) => end < loaded.duration - 1), '大视频已全部缓冲，跳转样本无效')
      stages.push({ label: 'large-before-seeking', loaded }); await writeFile(join(output, 'video-native.json'), JSON.stringify({ stages }, null, 2))
      const middle = await seek(.5, largeId), end = await seek(.9, largeId)
      const b = end.box; if ((await videoState(largeId)).paused) await click(Math.round(b.x+24),Math.round(b.y+b.h-48)); await until(async () => !(await videoState(largeId)).paused)
      const playingSeek = await seek(.6, largeId)
      stages.push({ label:'large-relative-seeks', fileSize:(await readFile(files.large)).length, loaded, middle, end, playingSeek })
      await debug.sendCommand('Network.emulateNetworkConditions', { offline:false, latency:0, downloadThroughput:-1, uploadThroughput:-1 })
    }
  }
  await writeFile(join(output, 'video-native.json'), JSON.stringify({ stages }, null, 2))
  await writeFile(join(output, 'video-native.png'), (await wc.capturePage()).toPNG())
  return { stages: stages.map(stage => ({ label: stage.label, video: stage.video })), uploads: Boolean(files) }
}
