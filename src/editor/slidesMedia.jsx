// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { useEditor } from "tldraw"
import { useEffect, useRef, useState } from "react"
import { hasCowartWidgetBridge, readCowartPageAsset } from "../cowartClient.js"
import { hydrateCowartHtmlDraftLocalImages, isCowartHtmlDraftDataUrl, cowartHtmlDraftAssetUrlFromVirtualUrl, blobFromBase64 } from './assets.jsx'
import { isCowartHtmlDraftEmbedShape, isImageShape } from './holderMeta.jsx'
function isInteractiveHtmlClick(event) {
  if (event.defaultPrevented || event.cancelBubble) return true
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return true
  const interactiveSelector = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    'video',
    'audio',
    'canvas',
    '[contenteditable="true"]',
    '[onclick]',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="tab"]'
  ].join(',')
  const target = event.target
  if (target?.closest?.(interactiveSelector)) return true
  const win = target?.ownerDocument?.defaultView
  let element = target?.nodeType === 1 ? target : target?.parentElement
  while (element && element !== target?.ownerDocument?.documentElement) {
    if (win?.getComputedStyle(element).cursor === 'pointer') return true
    element = element.parentElement
  }
  return false
}
function CowartSlidesMedia({ onUnhandledHtmlClick, shape, title }) {
  const editor = useEditor()
  const iframeClickCleanupRef = useRef(null)
  const [source, setSource] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let disposed = false
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
      .then((nextSource) => {
        if (!disposed) setSource(nextSource)
      })
      .catch((nextError) => {
        if (!disposed) setError(nextError instanceof Error ? nextError.message : '页面加载失败')
      })
    return () => {
      disposed = true
    }
  }, [editor, shape.id, shape.props?.assetId, shape.props?.url, shape.meta?.cowartHtmlDraftAssetUrl, shape.meta?.cowartHtmlDraftContentHash])
  useEffect(
    () => () => {
      iframeClickCleanupRef.current?.()
      iframeClickCleanupRef.current = null
    },
    []
  )
  function handleHtmlFrameLoad(event) {
    iframeClickCleanupRef.current?.()
    iframeClickCleanupRef.current = null
    if (!onUnhandledHtmlClick) return
    try {
      const iframeDocument = event.currentTarget.contentDocument
      const iframeWindow = iframeDocument?.defaultView
      if (!iframeDocument || !iframeWindow) return
      const pendingTimers = new Set()
      function handleHtmlClick(clickEvent) {
        const timer = iframeWindow.setTimeout(() => {
          pendingTimers.delete(timer)
          if (!isInteractiveHtmlClick(clickEvent)) onUnhandledHtmlClick()
        }, 0)
        pendingTimers.add(timer)
      }
      iframeDocument.addEventListener('click', handleHtmlClick)
      iframeClickCleanupRef.current = () => {
        iframeDocument.removeEventListener('click', handleHtmlClick)
        for (const timer of pendingTimers) iframeWindow.clearTimeout(timer)
        pendingTimers.clear()
      }
    } catch (_error) {
      // Cross-origin HTML keeps its own interactions; keyboard navigation remains available.
    }
  }
  if (source?.kind === 'image') {
    return <img alt={title} className="cowart-slides-media" draggable={false} src={source.url} />
  }
  if (source?.kind === 'html' || source?.kind === 'html-url') {
    return (
      <iframe
        className="cowart-slides-media"
        frameBorder="0"
        onLoad={handleHtmlFrameLoad}
        sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
        src={source.kind === 'html-url' ? source.url : undefined}
        srcDoc={source.kind === 'html' ? source.htmlContent : undefined}
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
export { isInteractiveHtmlClick, CowartSlidesMedia, CowartSlidesScaledMedia }
