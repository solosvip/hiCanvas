// 基于 Cowart 38bdafeff47374ddbc11b12bddbc4f1f4cf14587 的 App.jsx 按职责拆分；MIT，© 2026 Twox。
import { Tldraw } from "tldraw"
import { backupCanvas } from './backupCanvas.js'
import { canvasApiUrl } from '../conversations/client.js'
import { reportCowartStartup } from "../widgetStartup.js"
import { useCallback, useEffect, useState } from "react"
import { trackCanvasOpened } from "../analytics.js"
import { IS_COWART_WIDGET_BUILD, acceptCowartCanvasSnapshot, hasCowartWidgetBridge, loadCowartCanvasState, refreshCowartCanvasSnapshot, saveCowartSelectionState, saveCowartViewState } from "../cowartClient.js"
import { attachCowartCanvasSaveSession } from "../cowartCanvasSave.js"
import { createPersistenceFeedback } from '../persistenceFeedback.js'
import { sanitizeCanvasSnapshotForTldraw } from "../canvasSnapshot.js"
import { SELECTION_STATE_ELEMENT_ID, ANNOTATION_TOOL_ID, ANNOTATION_LABEL_POSITION } from './configuration.jsx'
import { cowartAssetUrls, cowartTldrawAssetStore, revokeCowartAssetObjectUrls, retainCowartEditorAssets, cowartAssetReferencesChanged } from './assets.jsx'
import { storeChangedSinceSnapshot, applyRemoteCanvasSnapshot } from './remoteSync.js'
import { attachCanvasNavigation } from '../canvasNavigation.js'
import { layoutAllAiSlides, adoptGeneratedAiSlidesItems, normalizeAiDraftHolderLabels, copySelectedCowartContent, preparePastedItemForAiSlides, movePastedItemsIntoAiSlides, cowartTldrawOptions } from './slidesLayout.jsx'
import { CowartAnnotationTool } from './annotationTools.jsx'
import { cowartShapeUtils } from './shapes.jsx'
import { cowartUiOverrides } from './overrides.jsx'
import { cowartComponents } from './components.jsx'
import { startWatermarkLocalization } from './watermarkLocalization.js'
import { hiCanvasUser, useHiCanvasLocale } from './userPreferences.js'
import { getCowartSelection, getCowartSelectionSnapshot, getCowartSelectionRecords, cowartSelectionRecordsEqual, getCowartViewState, restoreCowartViewState, writeCowartSelectionState } from './selection.jsx'
function App() {
  const [snapshot, setSnapshot] = useState()
  const [viewState, setViewState] = useState()
  const [loadError, setLoadError] = useState(null), locale = useHiCanvasLocale()
  useEffect(() => {
    const controller = new AbortController()
    async function loadCanvas() {
      try {
        const canvasState = await loadCowartCanvasState(controller.signal)
        const sanitized = sanitizeCanvasSnapshotForTldraw(canvasState.snapshot)
        if (canvasState.snapshot !== null && (!sanitized.snapshot || sanitized.skippedRecords.length)) {
          throw new Error('Cowart could not load the saved canvas snapshot.')
        }
        setSnapshot(sanitized.snapshot)
        setViewState(canvasState.viewState ?? null)
      } catch (error) {
        if (error.name === 'AbortError') return
        reportCowartStartup('canvas_load_failed')
        setLoadError(error)
        setSnapshot(null)
        setViewState(null)
      }
    }
    loadCanvas()
    return () => controller.abort()
  }, [])
  const handleMount = useCallback((editor) => {
    reportCowartStartup('canvas_mounted')
    trackCanvasOpened()
    window.__cowartEditor = editor
    window.__cowartSelection = () => getCowartSelection(editor)
    window.__cowartViewState = () => getCowartViewState(editor)
    let isDisposed = false
    const canvasSaveSession = attachCowartCanvasSaveSession(editor)
    const stopWatermarkLocalization = startWatermarkLocalization(editor.getContainerDocument())
    const feedback = createPersistenceFeedback(editor.getContainer(), () => { saveCanvas(); syncSelectionState(); syncViewState() }, () => hasUnsavedChanges)
    let lastWrittenSelectionState = ''
    let lastSyncedSelectionState = ''
    let lastSelectionRecords = null
    let selectionSnapshot = null
    let selectionState = ''
    let isSelectionStateSaving = false
    let hasPendingSelectionState = false
    let lastSyncedViewState = ''
    let isViewStateSaving = false
    let hasPendingViewState = false
    editor.timers.requestAnimationFrame(() => {
      restoreCowartViewState(editor, viewState)
    })
    async function syncSelectionState() {
      const selectionRecords = getCowartSelectionRecords(editor)
      if (!cowartSelectionRecordsEqual(selectionRecords, lastSelectionRecords)) {
        // Store records are immutable. Idle ticks can compare identities without
        // serializing selected inline HTML or image payloads four times a second.
        lastSelectionRecords = selectionRecords
        selectionSnapshot = getCowartSelectionSnapshot(editor)
        selectionState = JSON.stringify(selectionSnapshot)
      }
      if (selectionState !== lastWrittenSelectionState) {
        writeCowartSelectionState(selectionSnapshot)
        lastWrittenSelectionState = selectionState
      }
      if (selectionState === lastSyncedSelectionState) return
      if (isSelectionStateSaving) {
        hasPendingSelectionState = true
        return
      }
      isSelectionStateSaving = true
      try {
        const savingSelectionState = selectionState
        await saveCowartSelectionState({
          ...selectionSnapshot,
          updatedAt: new Date().toISOString()
        })
        lastSyncedSelectionState = savingSelectionState
        feedback.saved('selection')
      } catch (error) {
        feedback.failed('selection')
        console.error(error)
      } finally {
        isSelectionStateSaving = false
        if (hasPendingSelectionState) {
          hasPendingSelectionState = false
          syncSelectionState()
        }
      }
    }
    syncSelectionState()
    const selectionStateTimer = window.setInterval(syncSelectionState, 250)
    async function syncViewState() {
      const viewStateSnapshot = getCowartViewState(editor)
      const nextViewState = JSON.stringify(viewStateSnapshot)
      if (nextViewState === lastSyncedViewState) return
      if (isViewStateSaving) {
        hasPendingViewState = true
        return
      }
      isViewStateSaving = true
      try {
        await saveCowartViewState({
          ...viewStateSnapshot,
          updatedAt: new Date().toISOString()
        })
        lastSyncedViewState = nextViewState
        feedback.saved('view')
      } catch (error) {
        feedback.failed('view')
        console.error(error)
      } finally {
        isViewStateSaving = false
        if (hasPendingViewState) {
          hasPendingViewState = false
          syncViewState()
        }
      }
    }
    const viewStateTimer = window.setInterval(syncViewState, 500)
    editor.timers.setTimeout(syncViewState, 100)
    let slidesLayoutTimer = null
    let isLayingOutSlides = false
    function scheduleSlidesLayout() {
      if (isLayingOutSlides || editor.inputs.getIsDragging()) return
      window.clearTimeout(slidesLayoutTimer)
      slidesLayoutTimer = window.setTimeout(() => {
        if (isLayingOutSlides || editor.inputs.getIsDragging()) return
        isLayingOutSlides = true
        try {
          editor.run(
            () => {
              normalizeAiDraftHolderLabels(editor)
              adoptGeneratedAiSlidesItems(editor)
              layoutAllAiSlides(editor)
            },
            { history: 'ignore' }
          )
        } finally {
          isLayingOutSlides = false
        }
      }, 0)
    }
    function handleSlidesPointerUp(event) {
      if (event.name === 'pointer_up') scheduleSlidesLayout()
    }
    editor.on('event', handleSlidesPointerUp)
    const disposeSlidesBeforeCreateHandler = editor.sideEffects.registerBeforeCreateHandler(
      'shape',
      (shape, source) => preparePastedItemForAiSlides(editor, shape, source)
    )
    const disposeSlidesOperationHandler = editor.sideEffects.registerOperationCompleteHandler(() => {
      if (movePastedItemsIntoAiSlides(editor)) return
      scheduleSlidesLayout()
    })
    editor.timers.setTimeout(scheduleSlidesLayout, 100)
    const containerDocument = editor.getContainerDocument()
    function handleCowartCopy(event) {
      copySelectedCowartContent(editor, event)
    }
    containerDocument.addEventListener('copy', handleCowartCopy, { capture: true })
    let saveTimer = null
    let isSaving = false
    let hasPendingSave = false
    let hasUnsavedChanges = false
    let documentChangeVersion = 0
    let saveConflict = false
    let conflictNotice = null
    let conflictBackupVersion = null
    let conflictBackupStore = null
    let conflictReloadButton = null
    let isSyncingAnnotationShape = false
    let remoteLoadController = null
    let lastAppliedRemoteSnapshot = null
    const disposeNavigation = attachCanvasNavigation(editor, {
      save: () => saveConflict ? Promise.reject(new Error('请先处理画板版本冲突。')) : canvasSaveSession.save(),
      didSave: () => { window.clearTimeout(saveTimer); hasPendingSave = hasUnsavedChanges = false; feedback.saved('canvas') }
    })
    function showSaveConflict() {
      if (conflictNotice || isDisposed) return
      const notice = containerDocument.createElement('div')
      notice.setAttribute('role', 'alert')
      notice.setAttribute('data-cowart-save-conflict', '')
      Object.assign(notice.style, {
        position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)',
        zIndex: '100000', maxWidth: 'calc(100% - 32px)', padding: '12px', borderRadius: '8px',
        background: '#fff7ed', color: '#7c2d12', border: '1px solid #fdba74', boxShadow: '0 2px 12px #0002'
      })
      const message = containerDocument.createElement('div')
      message.textContent = '画布已被其他操作更新，当前修改尚未保存。请先备份，再加载最新画布。'
      const backup = containerDocument.createElement('button')
      backup.type = 'button'
      backup.textContent = '备份当前修改'
      const reload = containerDocument.createElement('button')
      reload.type = 'button'
      reload.textContent = '加载最新画布'
      reload.disabled = true
      conflictReloadButton = reload
      backup.addEventListener('click', async () => {
        backup.disabled = true
        const backupVersion = documentChangeVersion
        try {
          const backupStore = await backupCanvas(editor)
          if (isDisposed) return
          conflictBackupVersion = backupVersion
          conflictBackupStore = backupStore
          // Store listeners flush on the next frame. Check the document itself
          // as well, so edits made while the download is pending need a backup.
          reload.disabled = documentChangeVersion !== backupVersion || storeChangedSinceSnapshot(editor, backupStore)
          message.textContent = reload.disabled
            ? '备份已保存；画布又有新修改，请再次备份后加载最新画布。'
            : '备份已保存到下载目录。现在可以加载最新画布。'
        } catch (error) {
          if (!isDisposed) message.textContent = `备份失败，当前修改仍保留在画布中：${error.message}`
        } finally { backup.disabled = false }
      })
      reload.addEventListener('click', async () => {
        if (
          conflictBackupVersion !== documentChangeVersion ||
          !conflictBackupStore ||
          storeChangedSinceSnapshot(editor, conflictBackupStore)
        ) {
          reload.disabled = true
          message.textContent = '画布又有新修改，请再次备份后加载最新画布。'
          return
        }
        reload.disabled = true
        const replacingVersion = documentChangeVersion
        const replacingStore = conflictBackupStore
        try {
          const nextSnapshot = await refreshCowartCanvasSnapshot()
          if (isDisposed) return
          if (documentChangeVersion !== replacingVersion || storeChangedSinceSnapshot(editor, replacingStore)) {
            message.textContent = '画布又有新修改，请再次备份后加载最新画布。'
            return
          }
          const sanitized = sanitizeCanvasSnapshotForTldraw(nextSnapshot)
          if (!sanitized.snapshot || sanitized.skippedRecords.length) throw new Error('最新画布暂时无法完整加载，请稍后重试。')
          editor.store.mergeRemoteChanges(() => {
            editor.store.loadStoreSnapshot(sanitized.snapshot)
            editor.store.ensureStoreIsUsable()
          })
          // Recovery replaces the whole document. Undo entries from the local
          // version must not be replayed against the newly accepted revision.
          editor.clearHistory()
          acceptCowartCanvasSnapshot(nextSnapshot)
          lastAppliedRemoteSnapshot = nextSnapshot
          hasUnsavedChanges = false
          hasPendingSave = false
          canvasSaveSession.reset()
          saveConflict = false
          conflictNotice?.remove()
          conflictNotice = null
          conflictReloadButton = null
        } catch (error) {
          if (!isDisposed) {
            message.textContent = `加载失败，当前修改仍保留在画布中：${error.message}`
            reload.disabled = conflictBackupVersion !== documentChangeVersion || storeChangedSinceSnapshot(editor, conflictBackupStore)
          }
        }
      })
      notice.append(message, backup, reload)
      containerDocument.body.appendChild(notice)
      conflictNotice = notice
    }
    async function saveCanvas() {
      if (!hasUnsavedChanges || saveConflict) return
      if (isSaving) {
        hasPendingSave = true
        return
      }
      isSaving = true
      const savingVersion = documentChangeVersion
      try {
        const saveResult = await canvasSaveSession.save()
        if (saveResult?.ok === false) {
          throw new Error(saveResult.message || 'Cowart refused to save the canvas snapshot.')
        }
        hasUnsavedChanges = documentChangeVersion !== savingVersion
        feedback.saved('canvas')
      } catch (error) {
        feedback.failed('canvas')
        console.error(error)
        if (error.storage === 'revision-conflict') {
          saveConflict = true
          remoteLoadController?.abort()
          showSaveConflict()
        }
      } finally {
        isSaving = false
        if (!saveConflict && (hasPendingSave || hasUnsavedChanges)) {
          hasPendingSave = false
          scheduleSave()
        }
      }
    }
    function scheduleSave() {
      documentChangeVersion += 1
      hasUnsavedChanges = true
      if (conflictReloadButton) conflictReloadButton.disabled = true
      window.clearTimeout(saveTimer)
      window.clearTimeout(slidesLayoutTimer)
      if (saveConflict) return
      if (isSaving) hasPendingSave = true
      saveTimer = window.setTimeout(saveCanvas, 500)
    }
    async function loadRemoteCanvasSnapshot() {
      if (isDisposed || saveConflict || remoteLoadController) return
      const controller = new AbortController()
      remoteLoadController = controller
      const preserveLocalChanges = hasUnsavedChanges || isSaving
      const preFetchStore = preserveLocalChanges ? null : editor.store.getStoreSnapshot().store
      try {
        const nextSnapshot = await refreshCowartCanvasSnapshot(controller.signal)
        if (isDisposed || controller.signal.aborted) return
        if (nextSnapshot === lastAppliedRemoteSnapshot) return
        const effectivePreserve =
          preserveLocalChanges || (preFetchStore && storeChangedSinceSnapshot(editor, preFetchStore))
        if (effectivePreserve) return
        const result = applyRemoteCanvasSnapshot(editor, nextSnapshot)
        if (!result.skippedRecords?.length) {
          acceptCowartCanvasSnapshot(nextSnapshot)
          lastAppliedRemoteSnapshot = nextSnapshot
        }
      } catch (error) {
        if (error.name === 'AbortError') return
        console.error(error)
      } finally {
        if (remoteLoadController === controller) {
          remoteLoadController = null
        }
      }
    }
    const unsubscribe = editor.store.listen(
      scheduleSave,
      {
        source: 'user',
        scope: 'document'
      }
    )
    retainCowartEditorAssets(editor)
    const unsubscribeAssetCache = editor.store.listen(
      ({ changes }) => {
        if (cowartAssetReferencesChanged(changes)) retainCowartEditorAssets(editor)
      },
      { source: 'all', scope: 'all' }
    )
    let canvasEvents = null
    let canvasRefreshTimer = null
    if (hasCowartWidgetBridge()) {
      canvasRefreshTimer = window.setInterval(loadRemoteCanvasSnapshot, 1600)
    } else if (!IS_COWART_WIDGET_BUILD && 'EventSource' in window) {
      canvasEvents = new window.EventSource(canvasApiUrl('/api/canvas-events'))
      canvasEvents.addEventListener('canvas-changed', loadRemoteCanvasSnapshot)
      canvasEvents.onerror = (error) => {
        console.warn('Cowart canvas live refresh disconnected.', error)
      }
    }
    const unsubscribeAnnotationEditingToolLock = editor.store.listen(
      ({ changes }) => {
        for (const [previous, next] of Object.values(changes.updated)) {
          if (previous?.typeName !== 'instance_page_state') continue
          if (!previous.editingShapeId || next.editingShapeId) continue
          const shape = editor.getShape(previous.editingShapeId)
          if (shape?.meta?.cowartAnnotationArrow !== true) continue
          editor.timers.requestAnimationFrame(() => {
            if (editor.getEditingShapeId()) return
            if (editor.getCurrentToolId() !== 'select') return
            editor.setCurrentTool(ANNOTATION_TOOL_ID)
          })
        }
      },
      {
        source: 'all',
        scope: 'session'
      }
    )
    const unsubscribeAnnotationShapeSync = editor.store.listen(
      ({ changes }) => {
        if (isSyncingAnnotationShape) return
        const updates = []
        for (const [_previous, next] of Object.values(changes.updated)) {
          if (next?.typeName !== 'shape') continue
          if (next.type !== 'arrow') continue
          if (next.meta?.cowartAnnotationArrow !== true) continue
          const props = {}
          if (next.props?.color !== next.props?.labelColor) {
            props.labelColor = next.props.color
          }
          if (next.props?.labelPosition !== ANNOTATION_LABEL_POSITION) {
            props.labelPosition = ANNOTATION_LABEL_POSITION
          }
          if (Object.keys(props).length === 0) continue
          updates.push({
            id: next.id,
            type: 'arrow',
            props
          })
        }
        if (updates.length === 0) return
        isSyncingAnnotationShape = true
        try {
          editor.updateShapes(updates)
        } finally {
          isSyncingAnnotationShape = false
        }
      },
      {
        source: 'all',
        scope: 'document'
      }
    )
    return () => {
      disposeNavigation()
      feedback.dispose()
      isDisposed = true
      window.clearTimeout(saveTimer)
      window.clearTimeout(slidesLayoutTimer)
      window.clearInterval(selectionStateTimer)
      window.clearInterval(viewStateTimer)
      window.clearInterval(canvasRefreshTimer)
      remoteLoadController?.abort()
      conflictNotice?.remove()
      canvasEvents?.close()
      if (window.__cowartEditor === editor) {
        delete window.__cowartEditor
        delete window.__cowartSelection
        delete window.__cowartViewState
      }
      document.getElementById(SELECTION_STATE_ELEMENT_ID)?.remove()
      unsubscribe()
      unsubscribeAssetCache()
      revokeCowartAssetObjectUrls()
      unsubscribeAnnotationEditingToolLock()
      unsubscribeAnnotationShapeSync()
      editor.off('event', handleSlidesPointerUp)
      containerDocument.removeEventListener('copy', handleCowartCopy, { capture: true })
      disposeSlidesBeforeCreateHandler()
      disposeSlidesOperationHandler()
      syncViewState()
      saveCanvas()
      canvasSaveSession.dispose()
      stopWatermarkLocalization()
    }
  }, [viewState])
  if (snapshot === undefined || viewState === undefined) {
    return (
      <main className="cowart-status" aria-live="polite">
        正在加载画布…
      </main>
    )
  }
  if (loadError) {
    return (
      <main className="cowart-status" aria-live="polite">
        画板无法完整读取，已停止编辑以保护原文件。请先备份资料夹，再检查本机服务与画板文件。
      </main>
    )
  }
  return (
    <main className="cowart-canvas" aria-label="hiCanvas 无限画布">
      <Tldraw
        snapshot={snapshot ?? undefined}
        assetUrls={cowartAssetUrls}
        assets={cowartTldrawAssetStore}
        locale={locale} user={hiCanvasUser}
        inferDarkMode
        onMount={handleMount}
        options={cowartTldrawOptions}
        overrides={cowartUiOverrides}
        components={cowartComponents}
        shapeUtils={cowartShapeUtils}
        tools={[CowartAnnotationTool]}
      />
    </main>
  )
}
export { App }; export default App
