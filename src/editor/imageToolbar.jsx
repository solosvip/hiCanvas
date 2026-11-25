// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { DefaultImageToolbar, DefaultImageToolbarContent, TldrawUiButton, TldrawUiButtonIcon, TldrawUiInput, TldrawUiToolbarButton, useEditor, useTranslation, useToasts, useUiEvents, useValue } from "tldraw"
import { useCallback, useEffect, useRef, useState } from "react"
import { isImageShape } from './holderMeta.jsx'
import { ANNOTATION_EDIT_TOOL_LABEL, ANNOTATION_EDIT_STATUS_RESET_MS, ANNOTATION_EDIT_MAX_EXPORT_DIMENSION, ANNOTATION_HTML_TOOL_LABEL, aiHtmlToolIcon } from './configuration.jsx'
import { isAnnotationEditExportTooLarge, prepareAnnotationEditRequest } from './annotationRequests.jsx'
import { sendAnnotationEditRequest, sendAnnotationHtmlRequest } from './annotationSend.jsx'
function CowartImageToolbar() {
  return (
    <DefaultImageToolbar>
      <CowartImageToolbarContent />
    </DefaultImageToolbar>
  )
}
function CowartImageToolbarContent() {
  const editor = useEditor()
  const imageShapeId = useValue(
    'cowart selected image shape id',
    () => {
      const shape = editor.getOnlySelectedShape()
      return isImageShape(shape) ? shape.id : null
    },
    [editor]
  )
  const isInCropTool = useValue('cowart image crop tool state', () => editor.isIn('select.crop.'), [
    editor
  ])
  const [isEditingAltText, setIsEditingAltText] = useState(false)
  const handleManipulatingEnd = useCallback(() => {
    editor.setCroppingShape(null)
    editor.setCurrentTool('select.idle')
  }, [editor])
  const handleManipulatingStart = useCallback(() => editor.setCurrentTool('select.crop.idle'), [editor])
  const handleEditAltTextStart = useCallback(() => setIsEditingAltText(true), [])
  const handleEditAltTextClose = useCallback(() => setIsEditingAltText(false), [])
  useEffect(() => {
    setIsEditingAltText(false)
  }, [imageShapeId])
  if (!imageShapeId) return null
  if (isEditingAltText) {
    return (
      <CowartAltTextEditor
        onClose={handleEditAltTextClose}
        shapeId={imageShapeId}
      />
    )
  }
  return (
    <>
      <DefaultImageToolbarContent
        imageShapeId={imageShapeId}
        isManipulating={isInCropTool}
        onEditAltTextStart={handleEditAltTextStart}
        onManipulatingEnd={handleManipulatingEnd}
        onManipulatingStart={handleManipulatingStart}
      />
      {!isInCropTool && (
        <>
          <CowartAnnotationEditToolbarButton imageShapeId={imageShapeId} />
          <CowartAnnotationHtmlToolbarButton imageShapeId={imageShapeId} />
        </>
      )}
    </>
  )
}
function CowartAltTextEditor({ shapeId, onClose }) {
  const editor = useEditor()
  const msg = useTranslation()
  const trackEvent = useUiEvents()
  const inputRef = useRef(null)
  const isReadonly = editor.getIsReadonly()
  const [altText, setAltText] = useState(() => {
    const shape = editor.getShape(shapeId)
    return typeof shape?.props?.altText === 'string' ? shape.props.altText : ''
  })
  const handleComplete = useCallback(() => {
    trackEvent('set-alt-text', { source: 'image-toolbar' })
    const shape = editor.getShape(shapeId)
    if (shape && 'altText' in shape.props) {
      editor.updateShapes([
        {
          id: shape.id,
          type: shape.type,
          props: { altText }
        }
      ])
    }
    onClose()
  }, [altText, editor, onClose, shapeId, trackEvent])
  useEffect(() => {
    inputRef.current?.select()
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    const doc = editor.getContainerDocument()
    doc.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => doc.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [editor, inputRef, onClose])
  useEffect(() => {
    function handlePointerDown(event) {
      const toolbar = editor.getContainerDocument().querySelector('.tlui-media__toolbar')
      if (toolbar?.contains(event.target)) return
      handleComplete()
    }
    const doc = editor.getContainerDocument()
    doc.addEventListener('pointerdown', handlePointerDown, { capture: true })
    return () => doc.removeEventListener('pointerdown', handlePointerDown, { capture: true })
  }, [editor, handleComplete])
  return (
    <>
      <TldrawUiInput
        ref={inputRef}
        aria-label={msg('tool.media-alt-text-desc')}
        className="tlui-media__toolbar-alt-text-input"
        data-testid="media-toolbar.alt-text-input"
        disabled={isReadonly}
        onCancel={onClose}
        onComplete={handleComplete}
        onValueChange={setAltText}
        placeholder={msg('tool.media-alt-text-desc')}
        value={altText}
      />
      {!isReadonly && (
        <TldrawUiButton
          data-testid="tool.media-alt-text-confirm"
          onClick={handleComplete}
          onPointerDown={(event) => event.preventDefault()}
          title={msg('tool.media-alt-text-confirm')}
          type="icon"
        >
          <TldrawUiButtonIcon icon="check" small />
        </TldrawUiButton>
      )}
    </>
  )
}
function CowartAnnotationEditToolbarButton({ imageShapeId }) {
  const editor = useEditor()
  const { addToast } = useToasts()
  const [status, setStatus] = useState('idle')
  useEffect(() => {
    if (status === 'idle' || status === 'sending') return
    const timer = window.setTimeout(() => setStatus('idle'), ANNOTATION_EDIT_STATUS_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [status])
  async function handleClick() {
    if (status === 'sending') return
    let request
    try {
      request = prepareAnnotationEditRequest(editor, imageShapeId)
    } catch (error) {
      console.error(error)
      setStatus('error')
      addToast({ id: 'hicanvas-annotation-error', title: '按标注修改未完成', description: error instanceof Error ? error.message : '操作失败，请检查设置。', severity: 'error' })
      return
    }
    if (isAnnotationEditExportTooLarge(request.exportSize)) {
      const { width, height } = request.exportSize
      addToast({
        id: 'annotation-edit-image-too-large',
        title: '当前图片尺寸太大，暂不支持',
        description: `图片与标注的导出尺寸为 ${width} × ${height}。请将图片缩小到长边不超过 ${ANNOTATION_EDIT_MAX_EXPORT_DIMENSION}px、总像素不超过 1600 万，或将图片外的标注移近后重试。`,
        severity: 'error'
      })
      return
    }
    setStatus('sending')
    try {
      await sendAnnotationEditRequest(editor, imageShapeId, request)
      setStatus('sent')
    } catch (error) {
      console.error(error)
      setStatus('error')
      addToast({ id: 'hicanvas-annotation-error', title: '按标注修改未完成', description: error instanceof Error ? error.message : '操作失败，请检查设置。', severity: 'error' })
    }
  }
  const title =
    status === 'sending'
      ? '正在按标注生成'
      : status === 'sent'
        ? '已提交修改任务'
        : status === 'error'
          ? '提交失败，请重试'
          : ANNOTATION_EDIT_TOOL_LABEL
  return (
    <TldrawUiToolbarButton
      aria-label={title}
      className="cowart-annotation-edit-toolbar-button"
      data-status={status}
      data-testid="tool.cowart-annotation-edit"
      disabled={status === 'sending'}
      onClick={handleClick}
      title={title}
      type="icon"
    >
      <TldrawUiButtonIcon
        icon={status === 'sent' ? 'check' : status === 'error' ? 'warning-triangle' : 'tool-highlight'}
        small
      />
      <span className="cowart-annotation-edit-toolbar-label">{ANNOTATION_EDIT_TOOL_LABEL}</span>
    </TldrawUiToolbarButton>
  )
}
function CowartAnnotationHtmlToolbarButton({ imageShapeId }) {
  const editor = useEditor()
  const [status, setStatus] = useState('idle')
  useEffect(() => {
    setStatus('idle')
  }, [imageShapeId])
  useEffect(() => {
    if (status === 'idle' || status === 'sending') return undefined
    const timer = window.setTimeout(() => setStatus('idle'), ANNOTATION_EDIT_STATUS_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [status])
  async function handleClick() {
    if (status === 'sending') return
    setStatus('sending')
    try {
      await sendAnnotationHtmlRequest(editor, imageShapeId)
      setStatus('sent')
    } catch (error) {
      console.error(error)
      setStatus('error')
    }
  }
  const title =
    status === 'sending'
      ? '正在提交 Html 生成请求'
      : status === 'sent'
        ? '已提交 Html 生成请求'
        : status === 'error'
          ? '提交失败，请重试'
          : ANNOTATION_HTML_TOOL_LABEL
  return (
    <TldrawUiToolbarButton
      aria-label={title}
      className="cowart-annotation-edit-toolbar-button cowart-annotation-html-toolbar-button"
      data-status={status}
      data-testid="tool.cowart-annotation-html"
      disabled={status === 'sending'}
      onClick={handleClick}
      title={title}
      type="icon"
    >
      {status === 'sent' || status === 'error' ? (
        <TldrawUiButtonIcon
          icon={status === 'sent' ? 'check' : 'warning-triangle'}
          small
        />
      ) : (
        aiHtmlToolIcon
      )}
      <span className="cowart-annotation-edit-toolbar-label">{ANNOTATION_HTML_TOOL_LABEL}</span>
    </TldrawUiToolbarButton>
  )
}
export { CowartImageToolbar, CowartImageToolbarContent, CowartAltTextEditor, CowartAnnotationEditToolbarButton, CowartAnnotationHtmlToolbarButton }
