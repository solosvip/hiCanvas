import { getContentChannel, renderContentCapture } from '../content-channel/index.js'
import { createElement as h } from 'react'
import { Bookmark } from './bookmark.js'
import { describeEmbed, loadEmbedHtml } from './embed-content.js'
import { loadGeneratedFrame } from './content-host.js'
import { videoSource } from './video-source.js'
import { waitExport, exportImagePlaceholder } from './export-assets.js'
import { exportSize } from './export-bounds.js'

function requireDocument(doc) { if (!doc) throw new Error('媒体输出需要浏览器画布。') }
function canvasFor(doc, width, height) {
  requireDocument(doc)
  exportSize({ x: 0, y: 0, w: width, h: height }, { scale: 1 })
  const canvas = doc.createElement('canvas'); canvas.width = Math.ceil(width); canvas.height = Math.ceil(height)
  return canvas
}
function decodeMedia(node, event, signal) {
  return waitExport(new Promise((resolve, reject) => {
    const clean = () => { node.removeEventListener(event, loaded); node.removeEventListener('error', failed); signal.removeEventListener('abort', clean) }
    const loaded = () => { clean(); resolve() }
    const failed = () => { clean(); reject(new Error('媒体素材无法解码。')) }
    node.addEventListener(event, loaded, { once: true }); node.addEventListener('error', failed, { once: true })
    signal.addEventListener('abort', clean, { once: true })
  }), signal)
}
const mounted = (host, selector, shape) => [...(host?.querySelectorAll(selector) || [])].find(node => node.closest('[data-shape-id]')?.dataset.shapeId === shape.id || node.dataset.embedContent === shape.id)

async function imagePixels(source, doc, signal) {
  requireDocument(doc)
  const image = doc.createElement('img')
  let canvas
  try {
    image.src = source
    await waitExport(image.decode(), signal)
    canvas = canvasFor(doc, image.naturalWidth, image.naturalHeight)
    canvas.getContext('2d').drawImage(image, 0, 0)
    return canvas.toDataURL('image/png')
  } finally { image.removeAttribute('src'); if (canvas) canvas.width = canvas.height = 0 }
}

async function captureEmbed(shape, { document: doc, instances, signal, scale, cleanups }) {
  requireDocument(doc)
  const description = describeEmbed(shape)
  if (!description.source) throw new Error('外部嵌入不提供隔离截图通道，无法输出此对象。')
  const initial = instances.get(shape.id)
  let iframe = initial?.node, owned = false
  if (initial && (!iframe.isConnected || iframe.getAttribute('src') !== initial.src)) throw new Error('输出中的内容实例已更换。')
  if (!iframe) {
    const html = await loadEmbedHtml(description.source, { signal })
    let releaseError
    const fetcher = async (url, init) => {
      if (!init?.keepalive) return fetch(url, init)
      // loadGeneratedFrame deliberately revokes independently of export cancel.
      // Bound both the DELETE headers and its JSON body, even on a stalled host.
      const releaseSignal = AbortSignal.timeout(2000)
      try {
        const response = await waitExport(fetch(url, { ...init, signal: releaseSignal }), releaseSignal)
        const data = await waitExport(response.json(), releaseSignal)
        return { ok: response.ok, status: response.status, json: async () => data }
      } catch (error) { releaseError = error; throw error }
    }
    const frame = await waitExport(loadGeneratedFrame(html, { signal, fetcher, sourceUrl: description.source.startsWith('/') ? description.source : undefined }), signal)
    cleanups.push(async () => { await frame.dispose(); if (releaseError) throw new Error('输出临时实例释放失败或超过期限。', { cause: releaseError }) })
    signal.throwIfAborted()
    iframe = doc.createElement('iframe')
    const container = doc.createElement('div')
    // This is an owned initial instance, not the mounted/current instance.
    // Keep the child inside the viewport: Chromium suspends animation-frame
    // callbacks in distant iframes, including capture's settled-frame wait.
    Object.assign(container.style, { position: 'fixed', left: '0', top: '0', opacity: '0', width: `${shape.props.w}px`, height: `${shape.props.h}px`, pointerEvents: 'none' })
    container.setAttribute('aria-hidden', 'true')
    iframe.width = String(shape.props.w); iframe.height = String(shape.props.h)
    for (const [key, value] of Object.entries(frame.attributes)) iframe.setAttribute(key, value)
    const loaded = decodeMedia(iframe, 'load', signal)
    container.append(iframe); doc.body.append(container)
    cleanups.push(() => container.remove())
    await loaded
    const channel = frame.bind(iframe, { film: description.kind === '影片', duration: shape.meta?.cowartFilmDuration || 15, muted: true })
    owned = true
    if (description.kind === '影片') {
      await channel.request('pause', undefined, { signal })
      await channel.request('seek', 0, { signal })
    }
  }
  if (!getContentChannel(iframe)) throw new Error('隔离内容截图通道尚未就绪。')
  const canvas = await renderContentCapture(iframe, { width: shape.props.w, height: shape.props.h, pixelRatio: Math.max(1, scale) }, { signal })
  try {
    signal.throwIfAborted()
    if (!owned && (!iframe.isConnected || iframe.getAttribute('src') !== initial.src)) throw new Error('输出中的内容实例已更换。')
    return canvas.toDataURL('image/png')
  }
  finally { canvas.width = canvas.height = 0 }
}

