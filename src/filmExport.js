import {openFilmExportSession} from './filmExportSession.js'
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeAudio, canEncodeVideo } from 'mediabunny'
import { installLegacyAudioExport, waitForFilmTask } from '../content-channel/index.js'
import { COWART_FILM_FPS } from './filmTimeline.js'
import { COWART_FILM_EXPORT_PIXEL_RATIO, filmExportDimensions } from './filmExportSize.js'

export { filmExportDimensions } from './filmExportSize.js'

export function withFilmExportBootstrap(html, duration) {
  // Serialize the existing audio hook for execution inside the content realm;
  // the parent never invokes it or obtains the child's Web Audio objects.
  const script = `<script>(${installLegacyAudioExport.toString()})(${JSON.stringify(duration)});<\/script>`
  // DOM parsing places the hook before any film script, including head scripts.
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.head.insertAdjacentHTML('afterbegin', script)
  return '<!doctype html>\n' + doc.documentElement.outerHTML
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
  let output, session, canvas, videoSource, audioSource
  try {
    checkCanceled()
    onProgress(0)
    session = await openFilmExportSession({html:withFilmExportBootstrap(html,duration),width,height,duration,sourceUrl},options)
    options=session.options
    const audio = await session.audio()
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
      const time = index / COWART_FILM_FPS
      let frame
      try {
        frame = await session.frame(index)
        context.fillStyle = '#fff'
        context.fillRect(0, 0, size.width, size.height)
        context.drawImage(frame, 0, 0, size.width, size.height)
        await waitForFilmTask(() => videoSource.add(time, Math.min(1 / COWART_FILM_FPS, duration - time), {
          keyFrame: index % (COWART_FILM_FPS * 2) === 0
        }), { ...options, label: '影片帧编码' })
      } finally {
        if (frame) frame.width = frame.height = 0
        context.clearRect(0,0,canvas.width,canvas.height)
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
    try{videoSource?.close()}catch{/* Already closed. */}
    try{audioSource?.close()}catch{/* Already closed. */}
    if(canvas)canvas.width=canvas.height=0
    await session?.dispose()
  }
}
