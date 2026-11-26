import {openFilmExportSession} from './filmExportSession.js'
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeAudio, canEncodeVideo } from 'mediabunny'
import { renderHtmlDraftDocument, installLegacyAudioExport } from '../content-channel/index.js'
import { COWART_FILM_FPS } from './filmTimeline.js'
import { prepareFilmAssets, seekFilmFrame, waitForFilmAPI, waitForFilmTask } from './filmFrameReady.js'
import { createFilmVideoFrames } from './filmVideoFrames.js'
import { COWART_FILM_EXPORT_PIXEL_RATIO, filmExportDimensions } from './filmExportSize.js'

export { filmExportDimensions } from './filmExportSize.js'

// Runs only in an isolated export iframe. Existing score-based films can export
// their Web Audio graph without recording the desktop or playing audible sound.

export function withFilmExportBootstrap(html, duration) {
  const script = `<script>(${installLegacyAudioExport.toString()})(${JSON.stringify(duration)});<\/script>`
  // DOM parsing places the hook before any film script, including head scripts.
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.head.insertAdjacentHTML('afterbegin', script)
  return '<!doctype html>\n' + doc.documentElement.outerHTML
}

async function createExportFrame(html, width, height, duration, options) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;border:0;pointer-events:none;`
  try {
    await waitForFilmTask(() => new Promise((resolve) => {
      iframe.onload = resolve
      iframe.srcdoc = withFilmExportBootstrap(html, duration)
      document.body.append(iframe)
    }), { ...options, label: '影片加载' })
    await prepareFilmAssets(iframe.contentDocument, options)
    return iframe
  } catch (error) {
    iframe.contentWindow.__cowartDisposeExport?.()
    iframe.remove()
    throw error
  }
}

export async function renderCowartFilmMp4({ html, width, height, duration, onProgress = () => {}, signal, taskTimeout = 15000, sourceUrl }) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new Error('影片时长必须为 1–120 秒。')
  const size = filmExportDimensions(width, height)
  const videoQuality = new Quality({ bitrate: 5_000_000 * COWART_FILM_EXPORT_PIXEL_RATIO ** 2 })
  const audioQuality = new Quality({ bitrate: 192_000 })
  let options = { signal, timeout: taskTimeout }
  if (!await waitForFilmTask(() => canEncodeVideo('avc', { ...size, frameRate: COWART_FILM_FPS, quality: videoQuality }), options)) {
    throw new Error('当前浏览器不支持 H.264 MP4 编码，请使用支持 WebCodecs 的新版浏览器导出。')
  }
  if (!await waitForFilmTask(() => canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, quality: audioQuality }), options)) {
    throw new Error('当前浏览器不支持 AAC 音频编码，无法导出带音乐的 MP4。')
  }
  const checkCanceled = () => { session?.check(); if (signal?.aborted) throw new DOMException('已取消影片导出。', 'AbortError') }
  let iframe, output, videos, session, canvas, videoSource, audioSource
  try {
    checkCanceled()
    onProgress(0)
    session = await openFilmExportSession({html:withFilmExportBootstrap(html,duration),width,height,duration,sourceUrl},options)
    if(session)options=session.options
    else iframe=await createExportFrame(html,width,height,duration,options)
    const film = session ? null : await waitForFilmAPI(iframe.contentWindow, options)
    if (!session && (!Number.isFinite(film.duration) || Math.abs(film.duration - duration) > 0.000001)) {
      throw new Error('影片接口时长与画布设置不一致，请更新影片后导出。')
    }
    if(!session){
      await waitForFilmTask(() => film.pause(), options)
      iframe.contentWindow.__cowartSetExportTime(0)
    }
    const audio = session ? await session.audio() : await waitForFilmTask(() => typeof film.renderAudio === 'function'
      ? film.renderAudio({ sampleRate: 48000, numberOfChannels: 2 })
      : iframe.contentWindow.__cowartRenderLegacyAudio(film), { ...options, label: '影片音轨渲染' })
    if (!audio?.getChannelData || Math.abs(audio.duration - duration) > 0.05) throw new Error('影片音轨无效或时长不匹配。')
    // Normalize to the encoder configuration, including mono/custom-rate scores.
    const offline = new OfflineAudioContext(2, Math.ceil(duration * 48000), 48000)
    const source = offline.createBufferSource()
    source.buffer = audio
    source.connect(offline.destination)
    source.start(0)
    const soundtrack = await waitForFilmTask(() => offline.startRendering(), { ...options, label: '影片音轨混音' })
    let audible = false
    for (let channel = 0; channel < soundtrack.numberOfChannels && !audible; channel++) {
      audible = soundtrack.getChannelData(channel).some((sample) => Math.abs(sample) > 0.0001)
    }
    if (!audible) throw new Error('未获得影片音乐或音效，请重新生成包含完整 renderAudio 音轨的影片。')
    checkCanceled()
    if(!session){
      await waitForFilmTask(() => film.pause(), options)
      await waitForFilmTask(() => film.setMuted(true), options)
      videos=createFilmVideoFrames({...options,pixelRatio:COWART_FILM_EXPORT_PIXEL_RATIO})
    }
    canvas = document.createElement('canvas')
    Object.assign(canvas, size)
    const context = canvas.getContext('2d')
    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
    videoSource = new CanvasSource(canvas, { codec: 'avc', quality: videoQuality })
    audioSource = new AudioBufferSource({ codec: 'aac', quality: audioQuality })
    output.addVideoTrack(videoSource, { frameRate: COWART_FILM_FPS })
    output.addAudioTrack(audioSource)
    await waitForFilmTask(() => output.start(), { ...options, label: '影片编码启动' })
    await waitForFilmTask(() => audioSource.add(soundtrack), { ...options, label: '影片音频编码' })
    audioSource.close()
    const frames = Math.ceil(duration * COWART_FILM_FPS)
    for (let index = 0; index < frames; index++) {
      checkCanceled()
      const time = session ? index / COWART_FILM_FPS : await seekFilmFrame(iframe, film, index / COWART_FILM_FPS, options)
      const videoFrames = session ? new Map() : await videos.render(iframe.contentDocument)
      let frame
      try {
        frame = session ? await session.frame(index) : await waitForFilmTask(() => renderHtmlDraftDocument(iframe.contentDocument, {
          width, height, pixelRatio: COWART_FILM_EXPORT_PIXEL_RATIO, freezeAtCurrentFrame: true, videoFrames
        }), { ...options, label: '影片帧截图' })
        context.fillStyle = '#fff'
        context.fillRect(0, 0, size.width, size.height)
        context.drawImage(frame, 0, 0, size.width, size.height)
        await waitForFilmTask(() => videoSource.add(time, Math.min(1 / COWART_FILM_FPS, duration - time), {
          keyFrame: index % (COWART_FILM_FPS * 2) === 0
        }), { ...options, label: '影片帧编码' })
      } finally {
        if (frame) frame.width = frame.height = 0
        if(session)context.clearRect(0,0,canvas.width,canvas.height)
        for (const canvas of videoFrames.values()) canvas.width = canvas.height = 0
      }
      onProgress((index + 1) / frames * 0.95)
    }
    videoSource.close()
    await waitForFilmTask(() => output.finalize(), { ...options, label: 'MP4 封装' })
    checkCanceled()
    onProgress(1)
    return new Blob([output.target.buffer], { type: 'video/mp4' })
  } catch (error) {
    if (output && output.state !== 'finalized') await output.cancel().catch(() => {})
    session?.check()
    throw error
  } finally {
    videos?.dispose()
    try{videoSource?.close()}catch{/* Already closed. */}
    try{audioSource?.close()}catch{/* Already closed. */}
    if(canvas)canvas.width=canvas.height=0
    await session?.dispose()
    try { iframe?.contentWindow.CowartFilm?.pause() } catch { /* Unloaded iframe. */ }
    iframe?.contentWindow.__cowartDisposeExport?.()
    iframe?.remove()
  }
}
