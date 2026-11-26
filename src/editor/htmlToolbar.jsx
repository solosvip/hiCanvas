// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { Box, TldrawUiButtonIcon, TldrawUiContextualToolbar, TldrawUiToolbarButton, useEditor, useValue } from "tldraw"
import { getFilmOptions } from "../filmConfig.js"
import { filmAnalyticsContext, withFilmExportAnalytics } from "../filmAnalytics.js"
import { Pause, Play, Volume2, VolumeX } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { trackFilmPlaybackAction, trackFilmExport } from "../analytics.js"
import { HTML_DRAFT_ANNOTATION_EDIT_LABEL, HTML_DRAFT_ANNOTATION_IMAGE_LABEL, aiImageToolIcon, COWART_FILM_STATUS_EVENT, HTML_DRAFT_DOM_EDIT_LABEL, HTML_DRAFT_DOM_EDIT_DONE_LABEL, ANNOTATION_EDIT_STATUS_RESET_MS } from './configuration.jsx'
import { isCowartFilmShape } from './holderMeta.jsx'
import { exportCowartHtmlDraft, exportCowartFilm } from './exports.jsx'
import { CowartExportMenu } from './slidesToolbar.jsx'
import { cowartFilmControllers, cowartFilmStatuses, cowartHtmlDraftIframes, cowartHtmlDraftDomEditSessions } from './assets.jsx'
import { stopEditorOverlayEvent } from './generationPrompts.jsx'
import { sendHtmlDraftAnnotationRequest } from './htmlAnnotations.jsx'
function CowartHtmlDraftToolbar({ draftShapeId }) {
  const editor = useEditor()
  const isFilm = useValue('cowart selected film', () => isCowartFilmShape(editor.getShape(draftShapeId)), [editor, draftShapeId])
  const showToolbar = useValue(
    'cowart show html draft toolbar',
    () => editor.isInAny('select.idle', 'select.pointing_shape', 'select.editing_shape'),
    [editor]
  )
  const isLocked = useValue(
    'cowart html draft toolbar locked',
    () => editor.getShape(draftShapeId)?.isLocked === true,
    [editor, draftShapeId]
  )
  const isDomEditing = useValue(
    'cowart html draft dom editing',
    () => editor.getEditingShapeId() === draftShapeId,
    [editor, draftShapeId]
  )
  const getSelectionBounds = useCallback(() => {
    const fullBounds = editor.getSelectionScreenBounds()
    if (!fullBounds) return undefined
    return new Box(fullBounds.x, fullBounds.y, fullBounds.width, 0)
  }, [editor])
  if (!showToolbar || isLocked) return null
  return (
    <TldrawUiContextualToolbar
      className="tlui-media__toolbar tlui-image__toolbar cowart-html-draft__toolbar"
      getSelectionBounds={getSelectionBounds}
      label={isFilm ? "AI 影片工具栏" : "AI 网页工具栏"}
    >
      {!isDomEditing && (
        <CowartExportMenu
          onExportHtml={(_onProgress, signal) => isFilm
            ? withFilmExportAnalytics(() => exportCowartHtmlDraft(editor, draftShapeId, 'html'),
              { ...filmAnalyticsContext(editor.getShape(draftShapeId)), format: 'html' }, trackFilmExport, signal)
            : exportCowartHtmlDraft(editor, draftShapeId, 'html')}
          onExportFilm={isFilm ? (onProgress, signal) => exportCowartFilm(editor, draftShapeId, onProgress, signal) : undefined}
          onExportImage={isFilm ? undefined : () => exportCowartHtmlDraft(editor, draftShapeId, 'image')}
          targetKey={`html-${draftShapeId}`}
        />
      )}
      <CowartHtmlDraftDomEditButton draftShapeId={draftShapeId} isEditing={isDomEditing} />
      {!isDomEditing && !isFilm && (
        <>
          <CowartHtmlDraftToolbarButton
            action="edit"
            draftShapeId={draftShapeId}
            icon="tool-highlight"
            label={HTML_DRAFT_ANNOTATION_EDIT_LABEL}
            showLabel
          />
          <CowartHtmlDraftToolbarButton
            action="image"
            draftShapeId={draftShapeId}
            icon="tool-media"
            iconElement={aiImageToolIcon}
            label={HTML_DRAFT_ANNOTATION_IMAGE_LABEL}
            showLabel
          />
        </>
      )}
    </TldrawUiContextualToolbar>
  )
}
function CowartFilmPlaybackControls({ draftShapeId, isEditing, isLocked = false }) {
  const editor = useEditor()
  const seekChangedRef = useRef(false)
  const [status, setStatus] = useState(() => cowartFilmStatuses.get(draftShapeId) || {
    ...getFilmOptions(editor.getShape(draftShapeId)), currentTime: 0, playing: false, ready: false
  })
  useEffect(() => {
    function receive(event) {
      if (event.detail?.shapeId === draftShapeId) setStatus(event.detail.status)
    }
    window.addEventListener(COWART_FILM_STATUS_EVENT, receive)
    const current = cowartFilmStatuses.get(draftShapeId)
    if (current) setStatus(current)
    return () => window.removeEventListener(COWART_FILM_STATUS_EVENT, receive)
  }, [draftShapeId])
  useEffect(() => {
    if (isEditing) cowartFilmControllers.get(draftShapeId)?.command('pause')
  }, [draftShapeId, isEditing])
  function command(name, value) {
    const controller = cowartFilmControllers.get(draftShapeId)
    if (!controller) return
    controller.command(name, value)
    if (name !== 'seek') {
      trackFilmPlaybackAction({
        ...filmAnalyticsContext(editor.getShape(draftShapeId)),
        action: name,
        ...(name === 'mute' ? { filmMuted: value } : {})
      })
    }
    if (name === 'mute') {
      const shape = editor.getShape(draftShapeId)
      if (shape && shape.meta?.cowartFilmMuted !== value) {
        editor.markHistoryStoppingPoint('toggle-film-mute')
        editor.updateShape({ id: shape.id, type: 'embed', meta: { ...shape.meta, cowartFilmMuted: value } })
      }
    }
  }
  function trackSeek() {
    if (!seekChangedRef.current) return
    seekChangedRef.current = false
    trackFilmPlaybackAction({ ...filmAnalyticsContext(editor.getShape(draftShapeId)), action: 'seek' })
  }
  function formatTime(value) {
    const seconds = Math.floor(Number(value) || 0)
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }
  return (
    <div className="cowart-film-playback" onPointerDown={stopEditorOverlayEvent} onKeyDown={stopEditorOverlayEvent}>
      <button aria-label={status.playing ? '暂停影片' : '播放影片'} title={status.error || (status.playing ? '暂停影片' : '播放影片')}
        disabled={!status.ready || isEditing || isLocked} onClick={() => command(status.playing ? 'pause' : 'play')} type="button">
        {status.playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <input aria-label="影片进度" className="cowart-film-progress" type="range" min="0" max={status.duration || 15}
        step="any" value={status.currentTime || 0} disabled={!status.ready || isEditing || isLocked}
        onChange={(event) => { seekChangedRef.current = true; command('seek', Number(event.target.value)) }}
        onPointerUp={trackSeek}
        onBlur={trackSeek}
        onKeyUp={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
            trackSeek()
          }
        }} />
      <span className="cowart-film-time">{formatTime(status.currentTime)} / {formatTime(status.duration)}</span>
      <button aria-label={status.muted ? '取消静音' : '静音影片'} aria-pressed={status.muted} disabled={!status.ready || isEditing || isLocked}
        onClick={() => command('mute', !status.muted)} type="button">
        {status.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
      {status.error && <span className="cowart-film-playback-error" role="status">{status.error}</span>}
    </div>
  )
}
function CowartHtmlDraftDomEditButton({ draftShapeId, isEditing }) {
  const editor = useEditor()
  const [status, setStatus] = useState('idle')
  const label = isEditing ? HTML_DRAFT_DOM_EDIT_DONE_LABEL : HTML_DRAFT_DOM_EDIT_LABEL
  useEffect(() => {
    setStatus('idle')
  }, [draftShapeId, isEditing])
  async function handleClick() {
    if (status === 'saving') return
    if (!isEditing) {
      cowartFilmControllers.get(draftShapeId)?.command('pause')
      editor.setEditingShape(draftShapeId)
      editor.setCurrentTool('select.editing_shape')
      window.requestAnimationFrame(() => cowartHtmlDraftIframes.get(draftShapeId)?.focus())
      return
    }
    setStatus('saving')
    try {
      const session = cowartHtmlDraftDomEditSessions.get(draftShapeId)
      if (session?.finish) await session.finish()
      else await session?.flush()
      editor.setEditingShape(null)
      editor.setCurrentTool('select')
    } catch (error) {
      console.error(error)
      setStatus('error')
    }
  }
  const title =
    status === 'saving'
      ? '正在保存网页内容'
      : status === 'error'
        ? '网页内容保存失败，请重试'
        : label
  return (
    <TldrawUiToolbarButton
      aria-label={title}
      className="cowart-html-draft-toolbar-button"
      data-action="dom-edit"
      data-compact="false"
      data-status={status}
      data-testid="tool.cowart-html-draft-dom-edit"
      disabled={status === 'saving'}
      onClick={handleClick}
      title={title}
      type="icon"
    >
      <TldrawUiButtonIcon icon={isEditing ? 'check' : 'tool-text'} small />
      <span className="cowart-html-draft-toolbar-label">{label}</span>
    </TldrawUiToolbarButton>
  )
}
function CowartHtmlDraftToolbarButton({
  action,
  draftShapeId,
  icon,
  iconElement,
  label,
  showLabel = false
}) {
  const editor = useEditor()
  const [status, setStatus] = useState('idle')
  useEffect(() => {
    setStatus('idle')
  }, [action, draftShapeId])
  useEffect(() => {
    if (status === 'idle' || status === 'sending') return undefined
    const timer = window.setTimeout(() => setStatus('idle'), ANNOTATION_EDIT_STATUS_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [status])
  async function handleClick() {
    if (status === 'sending') return
    setStatus('sending')
    try {
      await sendHtmlDraftAnnotationRequest(editor, draftShapeId, action)
      setStatus('sent')
    } catch (error) {
      console.error(error)
      setStatus('error')
    }
  }
  const title =
    status === 'sending'
      ? `${label}中`
      : status === 'sent'
        ? `${label}已完成`
        : status === 'error'
          ? `${label}失败，请重试`
          : label
  const statusIcon = status === 'sent' ? 'check' : status === 'error' ? 'warning-triangle' : icon
  return (
    <TldrawUiToolbarButton
      aria-label={title}
      className="cowart-html-draft-toolbar-button"
      data-action={action}
      data-compact={showLabel ? 'false' : 'true'}
      data-status={status}
      data-testid={`tool.cowart-html-draft-${action}`}
      disabled={status === 'sending'}
      onClick={handleClick}
      title={title}
      type="icon"
    >
      {status === 'idle' && iconElement ? (
        iconElement
      ) : (
        <TldrawUiButtonIcon icon={statusIcon} small />
      )}
      {showLabel && <span className="cowart-html-draft-toolbar-label">{label}</span>}
    </TldrawUiToolbarButton>
  )
}
export { CowartHtmlDraftToolbar, CowartFilmPlaybackControls, CowartHtmlDraftDomEditButton, CowartHtmlDraftToolbarButton }
