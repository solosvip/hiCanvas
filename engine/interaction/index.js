import { atom } from '@tldraw/state'
import { checkedCamera, createSpatialIndex } from '../../renderer/geometry.js'
import { normalizeInput } from './input.js'
import { createSelectionTool } from './select.js'
import { createSelectionFrame } from './selection-frame.js'
import { describeSelection, checkedHandleMetrics } from './selection-handles.js'
import { createSelectionTargets } from './targets.js'
import { createSelectionNavigation } from './selection-navigation.js'
import { createSelectionShortcuts } from './selection-shortcuts.js'
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

// Input contract: every event has time (monotonic host milliseconds) and modifier
// booleans. Pointer events carry CSS host-relative point, pointerId/type, pressure,
// button/buttons; key events carry key/code/repeat/isComposing and optional IME
// keyCode 229; wheel carries CSS-pixel delta. Hosts report inputContext with the
// setter on focus/composition changes. Only canvas-owned keys reach tools.
// Products choose allowed tools from this registry; tool state never enters the
// document Store. Future tools get the same normalized input and context.
export const canvasToolRegistry = Object.freeze({ select: createSelectionTool, hand: createHandTool, text: createTextTool, draw: createDrawTool, highlight: createHighlightTool, geo: createGeoTool, frame: createFrameTool, 'ai-image': createAiImageTool, 'ai-draft': createAiDraftTool, 'ai-film': createAiFilmTool, 'ai-slides': createAiSlidesTool })

