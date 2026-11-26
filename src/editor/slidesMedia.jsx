import {isInteractiveSlideClick} from '../../content-channel/index.js'
import { loadGeneratedFrame } from '../../renderer/index.js'
// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { useEditor } from "tldraw"
import { useEffect, useRef, useState } from "react"
import { hasCowartWidgetBridge, readCowartPageAsset } from "../cowartClient.js"
import { hydrateCowartHtmlDraftLocalImages, isCowartHtmlDraftDataUrl, cowartHtmlDraftAssetUrlFromVirtualUrl, blobFromBase64 } from './assets.jsx'
import { isCowartHtmlDraftEmbedShape, isImageShape } from './holderMeta.jsx'
const isInteractiveHtmlClick=isInteractiveSlideClick
function createSlidesFrameLoadHandler(frame) {
  let unsubscribe
  let disposed = false
  return {
    onLoad(event, onNavigate) {
      // A retired iframe can deliver load after its effect has released it.
      // Check before touching subscriptions owned by this page.
      if (disposed || frame.disposed) return
      unsubscribe?.()
      unsubscribe = null
      const channel = frame.bind(event.currentTarget, { slides: !!onNavigate })
      if (onNavigate) unsubscribe = channel.subscribeNavigation(onNavigate)
    },
    dispose() {
      disposed = true
      unsubscribe?.()
      unsubscribe = null
    }
  }
}
function CowartSlidesMedia({ onUnhandledHtmlClick, shape, title }) {
  const editor = useEditor()
  const [source, setSource] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let disposed = false
    let frame
    let frameLoad
    const controller = new AbortController()
    setSource(null)
    setError(null)
    async function loadSource() {
      if (isImageShape(shape)) {
        const asset = shape.props?.assetId ? editor.getAsset(shape.props.assetId) : null
        const assetSource = asset?.props?.src
        if (!asset || !assetSource) throw new Error('图片资源不可用')
        if (assetSource.startsWith('data:') || /^https?:\/\//.test(assetSource)) {
          return { kind: 'image', url: assetSource }
        }
        const resolvedUrl = await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true })
        if (!resolvedUrl) throw new Error('图片资源无法解析')
        return { kind: 'image', url: resolvedUrl }
      }
      if (isCowartHtmlDraftEmbedShape(shape)) {
        const directHtmlUrl = isCowartHtmlDraftDataUrl(shape.props.url) ? shape.props.url : null
        if (directHtmlUrl) {
          if (!hasCowartWidgetBridge()) return { kind: 'html-url', url: directHtmlUrl }
          const response = await window.fetch(directHtmlUrl)
          if (!response.ok) throw new Error(`HTML 草稿加载失败：${response.status}`)
          return {
            kind: 'html',
            htmlContent: await hydrateCowartHtmlDraftLocalImages(await response.text())
          }
        }
        const assetUrl =
          cowartHtmlDraftAssetUrlFromVirtualUrl(shape.meta?.cowartHtmlDraftAssetUrl) ||
          cowartHtmlDraftAssetUrlFromVirtualUrl(shape.props.url)
        if (!assetUrl) throw new Error('HTML 草稿资源不可用')
        if (hasCowartWidgetBridge()) {
          const pageAsset = await readCowartPageAsset(assetUrl)
          const htmlContent = await blobFromBase64(pageAsset.dataBase64, pageAsset.mimeType).text()
          return {
            kind: 'html',
            htmlContent: await hydrateCowartHtmlDraftLocalImages(htmlContent)
          }
        }
        const response = await window.fetch(assetUrl)
        if (!response.ok) throw new Error(`HTML 草稿加载失败：${response.status}`)
        return { kind: 'html', htmlContent: await response.text() }
      }
      throw new Error('不支持的 Slides 页面类型')
    }
    loadSource()
      .then(async (nextSource) => {
        if (disposed) return
        if (nextSource.kind === 'html' || nextSource.kind === 'html-url') {
          frame = await loadGeneratedFrame(nextSource.htmlContent, {
            sourceUrl: cowartHtmlDraftAssetUrlFromVirtualUrl(shape.meta?.cowartHtmlDraftAssetUrl) || cowartHtmlDraftAssetUrlFromVirtualUrl(shape.props.url) || undefined,
            directUrl: nextSource.kind === 'html-url' ? nextSource.url : undefined, signal: controller.signal
          })
          if (disposed) { frame.dispose(); return }
          frameLoad = createSlidesFrameLoadHandler(frame)
        }
        setSource({ ...nextSource, frame, frameLoad })
      })
      .catch((nextError) => {
        if (!disposed) setError(nextError instanceof Error ? nextError.message : '页面加载失败')
      })
    return () => {
      disposed = true
      controller.abort()
      frameLoad?.dispose()
      frame?.dispose()
    }
  }, [editor, shape.id, shape.props?.assetId, shape.props?.url, shape.meta?.cowartHtmlDraftAssetUrl, shape.meta?.cowartHtmlDraftContentHash])

  if (source?.kind === 'image') {
    return <img alt={title} className="cowart-slides-media" draggable={false} src={source.url} />
  }
  if (source?.kind === 'html' || source?.kind === 'html-url') {
    return (
      <iframe
        className="cowart-slides-media"
        frameBorder="0"
        onLoad={event => source.frameLoad.onLoad(event, onUnhandledHtmlClick)}
        sandbox=""
        {...source.frame?.attributes}
        tabIndex={-1}
        title={title}
      />
    )
  }
  return <div className="cowart-slides-media-status">{error || '正在加载…'}</div>
}
function CowartSlidesScaledMedia({ className = '', onUnhandledHtmlClick, shape, title }) {
  const containerRef = useRef(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const width = Math.max(1, Number(shape.props?.w) || 16)
  const height = Math.max(1, Number(shape.props?.h) || 9)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    function updateSize() {
      const bounds = container.getBoundingClientRect()
      setContainerSize((currentSize) => {
        if (currentSize.width === bounds.width && currentSize.height === bounds.height) {
          return currentSize
        }
        return { width: bounds.width, height: bounds.height }
      })
    }
    updateSize()
    const ResizeObserverClass = container.ownerDocument.defaultView?.ResizeObserver
    if (!ResizeObserverClass) return undefined
    const resizeObserver = new ResizeObserverClass(updateSize)
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [])
  const scale = Math.min(containerSize.width / width, containerSize.height / height)
  const scaledWidth = width * scale
  const scaledHeight = height * scale
  return (
    <span className={`cowart-slides-media-viewport ${className}`.trim()} ref={containerRef}>
      {scale > 0 && (
        <span
          className="cowart-slides-media-canvas"
          style={{
            height: `${height}px`,
            left: `${(containerSize.width - scaledWidth) / 2}px`,
            top: `${(containerSize.height - scaledHeight) / 2}px`,
            transform: `scale(${scale})`,
            width: `${width}px`
          }}
        >
          <CowartSlidesMedia
            onUnhandledHtmlClick={onUnhandledHtmlClick}
            shape={shape}
            title={title}
          />
        </span>
      )}
    </span>
  )
}
export { isInteractiveHtmlClick, CowartSlidesMedia, CowartSlidesScaledMedia, createSlidesFrameLoadHandler }
