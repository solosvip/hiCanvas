// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { ModelPicker, useModels } from '../image-models/ModelContext.jsx'
import { TldrawUiButtonIcon, useEditor, useValue } from "tldraw"
import { useEffect, useRef, useState } from "react"
import { AI_IMAGE_GENERATION_STATUS_RESET_MS, AI_IMAGE_REFERENCE_MAX_FILES } from './configuration.jsx'
import { isAiImageHolderShape } from './holderMeta.jsx'
import { getAiImageGenerationPanelLayout, clipboardImageFiles, stopEditorOverlayEvent, handleGenerationPromptKeyDown } from './generationPrompts.jsx'
import { sendAiImageGenerationRequest } from './generationRequests.jsx'
function CowartAiImageGenerationPanel() {
  const editor = useEditor()
  const { activeModelId, loading: modelsLoading } = useModels()
  const panelRef = useRef(null)
  const [panelHeight, setPanelHeight] = useState(undefined)
  const selectedTarget = useValue(
    'selected ai image holder generation panel target',
    () => {
      const shape = editor.getOnlySelectedShape()
      if (!isAiImageHolderShape(shape)) return null
      editor.getCamera()
      editor.getViewportScreenBounds()
      const layout = getAiImageGenerationPanelLayout(editor, shape.id, panelHeight)
      if (!layout) return null
      return {
        shape,
        layout
      }
    },
    [editor, panelHeight]
  )
  useEffect(() => {
    if (!panelRef.current) return
    const observer = new ResizeObserver(([entry]) => setPanelHeight(entry.target.getBoundingClientRect().height))
    observer.observe(panelRef.current)
    return () => observer.disconnect()
  }, [selectedTarget?.shape.id])
  const fileInputRef = useRef(null)
  const submitInFlightRef = useRef(false)
  const [promptValue, setPromptValue] = useState('')
  const [referenceFiles, setReferenceFiles] = useState([])
  const [referencePreviews, setReferencePreviews] = useState([])
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  useEffect(() => {
    if (submitInFlightRef.current) return
    setStatus('idle')
    setErrorMessage('')
  }, [selectedTarget?.shape.id])
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
  const canSend = promptValue.trim().length > 0 || referenceFiles.length > 0
  const isSending = status === 'sending' || ['queued', 'running', 'pending', 'working', 'waiting'].includes(shape.meta?.hicanvasGeneration?.status)
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
      await sendAiImageGenerationRequest({
        editor, modelId: activeModelId,
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
        ref={panelRef}
        aria-label="AI 图片生成"
        className="cowart-ai-generation-panel hc-image-generation-panel"
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
        <ModelPicker disabled={isSending} />
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
          aria-label="自定义 prompt"
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
          placeholder="描述你想生成的图片"
          rows={3}
          value={promptValue}
        />
        <div className="cowart-ai-generation-footer">
          <div className="cowart-ai-generation-status" aria-live="polite">
            {status === 'sending'
              ? '正在生成，请稍候…'
              : status === 'sent'
                ? '已提交生成任务'
                : errorMessage}
          </div>
          <button
            aria-label="发送生成请求"
            className="cowart-ai-generation-send"
            disabled={!canSend || isSending || modelsLoading || !activeModelId}
            type="submit"
          >
            <span>{isSending ? '生成中' : '生成'}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
export { CowartAiImageGenerationPanel }
