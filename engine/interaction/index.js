import { matchesCanvasShortcut } from './shortcuts.js'
import { atom } from '@tldraw/state'
import { checkedCamera, createSpatialIndex } from '../../renderer/geometry.js'
import { normalizeInput } from './input.js'
import { createSelectionTool } from './select.js'
import { createSelectionFrame } from './selection-frame.js'
import { describeSelection, checkedHandleMetrics } from './selection-handles.js'
import { createSelectionTargets } from './targets.js'
import { createSelectionNavigation } from './selection-navigation.js'
import { createSelectionShortcuts } from './selection-shortcuts.js'
import { createSelectionActions } from './selection-actions.js'
import { createClipboardActions } from './clipboard.js'
import { createDuplicateMemory } from './duplicate-memory.js'
import { createHandTool } from './camera-pan.js'
import { createCameraContent } from './camera-content.js'
import { createCameraNavigation } from './camera-navigation.js'
import { checkedViewport } from './camera-math.js'
import { createMinimapInteraction } from './minimap.js'
import { checkedInputContext, createKeyboardInput } from './keyboard-input.js'
import { createImageCrop } from './image-crop.js'
import { createClickCounter } from './click-count.js'
import { createDrawTool, createHighlightTool } from './draw.js'
import { createDrawShortcuts } from './draw-shortcuts.js'
import { createEraserTool } from './eraser.js'
import { createGeoTool } from './create-geo.js'
import { createFrameTool } from './create-frame.js'
import { createCreationControls } from './creation-controls.js'
import { createAiImageTool } from './create-ai-image.js'
import { createAiDraftTool } from './create-ai-draft.js'
import { createAiFilmTool } from './create-ai-film.js'
import { createAiSlidesTool } from './create-ai-slides.js'
import { creationToolIds } from './creation-presets.js'
import { createTextEditing } from './text-editing.js'
import { createTextTool } from './create-text.js'
import { createTextInput } from './text-input.js'
import { createArrowTool, createLineTool } from './create-connection.js'
import { createConnectionEditing } from './connection-editing.js'
import { createNoteTool } from './create-note.js'
import { createNoteEditing } from './note-editing.js'
import { createSnapping } from './snapping.js'
import { createVideoInteraction } from './video.js'
import { createImageAlt } from './image-alt.js'
import { createStyleSession } from './style-session.js'
import { createAiFrameSize } from './ai-frame-size.js'

// Input contract: every event has time (monotonic host milliseconds) and modifier
// booleans. Pointer events carry CSS host-relative point, pointerId/type, pressure,
// button/buttons; key events carry key/code/repeat/isComposing and optional IME
// keyCode 229; wheel carries CSS-pixel delta. Hosts report inputContext with the
// setter on focus/composition changes. Only canvas-owned keys reach tools.
// Products choose allowed tools from this registry; tool state never enters the
// document Store. Future tools get the same normalized input and context.
export const canvasToolRegistry = Object.freeze({ select: createSelectionTool, hand: createHandTool, text: createTextTool, note: createNoteTool, line: createLineTool, arrow: createArrowTool, draw: createDrawTool, highlight: createHighlightTool, eraser: createEraserTool, geo: createGeoTool, frame: createFrameTool, 'ai-image': createAiImageTool, 'ai-draft': createAiDraftTool, 'ai-film': createAiFilmTool, 'ai-slides': createAiSlidesTool })

