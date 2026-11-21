// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { TldrawUiButtonIcon, useEditor, useValue } from "tldraw"
import { getFilmOptions } from "../filmConfig.js"
import { FilmStyleButtons } from "../FilmStyleButtons.jsx"
import { Check, ChevronDown } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { AI_IMAGE_GENERATION_STATUS_RESET_MS, AI_IMAGE_REFERENCE_MAX_FILES } from './configuration.jsx'
import { isAiSlidesShape } from './holderMeta.jsx'
import { getAiSlidesItems } from './slidesLayout.jsx'
import { clampNumber, getAiImageGenerationPanelLayout, clipboardImageFiles, stopEditorOverlayEvent, handleGenerationPromptKeyDown } from './generationPrompts.jsx'
import { sendAiSlidesGenerationRequest } from './generationRequests.jsx'
function CowartFilmGenerationOptions({ shape, disabled, section = 'style' }) {
  const editor = useEditor()
  const { style, duration } = getFilmOptions(shape)
  function updateOptions(patch) {
    const current = editor.getShape(shape.id)
    if (!current || disabled) return
    editor.markHistoryStoppingPoint('film-generation-options')
    editor.updateShape({ id: shape.id, type: 'frame', meta: { ...current.meta, ...patch } })
  }
  if (section === 'duration') {
    return (
      <div className="cowart-film-options-row">
        <label>时长
          <input aria-label="影片时长（秒）" disabled={disabled} type="number" min="1" max="120" step="1"
            defaultValue={duration} key={`${shape.id}-${duration}`}
            onBlur={(event) => {
              const value = Number(event.target.value)
              const next = Number.isFinite(value) && value > 0 ? Math.min(120, Math.max(1, Math.round(value))) : duration
              event.target.value = String(next)
              updateOptions({ cowartFilmDuration: next })
            }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} />
          秒
        </label>
      </div>
    )
  }
  return (
    <FilmStyleButtons styleId={style.id} disabled={disabled}
      onChange={(styleId) => updateOptions({ cowartFilmStyle: styleId })} />
  )
}
function CowartAiSlidesGenerationPanel() {
  const editor = useEditor()
  const selectedTarget = useValue(
    'selected empty ai slides generation panel target',
    () => {
      const shape = editor.getOnlySelectedShape()
      if (!isAiSlidesShape(shape) || getAiSlidesItems(editor, shape.id).length > 0) return null
      editor.getCamera()
      editor.getViewportScreenBounds()
      const layout = getAiImageGenerationPanelLayout(editor, shape.id)
      return layout ? { shape, layout } : null
    },
    [editor]
  )
  const fileInputRef = useRef(null)
  const submitInFlightRef = useRef(false)
  const customPageCountInputRef = useRef(null)
  const pageCountMenuRef = useRef(null)
  const [promptValue, setPromptValue] = useState('')
  const [referenceFiles, setReferenceFiles] = useState([])
  const [referencePreviews, setReferencePreviews] = useState([])
  const [pageCountMode, setPageCountMode] = useState('5')
  const [customPageCount, setCustomPageCount] = useState('5')
  const [isPageCountMenuOpen, setIsPageCountMenuOpen] = useState(false)
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  useEffect(() => {
    setStatus('idle')
    setErrorMessage('')
    setPageCountMode('5')
    setCustomPageCount('5')
    setIsPageCountMenuOpen(false)
  }, [selectedTarget?.shape.id])
  useEffect(() => {
    if (!isPageCountMenuOpen) return undefined
    function handlePointerDown(event) {
      if (!pageCountMenuRef.current?.contains(event.target)) setIsPageCountMenuOpen(false)
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setIsPageCountMenuOpen(false)
    }
    const doc = editor.getContainerDocument()
    doc.addEventListener('pointerdown', handlePointerDown, true)
    doc.addEventListener('keydown', handleKeyDown, true)
    return () => {
      doc.removeEventListener('pointerdown', handlePointerDown, true)
      doc.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [editor, isPageCountMenuOpen])
  useEffect(() => {
    if (pageCountMode !== 'custom') return
    customPageCountInputRef.current?.focus()
    customPageCountInputRef.current?.select()
  }, [pageCountMode])
  useEffect(() => {
    if (status !== 'sent') return undefined
    const timer = window.setTimeout(() => setStatus('idle'), AI_IMAGE_GENERATION_STATUS_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [status])
  useEffect(() => {
    const previews = referenceFiles.map((file, index) => ({
      file,
      key: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      url: URL.createObjectURL(file)
    }))
    setReferencePreviews(previews)
    return () => previews.forEach((preview) => URL.revokeObjectURL(preview.url))
  }, [referenceFiles])
  if (!selectedTarget) return null
  const { shape, layout } = selectedTarget
  const parsedCustomPageCount = Math.round(Number(customPageCount))
  const pageCount = pageCountMode === 'custom'
    ? clampNumber(Number.isFinite(parsedCustomPageCount) ? parsedCustomPageCount : 1, 1, 50)
    : Number(pageCountMode)
  const pageCountLabel = pageCountMode === 'custom' ? '自定义' : `${pageCountMode} 页`
  const canSend = promptValue.trim().length > 0 || referenceFiles.length > 0
  const isSending = status === 'sending'
  function addReferenceFiles(files) {
    const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith('image/'))
    const availableSlots = Math.max(0, AI_IMAGE_REFERENCE_MAX_FILES - referenceFiles.length)
    if (!availableSlots) {
      setStatus('error')
      setErrorMessage(`最多支持 ${AI_IMAGE_REFERENCE_MAX_FILES} 张参考图。`)
      return
    }
    setReferenceFiles((currentFiles) => [
      ...currentFiles,
      ...imageFiles.slice(0, availableSlots)
    ].slice(0, AI_IMAGE_REFERENCE_MAX_FILES))
    if (imageFiles.length > availableSlots) {
      setStatus('error')
      setErrorMessage(`最多支持 ${AI_IMAGE_REFERENCE_MAX_FILES} 张参考图。`)
    } else {
      setStatus('idle')
      setErrorMessage('')
    }
  }
  function handleReferenceChange(event) {
    const selectedFiles = Array.from(event.target.files || [])
    if (selectedFiles.some((file) => !file.type.startsWith('image/'))) {
      setStatus('error')
      setErrorMessage('请选择图片文件。')
    } else {
      addReferenceFiles(selectedFiles)
    }
    event.target.value = ''
  }
  function clearReferences() {
    setReferenceFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
  function removeReferenceAt(indexToRemove) {
    setReferenceFiles((currentFiles) => currentFiles.filter((_file, index) => index !== indexToRemove))
    if (status === 'error') {
      setStatus('idle')
      setErrorMessage('')
    }
  }
  async function handleSubmit(event) {
    event?.preventDefault()
    if (!canSend || isSending || submitInFlightRef.current) return
    submitInFlightRef.current = true
    setStatus('sending')
    setErrorMessage('')
    try {
      await sendAiSlidesGenerationRequest({
        slidesShape: shape,
        pageCount,
        userPrompt: promptValue,
        referenceFiles
      })
      setPromptValue('')
      clearReferences()
      setStatus('sent')
    } catch (error) {
      console.error(error)
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : '发送失败，请重试。')
    } finally {
      submitInFlightRef.current = false
    }
  }
  function handlePromptKeyDown(event) {
    handleGenerationPromptKeyDown(event, handleSubmit)
  }
  function handlePromptPaste(event) {
    const imageFiles = clipboardImageFiles(event)
    if (!imageFiles.length) return
    event.preventDefault()
    stopEditorOverlayEvent(event)
    addReferenceFiles(imageFiles)
  }
  return (
    <div className="cowart-ai-generation-overlay" aria-hidden={false}>
      <form
        aria-label="AI Slides 生成"
        className="cowart-ai-generation-panel cowart-ai-slides-generation-panel"
        data-status={status}
        onClick={stopEditorOverlayEvent}
        onDoubleClick={stopEditorOverlayEvent}
        onKeyDown={stopEditorOverlayEvent}
        onPointerDown={stopEditorOverlayEvent}
        onSubmit={handleSubmit}
        style={{
          left: `${layout.left}px`,
          top: `${layout.top}px`,
          width: `${layout.width}px`
        }}
      >
        <div className="cowart-ai-generation-reference-row">
          <div className="cowart-ai-generation-reference-strip">
            {referencePreviews.map((preview, index) => (
              <div className="cowart-ai-generation-reference-preview" key={preview.key}>
                <img alt={`参考图 ${index + 1}`} src={preview.url} />
                <button aria-label={`移除参考图 ${index + 1}`} onClick={() => removeReferenceAt(index)} type="button">
                  <TldrawUiButtonIcon icon="cross-2" small />
                </button>
              </div>
            ))}
            {referenceFiles.length < AI_IMAGE_REFERENCE_MAX_FILES && (
              <button
                aria-label="选择参考图"
                className="cowart-ai-generation-reference-button"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <TldrawUiButtonIcon icon="tool-media" small />
                <span>参考图</span>
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            accept="image/*"
            className="cowart-ai-generation-file-input"
            multiple
            onChange={handleReferenceChange}
            type="file"
          />
        </div>
        <textarea
          aria-label="自定义 Slides prompt"
          className="cowart-ai-generation-prompt"
          disabled={isSending}
          onChange={(event) => {
            setPromptValue(event.target.value)
            if (status === 'error') {
              setStatus('idle')
              setErrorMessage('')
            }
          }}
          onKeyDown={handlePromptKeyDown}
          onPaste={handlePromptPaste}
          placeholder="描述你想生成的 Slides，或是将图片和 HTML 放进 Slides..."
          rows={3}
          value={promptValue}
        />
        <div className="cowart-ai-generation-footer">
          <div className="cowart-ai-generation-status" aria-live="polite">
            {status === 'sending' ? '正在发送' : status === 'sent' ? '已发送' : errorMessage}
          </div>
          <div className="cowart-ai-slides-generation-actions">
            <div className="cowart-ai-slides-page-count-menu" ref={pageCountMenuRef}>
              <button
                aria-expanded={isPageCountMenuOpen}
                aria-haspopup="listbox"
                className="cowart-ai-slides-page-count-trigger"
                disabled={isSending}
                onClick={() => setIsPageCountMenuOpen((isOpen) => !isOpen)}
                type="button"
              >
                <span className="cowart-ai-slides-page-count-label">页数</span>
                <span>{pageCountLabel}</span>
                <ChevronDown aria-hidden="true" size={14} strokeWidth={2} />
              </button>
              {isPageCountMenuOpen && (
                <div aria-label="Slides 页数" className="cowart-ai-slides-page-count-popover" role="listbox">
                  {[
                    ['3', '3 页'],
                    ['5', '5 页'],
                    ['10', '10 页'],
                    ['custom', '自定义']
                  ].map(([value, label]) => (
                    <button
                      aria-selected={pageCountMode === value}
                      className="cowart-ai-slides-page-count-option"
                      key={value}
                      onClick={() => {
                        setPageCountMode(value)
                        setIsPageCountMenuOpen(false)
                      }}
                      role="option"
                      type="button"
                    >
                      <Check
                        aria-hidden="true"
                        className={pageCountMode === value ? 'is-visible' : ''}
                        size={14}
                        strokeWidth={2.25}
                      />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {pageCountMode === 'custom' && (
              <input
                ref={customPageCountInputRef}
                aria-label="自定义 Slides 页数"
                className="cowart-ai-slides-custom-page-count"
                disabled={isSending}
                inputMode="numeric"
                max="50"
                min="1"
                onChange={(event) => setCustomPageCount(event.target.value)}
                type="number"
                value={customPageCount}
              />
            )}
            <button
              aria-label="发送 Slides 生成请求"
              className="cowart-ai-generation-send"
              disabled={!canSend || isSending}
              type="submit"
            >
              <span>{isSending ? '发送中' : '发送'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
export { CowartFilmGenerationOptions, CowartAiSlidesGenerationPanel }
