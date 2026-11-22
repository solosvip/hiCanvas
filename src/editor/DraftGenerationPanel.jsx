// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { TldrawUiButtonIcon, useEditor, useValue } from "tldraw"
import { useEffect, useRef, useState } from "react"
import { saveCowartSelectionState } from "../cowartClient.js"
import { saveCowartEditorSnapshot } from "../cowartCanvasSave.js"
import { AI_IMAGE_GENERATION_STATUS_RESET_MS, AI_IMAGE_REFERENCE_MAX_FILES } from './configuration.jsx'
import { isAiDraftHolderShape, isAiFilmHolderShape } from './holderMeta.jsx'
import { getAiImageGenerationPanelLayout, clipboardImageFiles, stopEditorOverlayEvent, handleGenerationPromptKeyDown } from './generationPrompts.jsx'
import { sendAiDraftGenerationRequest } from './generationRequests.jsx'
import { CowartFilmGenerationOptions } from './SlidesGenerationPanel.jsx'
import { getCowartSelectionSnapshot } from './selection.jsx'
function CowartAiDraftGenerationPanel() {
  const editor = useEditor()
  const selectedTarget = useValue(
    'selected ai draft holder generation panel target',
    () => {
      const shape = editor.getOnlySelectedShape()
      if (!isAiDraftHolderShape(shape)) return null
      editor.getCamera()
      editor.getViewportScreenBounds()
      const layout = getAiImageGenerationPanelLayout(editor, shape.id, isAiFilmHolderShape(shape) ? 320 : undefined)
      if (!layout) return null
      return {
        shape,
        layout
      }
    },
    [editor]
  )
  const fileInputRef = useRef(null)
  const submitInFlightRef = useRef(false)
  const [promptValue, setPromptValue] = useState('')
  const [referenceFiles, setReferenceFiles] = useState([])
  const [referencePreviews, setReferencePreviews] = useState([])
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  useEffect(() => {
    setStatus('idle')
    setErrorMessage('')
    const holder = selectedTarget ? editor.getShape(selectedTarget.shape.id) : null
    if (isAiFilmHolderShape(holder) && holder.meta?.cowartFilmMuted === true) {
      editor.updateShape({ id: holder.id, type: 'frame', meta: { ...holder.meta, cowartFilmMuted: false } })
    }
  }, [editor, selectedTarget?.shape.id])
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
    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url))
    }
  }, [referenceFiles])
  if (!selectedTarget) return null
  const { shape, layout } = selectedTarget
  const isFilm = isAiFilmHolderShape(shape)
  const canSend = promptValue.trim().length > 0 || referenceFiles.length > 0
  const isSending = status === 'sending'
  function handleReferenceChange(event) {
    const selectedFiles = Array.from(event.target.files || [])
    if (!selectedFiles.length) return
    const imageFiles = selectedFiles.filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length !== selectedFiles.length) {
      setStatus('error')
      setErrorMessage('请选择图片文件。')
      event.target.value = ''
      return
    }
    const availableSlots = Math.max(0, AI_IMAGE_REFERENCE_MAX_FILES - referenceFiles.length)
    if (!availableSlots) {
      setStatus('error')
      setErrorMessage(`最多支持 ${AI_IMAGE_REFERENCE_MAX_FILES} 张参考图。`)
      event.target.value = ''
      return
    }
    const filesToAdd = imageFiles.slice(0, availableSlots)
    setReferenceFiles((currentFiles) => [...currentFiles, ...filesToAdd].slice(0, AI_IMAGE_REFERENCE_MAX_FILES))
    if (imageFiles.length > availableSlots) {
      setStatus('error')
      setErrorMessage(`最多支持 ${AI_IMAGE_REFERENCE_MAX_FILES} 张参考图。`)
    } else {
      setStatus('idle')
      setErrorMessage('')
    }
    event.target.value = ''
  }
  function clearReferences() {
    setReferenceFiles([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }
  function removeReferenceAt(indexToRemove) {
    setReferenceFiles((currentFiles) => currentFiles.filter((_file, index) => index !== indexToRemove))
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
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
      const saved = await saveCowartEditorSnapshot(editor)
      if (saved?.ok === false) throw new Error(saved.message || '画布保存失败。')
      await saveCowartSelectionState(getCowartSelectionSnapshot(editor))
      await sendAiDraftGenerationRequest({
        holderShape: editor.getShape(shape.id) || shape,
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
  return (
    <div className="cowart-ai-generation-overlay" aria-hidden={false}>
      <form
        aria-label={isFilm ? "AI 影片生成" : "AI 网页生成"}
        className={`cowart-ai-generation-panel${isFilm ? " cowart-ai-film-generation-panel" : ""}`}
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
        {isFilm && <CowartFilmGenerationOptions shape={shape} disabled={isSending} />}
        <textarea
          aria-label="自定义提示词"
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
          placeholder={isFilm ? "描述影片内容、镜头和节奏，默认 15 秒" : "描述你想生成的网页"}
          rows={3}
          value={promptValue}
        />
        <div className="cowart-ai-generation-footer">
          <div className="cowart-ai-generation-footer-start">
            {isFilm && <CowartFilmGenerationOptions shape={shape} disabled={isSending} section="duration" />}
            <div className="cowart-ai-generation-status" aria-live="polite">
              {status === 'sending'
                ? '正在发送'
                : status === 'sent'
                  ? '已发送'
                  : errorMessage}
            </div>
          </div>
          <button
            aria-label={isFilm ? "发送影片生成请求" : "发送草稿请求"}
            className="cowart-ai-generation-send"
            disabled={!canSend || isSending}
            type="submit"
          >
            <span>{isSending ? '发送中' : '发送'}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
export { CowartAiDraftGenerationPanel }
