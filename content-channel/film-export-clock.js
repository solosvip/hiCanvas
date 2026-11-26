export function installLegacyAudioExport(duration) {
  const contexts = []
  const NativeOffline = window.OfflineAudioContext || window.webkitOfflineAudioContext
  const rate = 48000
  const length = Math.ceil(duration * rate)
  let audioError
  if (NativeOffline) {
    window.AudioContext = window.webkitAudioContext = function () {
      const context = new NativeOffline(2, length, rate)
      contexts.push(context)
      return new Proxy(context, {
        get(target, key) {
          if (key === 'state') return 'running'
          if (key === 'resume' || key === 'suspend' || key === 'close') return () => Promise.resolve()
          const value = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        }
      })
    }
  }
  window.addEventListener('unhandledrejection', (event) => { audioError = event.reason })
  // Let font/image/library initialization finish on the real browser clock.
  // Freeze only after readiness; each seek supplies the requested frame time.
  const nativeNow = window.performance.now.bind(window.performance)
  const pending = new Map()
  const channel = new MessageChannel()
  let nextId = 0
  let frozen = false, frameTime = 0
  // Message tasks yield to initialization/audio work, without background RAF
  // throttling or microtask starvation from legacy playback loops.
  channel.port1.onmessage = (event) => {
    const callback = pending.get(event.data)
    pending.delete(event.data)
    callback?.(frozen ? frameTime * 1000 : nativeNow())
  }
  window.requestAnimationFrame = (callback) => {
    const id = ++nextId
    pending.set(id, callback)
    channel.port2.postMessage(id)
    return id
  }
  window.cancelAnimationFrame = (id) => pending.delete(id)
  Object.defineProperty(window.performance, 'now', { value: () => frozen ? frameTime * 1000 : nativeNow(), configurable: true })
  window.__cowartSetExportTime = (time) => {
    frozen = true
    frameTime = time
    pending.clear()
  }
  window.__cowartExportPaint = () => new Promise((resolve) => window.requestAnimationFrame(() => {
    document.documentElement.getBoundingClientRect()
    resolve()
  }))
  window.__cowartDisposeExport = () => { pending.clear(); channel.port1.close(); channel.port2.close() }
  window.__cowartRenderLegacyAudio = async (film) => {
    if (!NativeOffline) throw new Error('当前环境不支持离线音频渲染。')
    await film.pause()
    await film.seek(0)
    await film.setMuted(false)
    await film.play()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (audioError) throw audioError
    if (!contexts.length) throw new Error('影片没有可导出的音轨，请重新生成包含 renderAudio 接口的影片。')
    const buffers = await Promise.all(contexts.map((context) => context.startRendering()))
    await film.pause()
    const result = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: rate })
    for (const buffer of buffers) {
      for (let channel = 0; channel < 2; channel++) {
        const source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1))
        const target = result.getChannelData(channel)
        for (let i = 0; i < length; i++) target[i] += source[i] || 0
      }
    }
    return result
  }
}
