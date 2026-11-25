// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { Box, TldrawUiButtonIcon, TldrawUiContextualToolbar, TldrawUiToolbarButton, useEditor, useValue } from "tldraw"
import { Check, ChevronDown, Download, FileCode, Film, Image as ImageIcon, Play } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { COWART_EXPORT_LABEL, COWART_EXPORT_IMAGE_LABEL, COWART_EXPORT_HTML_LABEL, ANNOTATION_EDIT_STATUS_RESET_MS, AI_SLIDES_PRESENT_LABEL, COWART_OPEN_SLIDES_EVENT, HTML_DRAFT_ANNOTATION_EDIT_LABEL } from './configuration.jsx'
import { getAiSlidesItems } from './slidesLayout.jsx'
import { exportCowartSlides } from './exports.jsx'
import { sendAiSlidesAnnotationEditRequest } from './htmlAnnotations.jsx'
function CowartExportMenu({ disabled = false, onExportHtml, onExportImage, onExportFilm, targetKey }) {
  const editor = useEditor()
  const menuRef = useRef(null)
  const [isOpen, setIsOpen] = useState(false)
  const [status, setStatus] = useState('idle')
  const [progress, setProgress] = useState(null)
  const [exportError, setExportError] = useState(null)
  const exportAbortRef = useRef(null)
  useEffect(() => {
    setIsOpen(false)
    setStatus('idle')
    setProgress(null)
    setExportError(null)
    return () => exportAbortRef.current?.abort()
  }, [targetKey])
  useEffect(() => {
    if (!isOpen) return undefined
    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) setIsOpen(false)
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    const doc = editor.getContainerDocument()
    doc.addEventListener('pointerdown', handlePointerDown, true)
    doc.addEventListener('keydown', handleKeyDown, true)
    return () => {
      doc.removeEventListener('pointerdown', handlePointerDown, true)
      doc.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [editor, isOpen])
  useEffect(() => {
    if (status !== 'sent') return undefined
    const timer = window.setTimeout(() => setStatus('idle'), ANNOTATION_EDIT_STATUS_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [status])
  async function handleExport(exporter) {
    if (disabled || status === 'sending') return
    setIsOpen(false)
    setStatus('sending')
    setProgress(null)
    setExportError(null)
    const controller = new AbortController()
    exportAbortRef.current = controller
    try {
      await exporter(setProgress, controller.signal)
      if (controller.signal.aborted) return
      setStatus('sent')
    } catch (error) {
      if (controller.signal.aborted) return
      console.error(error)
      setExportError(error instanceof Error ? error.message : '导出失败，请重试')
      setStatus('error')
    } finally {
      if (exportAbortRef.current === controller) exportAbortRef.current = null
    }
  }
  const title = status === 'sending'
    ? progress === null ? '正在导出' : `正在渲染影片 ${Math.round(progress * 100)}%`
    : status === 'sent'
      ? '导出完成'
      : status === 'error'
        ? exportError || '导出失败，请重试'
        : COWART_EXPORT_LABEL
  return (
    <div className="cowart-export-menu" ref={menuRef}>
      <TldrawUiToolbarButton
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={title}
        className="cowart-export-trigger"
        data-status={status}
        data-testid={`tool.cowart-export-${targetKey}`}
        disabled={disabled || status === 'sending'}
        onClick={() => setIsOpen((open) => !open)}
        title={title}
        type="icon"
      >
        {status === 'sent' ? (
          <Check aria-hidden="true" size={16} strokeWidth={2.2} />
        ) : (
          <Download aria-hidden="true" size={16} strokeWidth={2} />
        )}
        <span className="cowart-slides-toolbar-label">{status === 'sending' ? title : COWART_EXPORT_LABEL}</span>
        <ChevronDown aria-hidden="true" className="cowart-export-chevron" size={13} strokeWidth={2} />
      </TldrawUiToolbarButton>
      {isOpen && (
        <div aria-label="导出格式" className="cowart-ai-slides-page-count-popover cowart-export-popover" role="menu">
          {onExportFilm && <button
            className="cowart-ai-slides-page-count-option"
            onClick={() => handleExport(onExportFilm)} role="menuitem" type="button"
          >
            <Film aria-hidden="true" className="is-visible" size={14} strokeWidth={2} />
            <span>导出为影片</span>
          </button>}
          {onExportImage && <button
            className="cowart-ai-slides-page-count-option"
            onClick={() => handleExport(onExportImage)}
            role="menuitem"
            type="button"
          >
            <ImageIcon aria-hidden="true" className="is-visible" size={14} strokeWidth={2} />
            <span>{COWART_EXPORT_IMAGE_LABEL}</span>
          </button>}
          <button
            className="cowart-ai-slides-page-count-option"
            onClick={() => handleExport(onExportHtml)}
            role="menuitem"
            type="button"
          >
            <FileCode aria-hidden="true" className="is-visible" size={14} strokeWidth={2} />
            <span>{COWART_EXPORT_HTML_LABEL}</span>
          </button>
        </div>
      )}
      {status === 'error' && exportError && <div className="cowart-export-error" role="alert">{exportError}</div>}
    </div>
  )
}
function CowartSlidesToolbar({ slidesShapeId }) {
  const editor = useEditor()
  const showToolbar = useValue(
    'cowart show ai slides toolbar',
    () => editor.isInAny('select.idle', 'select.pointing_shape'),
    [editor]
  )
  const getSelectionBounds = useCallback(() => {
    const fullBounds = editor.getSelectionScreenBounds()
    if (!fullBounds) return undefined
    return new Box(fullBounds.x, fullBounds.y, fullBounds.width, 0)
  }, [editor])
  const hasContent = useValue(
    'cowart selected ai slides has content',
    () => getAiSlidesItems(editor, slidesShapeId).length > 0,
    [editor, slidesShapeId]
  )
  if (!showToolbar) return null
  function openSlidesViewer() {
    editor.getContainerDocument().dispatchEvent(
      new CustomEvent(COWART_OPEN_SLIDES_EVENT, {
        detail: { slidesShapeId }
      })
    )
  }
  return (
    <TldrawUiContextualToolbar
      className="tlui-media__toolbar cowart-slides-toolbar"
      getSelectionBounds={getSelectionBounds}
      label="AI 幻灯片工具栏"
    >
      <CowartExportMenu
        disabled={!hasContent}
        onExportHtml={() => exportCowartSlides(editor, slidesShapeId, 'html')}
        onExportImage={() => exportCowartSlides(editor, slidesShapeId, 'image')}
        targetKey={`slides-${slidesShapeId}`}
      />
      <TldrawUiToolbarButton
        aria-label={AI_SLIDES_PRESENT_LABEL}
        className="cowart-slides-present-button"
        data-testid="tool.cowart-slides-present"
        onClick={openSlidesViewer}
        title={AI_SLIDES_PRESENT_LABEL}
        type="icon"
      >
        <Play aria-hidden="true" className="cowart-slides-play-icon" size={15} strokeWidth={2} />
        <span className="cowart-slides-toolbar-label">{AI_SLIDES_PRESENT_LABEL}</span>
      </TldrawUiToolbarButton>
      {hasContent && <CowartSlidesAnnotationEditButton slidesShapeId={slidesShapeId} />}
    </TldrawUiContextualToolbar>
  )
}
function CowartSlidesAnnotationEditButton({ slidesShapeId }) {
  const editor = useEditor()
  const [status, setStatus] = useState('idle')
  useEffect(() => setStatus('idle'), [slidesShapeId])
  useEffect(() => {
    if (status === 'idle' || status === 'sending') return undefined
    const timer = window.setTimeout(() => setStatus('idle'), ANNOTATION_EDIT_STATUS_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [status])
  async function handleClick() {
    if (status === 'sending') return
    setStatus('sending')
    try {
      await sendAiSlidesAnnotationEditRequest(editor, slidesShapeId)
      setStatus('sent')
    } catch (error) {
      console.error(error)
      setStatus('error')
    }
  }
  const label = HTML_DRAFT_ANNOTATION_EDIT_LABEL
  const title =
    status === 'sending'
      ? `${label}中`
      : status === 'sent'
        ? `${label}已发送`
        : status === 'error'
          ? `${label}失败，请重试`
          : label
  const icon = status === 'sent' ? 'check' : status === 'error' ? 'warning-triangle' : 'tool-highlight'
  return (
    <TldrawUiToolbarButton
      aria-label={title}
      className="cowart-slides-annotation-button"
      data-status={status}
      data-testid="tool.cowart-slides-annotation-edit"
      disabled={status === 'sending'}
      onClick={handleClick}
      title={title}
      type="icon"
    >
      <TldrawUiButtonIcon icon={icon} small />
      <span className="cowart-slides-toolbar-label">{label}</span>
    </TldrawUiToolbarButton>
  )
}
export { CowartExportMenu, CowartSlidesToolbar, CowartSlidesAnnotationEditButton }