// Optional handleMetrics are screen CSS pixels: cornerHit/edgeHit are
// half-extents, rotationOffset is per-axis, rotationRadius is a radius.
// Hosts may supply design tokens; the engine validates and copies the values.
export function createCanvasInteraction({ session, camera, pageId, toolIds = ['select', 'hand'], viewport, inputDevice = null, invertZoom = false, reduceMotion = false, edgeScrolling = true, handleMetrics, shortcutsEnabled = true, inputContext, measureFrameTitle, controlPointSnapping = false, snapping = {}, snapModifier = 'meta', displayName = null, clipboard: clipboardPort, boardId = '' }) {
  if (!session?.store || !toolIds.length || toolIds.some(id => !Object.hasOwn(canvasToolRegistry, id))) throw new Error('交互模块需要运行时和已登记工具。')
  const metrics = checkedHandleMetrics(handleMetrics)
  if (typeof controlPointSnapping !== 'boolean') throw new Error('控制点吸附需要布尔值。')
  let countClicks = createClickCounter()
  const initial = session.store.allRecords(), activePage = pageId || initial.find(r => r.typeName === 'page')?.id
  const index = createSpatialIndex(initial, activePage), targets = createSelectionTargets(index, activePage, initial)
  const duplicates = createDuplicateMemory(index)
  const content = createCameraContent(initial, index, activePage), selection = createSelectionFrame(initial, index)
  const state = atom('canvas interaction', Object.freeze({ toolId: toolIds[0], focusedGroupId: activePage, isWrapMode: false, isPenMode: false, selectedIds: Object.freeze([]), selectionRotation: null, hoveredId: null, handleCursor: null, marquee: null, scribble: null, textEditing: null, interactingVideoId: null, videoPlayback: Object.freeze({}), camera: Object.freeze(checkedCamera(camera)), mode: 'idle', viewport: checkedViewport(viewport), contentOffscreen: false, edgeScrolling: Boolean(edgeScrolling), needsFrame: false, temporaryTool: null, inputContext: checkedInputContext(inputContext), shortcutsEnabled: Boolean(shortcutsEnabled), overlays: Object.freeze([]), lastError: null, lastNotice: null }))
  let disposed = false, tool, navigation, minimap, keyboard, cropTool, connectionEditing, noteEditing, videoInput, imageAlt, aiFrameSize, selectionKeys, actions, snaps, clipboard, lastTime = -Infinity
  function read() { return state.get() }
  function change(patch = {}) {
    if (disposed) return
    const previous = read(), next = { ...previous, ...patch }
    next.erasingIds = Object.freeze([...(next.erasingIds || [])])
    next.eraser = next.eraser ? Object.freeze({ ...next.eraser, ids: Object.freeze([...next.eraser.ids]), points: Object.freeze(next.eraser.points.map(p => Object.freeze({ ...p }))), bounds: Object.freeze({ ...next.eraser.bounds }) }) : null
    if (Object.hasOwn(patch, 'lastError')) next.lastNotice = null
    if (patch.lastNotice && !patch.lastError) { next.lastNotice = patch.lastNotice; next.lastError = null }
    if (snaps) next.snappingPreferences = snaps.preferences()
    next.focusedGroupId = targets.validScope(next.focusedGroupId)
    next.selectedIds = Object.freeze([...next.selectedIds].filter(id => targets.isSelectable(id)))
    next.aiFrameSizeEditing = aiFrameSize?.sync(next) || null
    duplicates.selectionChanged(next.selectedIds)
    if (JSON.stringify(next.selectedIds) !== JSON.stringify(previous.selectedIds) && !Object.hasOwn(patch, 'selectionRotation')) next.selectionRotation = null
    if (next.hoveredId && !targets.isSelectable(next.hoveredId)) next.hoveredId = null
    if (next.interactingVideoId && (next.toolId !== 'select' || !next.selectedIds.includes(next.interactingVideoId) || !targets.isSelectable(next.interactingVideoId) || session.store.get(next.interactingVideoId)?.type !== 'video')) next.interactingVideoId = null
    if (next.imageAltEditing && (next.toolId !== 'select' || next.selectedIds.length !== 1 || next.selectedIds[0] !== next.imageAltEditing.id || !targets.isSelectable(next.imageAltEditing.id))) next.imageAltEditing = null
    next.camera = Object.freeze(checkedCamera(next.camera))
    next.contentOffscreen = content.offscreen(next.camera, next.viewport)
    next.minimap = minimap?.describe(next) || null
    next.needsFrame = Boolean(next.needsFrame || tool?.needsFrame || connectionEditing?.needsFrame)
    next.scribble = next.scribble && Object.freeze({ ...next.scribble, bounds: Object.freeze({ ...next.scribble.bounds }), points: Object.freeze(next.scribble.points.map(p => Object.freeze({ ...p }))) })
    next.marquee = next.marquee && Object.freeze({ ...next.marquee })
    if (next.croppingId && !targets.isSelectable(next.croppingId)) { next.croppingId = null; next.mode = 'idle'; next.handleCursor = null }
    next.cropZoom = next.croppingId ? cropTool?.zoom(next.croppingId) || 0 : 0
    const selected = next.textEditing ? null : next.croppingId ? cropTool?.describe(next) : describeSelection(selection, next.selectedIds, next.selectionRotation), overlays = selected ? [selected] : []
    const connection = !next.textEditing && !next.croppingId && connectionEditing?.describe(next)
    if (connection) overlays.push(connection)
    const note = noteEditing?.describe(next)
    if (note) overlays.push(note)
    overlays.push(...(snaps?.describe() || []))
    if (next.marquee) overlays.push({ kind: 'marquee', bounds: next.marquee })
    if (next.scribble) overlays.push(next.scribble)
    if (next.eraser) overlays.push(next.eraser)
    next.overlays = Object.freeze(overlays.map(o => Object.freeze({ ...o, bounds: Object.freeze({ ...o.bounds }), ...(o.handles && { handles: Object.freeze(o.handles.map(h => Object.freeze(h))) }) })))
    if (JSON.stringify(next) !== JSON.stringify(previous)) state.set(Object.freeze(next))
  }
  function report(error) { change({ lastError: Object.freeze({ code: error.code || 'interaction', message: error.message }) }) }
  function cancelTool() {
    // Context loss cancels real and comma pointers together. Recreate the
    // shared counter so neither a previous click nor an unreleased press leaks.
    countClicks = createClickCounter(); clipboard?.cancel(); actions?.cancel(); selectionKeys?.cancel(); connectionEditing?.cancel(); noteEditing?.cancel(); snaps?.clear(); tool?.cancel()
  }
  function setTool(id) {
    if (!toolIds.includes(id)) throw new Error('工具未向本产品开放。')
    aiFrameSize?.cancel(); imageAlt?.cancel(); videoInput?.finish(); keyboard?.cancel(); minimap?.cancel(); navigation?.cancel(); cropTool?.finish(); cancelTool(); tool = canvasToolRegistry[id](context); change({ toolId: id, handleCursor: null })
    creation.toolChanged(id)
    return tool
  }
  const context = { session, index, targets, selection, duplicates, handleMetrics: metrics, controlPointSnapping, snapModifier, displayName, read, change, report, measureFrameTitle, pageId: activePage, returnToSelect: () => { if (!disposed && toolIds.includes('select')) setTool('select') } }
  snaps = createSnapping(context, snapping); context.snapping = snaps
  const creation = createCreationControls({ read, change, switchTool: setTool, canUseTool: id => toolIds.includes(id) })
  context.creation = creation
  cropTool = createImageCrop(context)
  navigation = createCameraNavigation({ session, read, change, content, cancelTool: () => { cancelTool(); cropTool.cancel() }, setTool: id => { if (!toolIds.includes(id)) return false; setTool(id); return true }, inputDevice, invertZoom, reduceMotion })
  minimap = createMinimapInteraction({ session, read, change, content, navigation })
  context.navigation = navigation
  const prepareText = () => { cancelTool(); cropTool.cancel(); navigation.cancel() }
  const textEditing = createTextEditing({ ...context, prepare: prepareText, inputContext: value => keyboard.context(value), setStyles: (patch, ids) => styles.set(patch, ids), stylesCommitted: patch => styles.adopt(patch) })
  context.textEditing = textEditing
  const styles = createStyleSession({ ...context, textEditing })
  aiFrameSize = createAiFrameSize(context)
  noteEditing = createNoteEditing(context, textEditing)
  connectionEditing = createConnectionEditing(context)
  videoInput = createVideoInteraction({ ...context, prepare: prepareText })
  imageAlt = createImageAlt({ ...context, prepare: prepareText })
  const textInput = createTextInput({ ...context, prepare: prepareText, replay: dispatchCore, canCreate: () => toolIds.includes('text') }, textEditing)
  const selectionNavigation = createSelectionNavigation(context)
  context.select = selectionNavigation.run
  clipboard = createClipboardActions({ ...context, boardId }, clipboardPort); context.clipboard = clipboard
  change({ pasteAtCursor: false, clipboardBusy: false })
  selectionKeys = createSelectionShortcuts(context)
  actions = createSelectionActions(context)
  const drawKeys = createDrawShortcuts({ toolIds, setTool })
  tool = canvasToolRegistry[read().toolId](context)
  creation.toolChanged(read().toolId)
  keyboard = createKeyboardInput({ read, change, releaseKeys: () => { cancelTool(); navigation.releaseKeys() },
    releaseKey: key => tool.releaseKey?.(key),
    cancelPointer: () => { cancelTool(); cropTool.cancel(); minimap.cancel(); navigation.cancelPan() }, dispatchPointer: dispatchCore,
    isBusy: () => session.state.get().isGestureActive || session.state.get().isSubmitting })
  const stop = session.store.addHistoryInterceptor(({ changes }) => {
    const checkBasis = !session.state.get().isGestureActive && read().selectionRotation !== null
    const before = checkBasis && selection.expected(read().selectedIds)
    index.applyChanges(changes); targets.apply(changes); content.apply(changes); selection.apply(changes)
    connectionEditing.applyChanges(changes); videoInput.applyChanges(changes); tool?.applyChanges?.(changes)
    const after = checkBasis && selection.expected(read().selectedIds)
    const affected = checkBasis && [...Object.keys(changes.added), ...Object.keys(changes.updated), ...Object.keys(changes.removed)].some(id => before.has(id) || after.has(id))
    change(!session.state.get().isGestureActive && affected ? { selectionRotation: null } : {})
  })
  change()
  function assertActive() { if (disposed) throw new Error('交互模块已关闭。') }
  function dispatchCore(input) {
    // History rejection must preserve the active editing gesture. Runtime
    // owns busy/conflict checks; never route its rejection through tool.cancel.
    if (matchesCanvasShortcut('history', input)) {
      const selected = [...read().selectedIds]
      return session[input.shiftKey ? 'redo' : 'undo']().then(result => { const ids = duplicates.followHistory(result.changes, selected); change({ lastError: null, ...(ids && { selectedIds: ids }) }); return result }).catch(error => { report(error); throw error })
    }
    if (session.state.get().isSubmitting) return
    // Count only input that reaches the canvas: a rejected click must not
    // prime a later double click (#139). The minimap keeps native dblclick.
    input = countClicks(input)
    // Physical-pointer Escape cancels through tool.dispatch below; clear its
    // click sequence too, before a later ordinary click can become click #2.
    if (input.type === 'key_down' && matchesCanvasShortcut('escape', input)) countClicks = createClickCounter()
    if (minimap.handle(input)) { navigation.finishFrame(); return input.type.startsWith('key_') ? true : undefined }
    if (noteEditing.candidate(input)) {
      const routed = navigation.handle(input)
      if (routed.handled && !routed.replay && input.type !== 'frame') { noteEditing.cancel(); navigation.finishFrame(); return true }
      const noted = noteEditing.handle(routed.replay || input)
      if (noted.handled) { navigation.finishFrame(); return noted.result ?? true }
    }
    const connectionTarget = connectionEditing.candidate(input)
    if (connectionTarget) {
      // Keep camera ownership/edge replay before connection previews, while
      // consuming endpoint double-clicks before the shared text input path.
      const routed = navigation.handle(input)
      const connected = routed.handled && !routed.replay && input.type !== 'frame' ? { handled: true } : connectionEditing.handle(routed.replay || input, connectionTarget)
      if (connected.handled) { navigation.finishFrame(); return connected.result ?? (input.type.startsWith('key_') ? true : undefined) }
    }
    if (videoInput.handle(input)) { navigation.finishFrame(); return true }
    const edited = textInput.handle(input)
    if (edited.handled) { navigation.finishFrame(); return edited.result ?? true }
    const styled = styles.handle(input)
    if (styled.handled) { navigation.finishFrame(); return styled.result }
    const acted = actions.handle(input)
    if (acted.handled) { navigation.finishFrame(); return acted.result ?? true }
    // Native legacy: idle draw/highlight Escape leaves the tool and retains
    // selection. Active Escape continues to cancel only the current stroke.
    if (input.type === 'key_down' && matchesCanvasShortcut('escape', input) && ['draw', 'highlight'].includes(read().toolId) && read().mode === 'idle' && !session.state.get().isGestureActive && read().shortcutsEnabled) {
      if (toolIds.includes('select')) setTool('select')
      navigation.finishFrame(); return true
    }
    // Idle Escape still belongs to the active creation tool (leave it), while
    // select's idle Escape clears selection. Active Escape cancels the gesture.
    const creationEscape = input.type === 'key_down' && matchesCanvasShortcut('escape', input) && creationToolIds.includes(read().toolId)
    const eraserEscape = matchesCanvasShortcut('escape', input) && read().toolId === 'eraser'
    if (!creationEscape && !eraserEscape && selectionKeys.handle(input)) { navigation.cancel(); navigation.finishFrame(); return true }
    if (drawKeys.handle(input)) { navigation.finishFrame(); return true }
    if (toolIds.includes('eraser') && matchesCanvasShortcut('tool-eraser', input)) { setTool('eraser'); navigation.finishFrame(); return true }
    // Keyboard ownership, history/busy rejection and click counting have all
    // run before tool shortcuts. Mod+A belongs to selection; bare A to creation.
    const created = creation.handle(input)
    if (created.handled) { navigation.finishFrame(); return created.result ?? true }
    if (input.type === 'frame') tool.frame?.(input.time)
    const routed = navigation.handle(input)
    const event = routed.replay || input
    const cropped = !routed.handled || routed.replay ? cropTool.dispatch(event) : { handled: false }
    const result = cropped.handled ? cropped.result : routed.replay ? tool.dispatch(routed.replay) : routed.handled ? undefined : tool.dispatch(input)
    cropped.after?.()
    navigation.finishFrame()
    // The host uses the synchronous acknowledgement only to prevent browser
    // defaults. History/commit promises retain their normal error contract.
    return input.type.startsWith('key_') ? result ?? (routed.handled || cropped.handled || input.key === 'Escape') : result
  }
  return Object.freeze({
    state: Object.freeze({ get: read }),
    getSnappingPreferences() { assertActive(); return snaps.preferences() },
    setSnappingPreferences(patch) {
      assertActive(); snaps.setPreferences(patch)
      try {
        if (!session.state.get().isSubmitting) { connectionEditing.refreshSnapping(); tool.refreshSnapping?.() }
      } catch (error) { cancelTool(); report(error); throw error }
      change()
    },
    runAction(id, options) { assertActive(); return actions.run(id, options) },
    getActions() { assertActive(); return actions.describe() },
    // Immutable {source,next,selectionCount,styles}; Mixed/unsupported omit value.
    // Group queries include locked descendants, so Mixed can remain after a set.
    getStyles() { assertActive(); return styles.get() },
    // Single editable AI frame only; field drafts are immutable query/state
    // values outside Store. Host owns Enter/blur/Escape, finish saves once.
    getAiFrameSize() { assertActive(); return aiFrameSize.get() },
    editAiFrameSize(action) { assertActive(); return aiFrameSize.action(action) },
    // Validate the whole patch; change editable leaves only, never group opacity.
    // No selection edits session defaults only. Active text joins its existing
    // transaction; defaults adopt on save, and document undo does not rewind them.
    setStyles(patch) { assertActive(); return styles.set(patch) },
    getFilePasteTarget() { assertActive(); return clipboard.fileTarget() },
    setTool(id) { assertActive(); setTool(id) },
    setPenMode(enabled) { assertActive(); cancelTool(); change({ isPenMode: Boolean(enabled) }) },
    setCreationOptions(patch) { assertActive(); creation.setOptions(patch) },
    useRecentTool() { assertActive(); creation.useRecentTool() },
    beginToolDrag(options) { assertActive(); creation.beginToolDrag(options) },
    setWrapMode(enabled) { assertActive(); change({ isWrapMode: Boolean(enabled) }) },
    select(action) { assertActive(); if (session.state.get().isSubmitting) return false; navigation.cancel(); cancelTool(); return selectionNavigation.run(action) },
    setInputContext(value) { assertActive(); keyboard.context(value) },
    setShortcutsEnabled(enabled) { assertActive(); keyboard.shortcuts(enabled) },
    cropImage(action) { assertActive(); try { return cropTool.action(action) } catch (error) { cropTool.cancel(); report(error); throw error } },
    videoInput(action) { assertActive(); return videoInput.input(action) },
    imageAlt(action) { assertActive(); return imageAlt.action(action) },
    editText(action) { assertActive(); return textEditing.action(action) },
    setEdgeScrolling(enabled) { assertActive(); change({ edgeScrolling: Boolean(enabled) }); navigation.finishFrame() },
    setViewport(value) { assertActive(); minimap.cancel(); navigation.setViewport(value) },
    setMinimap(value) { assertActive(); minimap.setSize(value) },
    navigate(action, point = null, time = Math.max(0, lastTime)) {
      assertActive()
      if (!Number.isFinite(time) || time < 0) throw new Error('输入时间需要非负有限毫秒。')
      lastTime = Math.max(lastTime, time); minimap.cancel(); navigation.navigate(action, point, lastTime); navigation.finishFrame()
    },
    setCamera(value) { assertActive(); if (!value) throw new Error('相机需要有限坐标和正数缩放。'); const checked = checkedCamera(value); keyboard.cancel(); minimap.cancel(); navigation.reset(); cropTool.cancel(); cancelTool(); change({ camera: checked }) },
    dispatch(value) {
      assertActive()
      let input = normalizeInput(value)
      if (input.time < lastTime) throw new Error('输入时间必须单调递增。')
      lastTime = input.time
      try {
        const imageEdited = imageAlt.beforeKeyboard(input)
        if (imageEdited.handled) return imageEdited.result ?? true
        if (videoInput.beforeKeyboard(input)) return true
        const noted = noteEditing.beforeKeyboard(input)
        if (noted.handled) return noted.result ?? true
        const edited = textInput.beforeKeyboard(input)
        if (edited.handled) return edited.result ?? true
        const routed = keyboard.route(input)
        return routed.input ? dispatchCore(routed.input) : routed.result ?? routed.handled
      } catch (error) { keyboard.cancel(); minimap.cancel(); navigation.cancel(); cropTool.cancel(); cancelTool(); report(error); throw error }
    },
    dispose() { if (disposed) return; aiFrameSize.dispose(); styles.dispose(); imageAlt.dispose(); clipboard.dispose(); noteEditing.dispose(); textInput.dispose(); textEditing.dispose(); keyboard.cancel(); minimap.cancel(); navigation.cancel(); cropTool.finish(); cancelTool(); actions.dispose(); stop(); disposed = true },
  })
}