// Optional handleMetrics are screen CSS pixels: cornerHit/edgeHit are
// half-extents, rotationOffset is per-axis, rotationRadius is a radius.
// Hosts may supply design tokens; the engine validates and copies the values.
export function createCanvasInteraction({ session, camera, pageId, toolIds = ['select', 'hand'], viewport, inputDevice = null, invertZoom = false, reduceMotion = false, edgeScrolling = true, handleMetrics, shortcutsEnabled = true, inputContext, measureFrameTitle }) {
  if (!session?.store || !toolIds.length || toolIds.some(id => !Object.hasOwn(canvasToolRegistry, id))) throw new Error('交互模块需要运行时和已登记工具。')
  const metrics = checkedHandleMetrics(handleMetrics)
  let countClicks = createClickCounter()
  const initial = session.store.allRecords(), activePage = pageId || initial.find(r => r.typeName === 'page')?.id
  const index = createSpatialIndex(initial, activePage), targets = createSelectionTargets(index, activePage, initial)
  const content = createCameraContent(initial, index, activePage), selection = createSelectionFrame(initial, index)
  const state = atom('canvas interaction', Object.freeze({ toolId: toolIds[0], focusedGroupId: activePage, isWrapMode: false, isPenMode: false, selectedIds: Object.freeze([]), selectionRotation: null, hoveredId: null, handleCursor: null, marquee: null, scribble: null, textEditing: null, camera: Object.freeze(checkedCamera(camera)), mode: 'idle', viewport: checkedViewport(viewport), contentOffscreen: false, edgeScrolling: Boolean(edgeScrolling), needsFrame: false, temporaryTool: null, inputContext: checkedInputContext(inputContext), shortcutsEnabled: Boolean(shortcutsEnabled), overlays: Object.freeze([]), lastError: null }))
  let disposed = false, tool, navigation, minimap, keyboard, cropTool, selectionKeys, lastTime = -Infinity
  function read() { return state.get() }
  function change(patch = {}) {
    if (disposed) return
    const previous = read(), next = { ...previous, ...patch }
    next.focusedGroupId = targets.validScope(next.focusedGroupId)
    next.selectedIds = Object.freeze([...next.selectedIds].filter(id => targets.isSelectable(id)))
    if (JSON.stringify(next.selectedIds) !== JSON.stringify(previous.selectedIds) && !Object.hasOwn(patch, 'selectionRotation')) next.selectionRotation = null
    if (next.hoveredId && !targets.isSelectable(next.hoveredId)) next.hoveredId = null
    next.camera = Object.freeze(checkedCamera(next.camera))
    next.contentOffscreen = content.offscreen(next.camera, next.viewport)
    next.minimap = minimap?.describe(next) || null
    next.needsFrame = Boolean(next.needsFrame || tool?.needsFrame)
    next.scribble = next.scribble && Object.freeze({ ...next.scribble, bounds: Object.freeze({ ...next.scribble.bounds }), points: Object.freeze(next.scribble.points.map(p => Object.freeze({ ...p }))) })
    next.marquee = next.marquee && Object.freeze({ ...next.marquee })
    if (next.croppingId && !targets.isSelectable(next.croppingId)) { next.croppingId = null; next.mode = 'idle'; next.handleCursor = null }
    next.cropZoom = next.croppingId ? cropTool?.zoom(next.croppingId) || 0 : 0
    const selected = next.textEditing ? null : next.croppingId ? cropTool?.describe(next) : describeSelection(selection, next.selectedIds, next.selectionRotation), overlays = selected ? [selected] : []
    if (next.marquee) overlays.push({ kind: 'marquee', bounds: next.marquee })
    if (next.scribble) overlays.push(next.scribble)
    next.overlays = Object.freeze(overlays.map(o => Object.freeze({ ...o, bounds: Object.freeze({ ...o.bounds }), ...(o.handles && { handles: Object.freeze(o.handles.map(h => Object.freeze(h))) }) })))
    if (JSON.stringify(next) !== JSON.stringify(previous)) state.set(Object.freeze(next))
  }
  function report(error) { change({ lastError: Object.freeze({ code: error.code || 'interaction', message: error.message }) }) }
  function cancelTool() {
    // Context loss cancels real and comma pointers together. Recreate the
    // shared counter so neither a previous click nor an unreleased press leaks.
    countClicks = createClickCounter(); selectionKeys?.cancel(); tool?.cancel()
  }
  function setTool(id) {
    if (!toolIds.includes(id)) throw new Error('工具未向本产品开放。')
    keyboard?.cancel(); minimap?.cancel(); navigation?.cancel(); cropTool?.finish(); cancelTool(); tool = canvasToolRegistry[id](context); change({ toolId: id, handleCursor: null })
    creation.toolChanged(id)
    return tool
  }
  const context = { session, index, targets, selection, handleMetrics: metrics, read, change, report, measureFrameTitle, pageId: activePage, returnToSelect: () => { if (!disposed && toolIds.includes('select')) setTool('select') } }
  const creation = createCreationControls({ read, change, switchTool: setTool, canUseTool: id => toolIds.includes(id) })
  context.creation = creation
  cropTool = createImageCrop(context)
  navigation = createCameraNavigation({ session, read, change, content, cancelTool: () => { cancelTool(); cropTool.cancel() }, setTool: id => { if (!toolIds.includes(id)) return false; setTool(id); return true }, inputDevice, invertZoom, reduceMotion })
  minimap = createMinimapInteraction({ session, read, change, content, navigation })
  context.navigation = navigation
  const prepareText = () => { cancelTool(); cropTool.cancel(); navigation.cancel() }
  const textEditing = createTextEditing({ ...context, prepare: prepareText, inputContext: value => keyboard.context(value) })
  context.textEditing = textEditing
  const textInput = createTextInput({ ...context, prepare: prepareText, replay: dispatchCore, canCreate: () => toolIds.includes('text') }, textEditing)
  const selectionNavigation = createSelectionNavigation(context)
  context.select = selectionNavigation.run
  selectionKeys = createSelectionShortcuts(context)
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
    const after = checkBasis && selection.expected(read().selectedIds)
    const affected = checkBasis && [...Object.keys(changes.added), ...Object.keys(changes.updated), ...Object.keys(changes.removed)].some(id => before.has(id) || after.has(id))
    change(!session.state.get().isGestureActive && affected ? { selectionRotation: null } : {})
  })
  change()
  function assertActive() { if (disposed) throw new Error('交互模块已关闭。') }
  function dispatchCore(input) {
    // History rejection must preserve the active editing gesture. Runtime
    // owns busy/conflict checks; never route its rejection through tool.cancel.
    if (input.type === 'key_down' && input.key.toLowerCase() === 'z' && (input.metaKey || input.ctrlKey)) {
      return session[input.shiftKey ? 'redo' : 'undo']().then(result => { change({ lastError: null }); return result }).catch(error => { report(error); throw error })
    }
    if (session.state.get().isSubmitting) return
    // Count only input that reaches the canvas: a rejected click must not
    // prime a later double click (#139). The minimap keeps native dblclick.
    input = countClicks(input)
    // Physical-pointer Escape cancels through tool.dispatch below; clear its
    // click sequence too, before a later ordinary click can become click #2.
    if (input.type === 'key_down' && input.key === 'Escape') countClicks = createClickCounter()
    if (minimap.handle(input)) { navigation.finishFrame(); return input.type.startsWith('key_') ? true : undefined }
    const edited = textInput.handle(input)
    if (edited.handled) { navigation.finishFrame(); return edited.result ?? true }
    // Idle Escape still belongs to the active creation tool (leave it), while
    // select's idle Escape clears selection. Active Escape cancels the gesture.
    const creationEscape = input.type === 'key_down' && input.key === 'Escape' && creationToolIds.includes(read().toolId)
    if (!creationEscape && selectionKeys.handle(input)) { navigation.cancel(); navigation.finishFrame(); return true }
    if (drawKeys.handle(input)) { navigation.finishFrame(); return true }
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
        const edited = textInput.beforeKeyboard(input)
        if (edited.handled) return edited.result ?? true
        const routed = keyboard.route(input)
        return routed.input ? dispatchCore(routed.input) : routed.result ?? routed.handled
      } catch (error) { keyboard.cancel(); minimap.cancel(); navigation.cancel(); cropTool.cancel(); cancelTool(); report(error); throw error }
    },
    dispose() { if (disposed) return; textInput.dispose(); textEditing.dispose(); keyboard.cancel(); minimap.cancel(); navigation.cancel(); cropTool.finish(); cancelTool(); stop(); disposed = true },
  })
}