async function captureVideo(shape, asset, { document: doc, instances, signal, scale, cleanups, stats }) {
  requireDocument(doc)
  const initial = instances.get(shape.id)
  let video = initial?.node, owned = false
  if (initial && (!video.isConnected || video.getAttribute('src') !== initial.src)) throw new Error('输出中的视频实例已更换。')
  if (!video) {
    const source = videoSource(asset?.props.src)
    if (!source) { stats.blockedResources++; throw new Error('视频不是当前文档的本机资源。') }
    video = doc.createElement('video'); owned = true
    video.muted = true; video.preload = 'auto'
    cleanups.push(() => { video.pause(); video.removeAttribute('src'); video.load(); video.remove() })
    const loaded = decodeMedia(video, 'loadeddata', signal)
    video.src = source; video.load(); await loaded
  }
  // Never set currentTime, play, pause or controls on an existing instance.
  if (video.readyState < 2) await decodeMedia(video, 'loadeddata', signal)
  signal.throwIfAborted()
  if (!owned && (!video.isConnected || video.getAttribute('src') !== initial.src)) throw new Error('输出中的视频实例已更换。')
  const canvas = canvasFor(doc, shape.props.w * scale, shape.props.h * scale)
  try {
    const context = canvas.getContext('2d'), ratio = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight)
    if (!Number.isFinite(ratio)) throw new Error('视频没有可输出的画面。')
    context.drawImage(video, (canvas.width - video.videoWidth * ratio) / 2, (canvas.height - video.videoHeight * ratio) / 2, video.videoWidth * ratio, video.videoHeight * ratio)
    return canvas.toDataURL('image/png')
  } finally { canvas.width = canvas.height = 0; if (owned) video.pause() }
}

async function captureBookmark(shape, scene, { document: doc, assets, signal, cleanups, ...options }) {
  requireDocument(doc)
  exportSize({ x: 0, y: 0, w: shape.props.w, h: shape.props.h }, { scale: options.scale })
  const asset = scene.records[shape.props.assetId], records = { ...scene.records }
  if (asset) {
    const props = { ...asset.props }
    for (const name of ['image', 'favicon']) if (props[name]) props[name] = await assets.image(props[name]) || exportImagePlaceholder
    records[asset.id] = { ...asset, props }
  }
  const tokens = doc.defaultView.getComputedStyle(options.host || doc.documentElement)
  const style = Object.fromEntries(['--color-surface', '--color-on-surface', '--font-body-md'].map(name => [name, tokens.getPropertyValue(name)]))
  const { renderToStaticMarkup } = await waitExport(import('react-dom/server.browser'), signal)
  const html = '<!doctype html>' + renderToStaticMarkup(h('html', { style }, h('body', { style: { margin: 0, overflow: 'hidden' } }, h(Bookmark, { shape, scene: { store: { get: id => records[id] } } }))))
  // Reuse the component's full card layout through the same isolated public
  // capture channel as generated content. No parent-side child DOM access.
  const draft = { ...shape, type: 'embed', props: { w: shape.props.w, h: shape.props.h, url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) }, meta: { cowartHtmlDraft: true } }
  return captureEmbed(draft, { ...options, document: doc, signal, cleanups, instances: new Map() })
}

export async function prepareExportMedia(scene, options) {
  const media = new Map(), { assets, signal } = options
  // Pin mounted identities before any asynchronous asset preparation. A remote
  // replacement must fail explicitly, rather than changing a fixed export.
  const instances = new Map()
  for (const shape of scene.shapes) {
    const node = shape.type === 'embed' ? mounted(options.host, 'iframe[data-embed-content]', shape) : shape.type === 'video' ? mounted(options.host, 'video', shape) : null
    if (node) instances.set(shape.id, { node, src: node.getAttribute('src') })
  }
  options = { ...options, instances }
  for (const shape of scene.shapes) {
    signal.throwIfAborted()
    try {
      if (shape.type === 'image') {
        const asset = scene.records[shape.props.assetId]
        const source = await assets.image(asset?.props.src)
        media.set(shape.id, source === null ? exportImagePlaceholder : await imagePixels(source, options.document, signal))
      } else if (shape.type === 'embed') media.set(shape.id, await captureEmbed(shape, options))
      else if (shape.type === 'video') media.set(shape.id, await captureVideo(shape, scene.records[shape.props.assetId], options))
      else if (shape.type === 'bookmark') media.set(shape.id, await captureBookmark(shape, scene, options))
    } catch (error) {
      if (!signal.aborted && !assets.stats.blockedResources && !assets.stats.failedResources) assets.stats.failedResources++
      throw error
    }
  }
  return media
}
