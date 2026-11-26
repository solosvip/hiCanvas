import { loadGeneratedFrame } from '../../renderer/index.js'
// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { EmbedShapeUtil, FrameShapeUtil, HTMLContainer, DEFAULT_EMBED_DEFINITIONS, toDomPrecision, useEditor, useIsEditing, DefaultSpinner } from "tldraw"
import { attachCowartFilmController } from "../filmPlayback.js"
import { getFilmOptions } from "../filmConfig.js"
import { useCallback, useEffect, useState } from "react"
import { hasCowartWidgetBridge, readCowartPageAsset, updateCowartHtmlDraft } from "../cowartClient.js"
import { isCowartAiHolderShape, isAiImageAspectLocked, isCowartFilmShape, isCowartHtmlDraftEmbedShape } from './holderMeta.jsx'
import { AI_DRAFT_HOLDER_LABEL, AI_IMAGE_HOLDER_DEFAULT_W, AI_IMAGE_HOLDER_DEFAULT_H, COWART_HTML_DRAFT_EMBED_TYPE, AI_FILM_LABEL, COWART_FILM_STATUS_EVENT, HTML_DRAFT_ASSET_RETRY_DELAYS_MS } from './configuration.jsx'
import { isCowartHtmlDraftDataUrl, cowartHtmlDraftAssetUrlFromVirtualUrl, cowartHtmlDraftVirtualUrl, cowartHtmlDraftIframes, cowartHtmlDraftDomEditSessions, cowartFilmControllers, cowartFilmStatuses, hydrateCowartHtmlDraftLocalImages, blobFromBase64 } from './assets.jsx'
import { waitForHtmlDraftDocument, cowartHtmlDraftDataUrl, createCowartHtmlDraftDomEditorSession } from './htmlEditor.jsx'
import { CowartFilmPlaybackControls } from './htmlToolbar.jsx'
class CowartFrameShapeUtil extends FrameShapeUtil {
  component(shape) {
    const task = shape.meta?.hicanvasGeneration
    const labels = { queued: '排队中', running: '正在生成', pending: '已发送至 Agent', working: 'Agent 正在制作', waiting: '等待 Agent 连接', failed: '生成失败', interrupted: '生成已中断', saved: '图片已保存' }
    const label = labels[task?.status]
    return <>{super.component(shape)}{label && <HTMLContainer className="hicanvas-generation-state" aria-live="polite">
      <div className="hicanvas-generation-state__content">
        {['queued', 'running', 'pending', 'working'].includes(task.status) && <DefaultSpinner />}
        <span>{label}</span>
        {task.error && <small>{task.error}</small>}
      </div>
    </HTMLContainer>}</>
  }
  isAspectRatioLocked(shape) {
    if (isCowartAiHolderShape(shape)) {
      return isAiImageAspectLocked(shape)
    }
    return super.isAspectRatioLocked(shape)
  }
}
const COWART_HTML_DRAFT_EMBED_DEFINITION = {
  type: COWART_HTML_DRAFT_EMBED_TYPE,
  title: AI_DRAFT_HOLDER_LABEL,
  hostnames: ['cowart.local'],
  width: AI_IMAGE_HOLDER_DEFAULT_W,
  height: AI_IMAGE_HOLDER_DEFAULT_H,
  minWidth: 160,
  minHeight: 120,
  doesResize: true,
  backgroundColor: '#ffffff',
  embedOnPaste: false,
  toEmbedUrl(url) {
    if (isCowartHtmlDraftDataUrl(url)) return url
    return cowartHtmlDraftAssetUrlFromVirtualUrl(url) ?? undefined
  },
  fromEmbedUrl(url) {
    if (isCowartHtmlDraftDataUrl(url)) return url
    const assetUrl = cowartHtmlDraftAssetUrlFromVirtualUrl(url)
    return assetUrl ? cowartHtmlDraftVirtualUrl(assetUrl) : undefined
  }
}
function CowartHtmlDraftEmbed({ shape }) {
  const editor = useEditor()
  const directHtmlUrl = isCowartHtmlDraftDataUrl(shape.props.url) ? shape.props.url : null
  const draftAssetUrl =
    cowartHtmlDraftAssetUrlFromVirtualUrl(shape.meta?.cowartHtmlDraftAssetUrl) ||
    cowartHtmlDraftAssetUrlFromVirtualUrl(shape.props.url)
  const isEditing = useIsEditing(shape.id)
  const [htmlSource, setHtmlSource] = useState(null)
  const [htmlFrame, setHtmlFrame] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [frameLoadVersion, setFrameLoadVersion] = useState(0)
  const handleIframeRef = useCallback(
    (iframe) => {
      if (iframe) {
        cowartHtmlDraftIframes.set(shape.id, iframe)
      } else if (cowartHtmlDraftIframes.get(shape.id)) {
        cowartHtmlDraftIframes.delete(shape.id)
      }
    },
    [shape.id]
  )
  useEffect(() => {
    setHtmlSource(null)
    setHtmlFrame(null)
    setLoadError(null)
    // Read saved drafts lazily through MCP; still support legacy inline drafts
    // while they are being migrated to compact file-backed records.
    const shouldReadPageAsset = !directHtmlUrl && draftAssetUrl && hasCowartWidgetBridge()
    const browserSourceUrl = directHtmlUrl || (!shouldReadPageAsset && draftAssetUrl)
    if (!shouldReadPageAsset && !browserSourceUrl) return undefined
    let isDisposed = false
    let frame
    const controller = new AbortController()
    async function readDraftAssetWithRetry() {
      let lastError = null
      for (const delay of HTML_DRAFT_ASSET_RETRY_DELAYS_MS) {
        if (isDisposed) return null
        if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay))
        if (isDisposed) return null
        try {
          const pageAsset = await readCowartPageAsset(draftAssetUrl, { signal: controller.signal })
          return blobFromBase64(pageAsset.dataBase64, pageAsset.mimeType).text()
        } catch (error) {
          if (error.name === 'AbortError') throw error
          lastError = error
        }
      }
      throw lastError || new Error('HTML 草稿加载失败')
    }
    const htmlSourcePromise = shouldReadPageAsset
      ? readDraftAssetWithRetry()
      : window.fetch(browserSourceUrl, { signal: controller.signal }).then((response) => {
          if (!response.ok) throw new Error(`HTML 草稿加载失败：${response.status}`)
          return response.text()
        })
    htmlSourcePromise
      .then((htmlContent) => {
        if (isDisposed || htmlContent === null) return null
        return hydrateCowartHtmlDraftLocalImages(htmlContent, { signal: controller.signal })
      })
      .then(async (htmlContent) => {
        if (isDisposed || htmlContent === null) return
        frame = await loadGeneratedFrame(htmlContent, { sourceUrl: draftAssetUrl || undefined, signal: controller.signal })
        if (isDisposed) { frame.dispose(); return }
        setHtmlFrame(frame)
        setHtmlSource(htmlContent)
      })
      .catch((error) => {
        if (isDisposed) return
        console.warn('Cowart could not load HTML draft asset.', error)
        setLoadError(error instanceof Error ? error.message : 'HTML 草稿加载失败')
      })
    return () => {
      isDisposed = true
      controller.abort()
      frame?.dispose()
    }
  }, [directHtmlUrl, draftAssetUrl, shape.meta?.cowartHtmlDraftContentHash])
  useEffect(() => {
    if (!isCowartFilmShape(shape) || !htmlSource || !frameLoadVersion) return undefined
    const iframe = cowartHtmlDraftIframes.get(shape.id)
    if (!iframe || !htmlFrame?.bind && !iframe.contentDocument?.body) return undefined
    const options = getFilmOptions(shape)
    const playbackOptions = {
      duration: options.duration,
      muted: options.muted,
      onStatus(status) {
        cowartFilmStatuses.set(shape.id, status)
        window.dispatchEvent(new CustomEvent(COWART_FILM_STATUS_EVENT, { detail: { shapeId: shape.id, status } }))
      }
    }
    const controller = htmlFrame?.bind
      ? htmlFrame.bind(iframe,{...options,film:true}).attachFilmController(playbackOptions)
      : attachCowartFilmController(iframe,playbackOptions)
    cowartFilmControllers.set(shape.id, controller)
    return () => {
      controller.dispose()
      if (cowartFilmControllers.get(shape.id) === controller) cowartFilmControllers.delete(shape.id)
      cowartFilmStatuses.delete(shape.id)
    }
  }, [shape.id, shape.meta?.cowartFilm, htmlSource, htmlFrame, frameLoadVersion])
  useEffect(() => {
    if (!isCowartFilmShape(shape)) return
    const muted = shape.meta?.cowartFilmMuted === true
    if (cowartFilmStatuses.get(shape.id)?.muted !== muted) {
      cowartFilmControllers.get(shape.id)?.command('mute', muted)
    }
  }, [shape.id, shape.meta?.cowartFilm, shape.meta?.cowartFilmMuted, frameLoadVersion])
  const persistDomEdits = useCallback(
    async (htmlContent) => {
      await updateCowartHtmlDraft({ draftShapeId: shape.id, htmlContent }, {
        applyResult(result) {
          const latestShape = editor.getShape(shape.id)
          if (!isCowartHtmlDraftEmbedShape(latestShape)) return false
          editor.updateShape({
            id: shape.id,
            type: 'embed',
            meta: {
              ...latestShape.meta,
              ...(result?.assetUrl ? { cowartHtmlDraftAssetUrl: result.assetUrl } : {}),
              ...(result?.contentHash ? { cowartHtmlDraftContentHash: result.contentHash } : {})
            },
            props: { url: result?.assetUrl ? cowartHtmlDraftVirtualUrl(result.assetUrl) : cowartHtmlDraftDataUrl(htmlContent) }
          })
          return true
        }
      })
    },
    [editor, shape.id]
  )
  const exitDomEditing = useCallback(() => {
    editor.setEditingShape(null)
    editor.setCurrentTool('select')
  }, [editor])
  useEffect(() => {
    if (!isEditing || !htmlSource) return undefined
    let disposed = false
    let session = null
    waitForHtmlDraftDocument(shape.id)
      .then((iframeDocument) => {
        if (disposed) return
        session = createCowartHtmlDraftDomEditorSession(iframeDocument, {
          onSave: persistDomEdits,
          onRequestExit: exitDomEditing
        })
        cowartHtmlDraftDomEditSessions.set(shape.id, session)
      })
      .catch((error) => console.error('Cowart could not start HTML DOM editing.', error))
    return () => {
      disposed = true
      if (!session) return
      if (cowartHtmlDraftDomEditSessions.get(shape.id) === session) {
        cowartHtmlDraftDomEditSessions.delete(shape.id)
      }
      session
        .dispose({ save: true })
        .catch((error) => console.error('Cowart could not save HTML DOM edits.', error))
    }
  }, [exitDomEditing, frameLoadVersion, htmlSource, isEditing, persistDomEdits, shape.id])
  return (
    <HTMLContainer className={`cowart-html-draft-container${isCowartFilmShape(shape) ? ' cowart-film-container' : ''}`} id={shape.id}>
      {htmlSource ? (
        <iframe
          ref={handleIframeRef}
          className="cowart-html-draft-frame"
          data-cowart-html-draft-shape-id={shape.id}
          draggable={false}
          frameBorder="0"
          height={toDomPrecision(shape.props.h)}
          onLoad={(event) => { htmlFrame?.bind?.(event.currentTarget,{...getFilmOptions(shape),film:isCowartFilmShape(shape)}); setFrameLoadVersion((version) => version + 1) }}
          referrerPolicy="no-referrer"
          sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
          {...htmlFrame?.attributes}
          tabIndex={isEditing ? 0 : -1}
          title={isCowartFilmShape(shape) ? AI_FILM_LABEL : AI_DRAFT_HOLDER_LABEL}
          allow={isCowartFilmShape(shape) ? "autoplay" : undefined}
          width={toDomPrecision(shape.props.w)}
          style={{
            pointerEvents: isEditing ? 'auto' : 'none',
            zIndex: isEditing ? '' : '-1'
          }}
        />
      ) : (
        <div
          className="cowart-html-draft-placeholder"
          style={{
            width: toDomPrecision(shape.props.w),
            height: toDomPrecision(shape.props.h)
          }}
        >
          <span>{loadError || 'HTML 草稿加载中'}</span>
        </div>
      )}
      {isCowartFilmShape(shape) && (
        <CowartFilmPlaybackControls draftShapeId={shape.id} isEditing={isEditing} isLocked={shape.isLocked} />
      )}
    </HTMLContainer>
  )
}
const CowartConfiguredEmbedShapeUtil = EmbedShapeUtil.configure({
  embedDefinitions: [COWART_HTML_DRAFT_EMBED_DEFINITION, ...DEFAULT_EMBED_DEFINITIONS]
})
class CowartEmbedShapeUtil extends CowartConfiguredEmbedShapeUtil {
  component(shape) {
    if (isCowartHtmlDraftEmbedShape(shape)) {
      return <CowartHtmlDraftEmbed shape={shape} />
    }
    return super.component(shape)
  }
}
const cowartShapeUtils = [CowartFrameShapeUtil, CowartEmbedShapeUtil]
export { CowartFrameShapeUtil, COWART_HTML_DRAFT_EMBED_DEFINITION, CowartHtmlDraftEmbed, CowartConfiguredEmbedShapeUtil, CowartEmbedShapeUtil, cowartShapeUtils }
