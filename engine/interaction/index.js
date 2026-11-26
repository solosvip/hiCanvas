import { atom } from '@tldraw/state'
import { checkedCamera, createSpatialIndex } from '../../renderer/geometry.js'
import { normalizeInput } from './input.js'
import { createSelectionTool } from './select.js'
import { createSelectionFrame } from './selection-frame.js'
import { describeSelection, checkedHandleMetrics } from './selection-handles.js'
import { createSelectionTargets } from './targets.js'
import { createHandTool } from './camera-pan.js'
import { createCameraContent } from './camera-content.js'
import { createCameraNavigation } from './camera-navigation.js'
import { checkedViewport } from './camera-math.js'
import { createMinimapInteraction } from './minimap.js'
import { checkedInputContext, createKeyboardInput } from './keyboard-input.js'

// Input contract: every event has time (monotonic host milliseconds) and modifier
// booleans. Pointer events carry CSS host-relative point, pointerId/type, pressure,
// button/buttons; key events carry key/code/repeat/isComposing and optional IME
// keyCode 229; wheel carries CSS-pixel delta. Hosts report inputContext with the
// setter on focus/composition changes. Only canvas-owned keys reach tools.
// Products choose allowed tools from this registry; tool state never enters the
// document Store. Future tools get the same normalized input and context.
export const canvasToolRegistry = Object.freeze({ select: createSelectionTool, hand: createHandTool })

// Optional handleMetrics are screen CSS pixels: cornerHit/edgeHit are
// half-extents, rotationOffset is per-axis, rotationRadius is a radius.
// Hosts may supply design tokens; the engine validates and copies the values.
export function createCanvasInteraction({ session, camera, pageId, toolIds = ['select', 'hand'], viewport, inputDevice = null, invertZoom = false, reduceMotion = false, edgeScrolling = true, handleMetrics, shortcutsEnabled = true, inputContext }) {
  if (!session?.store || !toolIds.length || toolIds.some(id => !Object.hasOwn(canvasToolRegistry, id))) throw new Error('交互模块需要运行时和已登记工具。')
  const metrics = checkedHandleMetrics(handleMetrics)
  const initial = session.store.allRecords(), activePage = pageId || initial.find(r => r.typeName === 'page')?.id
  const index = createSpatialIndex(initial, activePage), targets = createSelectionTargets(index, activePage)
  const content = createCameraContent(initial, index, activePage), selection = createSelectionFrame(initial, index)
  const state = atom('canvas interaction', Object.freeze({ toolId: toolIds[0], selectedIds: Object.freeze([]), selectionRotation: null, hoveredId: null, handleCursor: null, marquee: null, camera: Object.freeze(checkedCamera(camera)), mode: 'idle', viewport: checkedViewport(viewport), contentOffscreen: false, edgeScrolling: Boolean(edgeScrolling), needsFrame: false, temporaryTool: null, inputContext: checkedInputContext(inputContext), shortcutsEnabled: Boolean(shortcutsEnabled), overlays: Object.freeze([]), lastError: null }))
  let disposed = false, tool, navigation, minimap, keyboard, lastTime = -Infinity
  function read() { return state.get() }
  function change(patch = {}) {
    if (disposed) return
    const previous = read(), next = { ...previous, ...patch }
    next.selectedIds = Object.freeze([...next.selectedIds].filter(id => targets.isSelectable(id)))
    if (JSON.stringify(next.selectedIds) !== JSON.stringify(previous.selectedIds) && !Object.hasOwn(patch, 'selectionRotation')) next.selectionRotation = null
    if (next.hoveredId && !targets.isSelectable(next.hoveredId)) next.hoveredId = null
    next.camera = Object.freeze(checkedCamera(next.camera))
    next.contentOffscreen = content.offscreen(next.camera, next.viewport)
    next.minimap = minimap?.describe(next) || null
    next.marquee = next.marquee && Object.freeze({ ...next.marquee })
    const selected = describeSelection(selection, next.selectedIds, next.selectionRotation), overlays = selected ? [selected] : []
    if (next.marquee) overlays.push({ kind: 'marquee', bounds: next.marquee })
    next.overlays = Object.freeze(overlays.map(o => Object.freeze({ ...o, bounds: Object.freeze({ ...o.bounds }), ...(o.handles && { handles: Object.freeze(o.handles.map(h => Object.freeze(h))) }) })))
    if (JSON.stringify(next) !== JSON.stringify(previous)) state.set(Object.freeze(next))
  }
  function report(error) { change({ lastError: Object.freeze({ code: error.code || 'interaction', message: error.message }) }) }
  function setTool(id) {
    if (!toolIds.includes(id)) throw new Error('工具未向本产品开放。')
    keyboard?.cancel(); minimap?.cancel(); navigation?.cancel(); tool?.cancel(); tool = canvasToolRegistry[id](context); change({ toolId: id, handleCursor: null })
  }
  const context = { session, index, targets, selection, handleMetrics: metrics, read, change, report }
  navigation = createCameraNavigation({ session, read, change, content, cancelTool: () => tool.cancel(), setTool: id => { if (!toolIds.includes(id)) return false; setTool(id); return true }, inputDevice, invertZoom, reduceMotion })
  minimap = createMinimapInteraction({ session, read, change, content, navigation })
  context.navigation = navigation
  tool = canvasToolRegistry[read().toolId](context)
  keyboard = createKeyboardInput({ read, change, releaseKeys: navigation.releaseKeys,
    cancelPointer: () => { tool.cancel(); minimap.cancel(); navigation.cancelPan() }, dispatchPointer: dispatchCore,
    isBusy: () => session.state.get().isGestureActive || session.state.get().isSubmitting })
  const stop = session.store.addHistoryInterceptor(({ changes }) => {
    const checkBasis = !session.state.get().isGestureActive && read().selectionRotation !== null
    const before = checkBasis && selection.expected(read().selectedIds)
    index.applyChanges(changes); content.apply(changes); selection.apply(changes)
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
    if (minimap.handle(input)) { navigation.finishFrame(); return input.type.startsWith('key_') ? true : undefined }
    const routed = navigation.handle(input)
    const result = routed.replay ? tool.dispatch(routed.replay) : routed.handled ? undefined : tool.dispatch(input)
    navigation.finishFrame()
    // The host uses the synchronous acknowledgement only to prevent browser
    // defaults. History/commit promises retain their normal error contract.
    return input.type.startsWith('key_') ? result ?? (routed.handled || input.key === 'Escape') : result
  }
  return Object.freeze({
    state: Object.freeze({ get: read }),
    setTool(id) { assertActive(); setTool(id) },
    setInputContext(value) { assertActive(); keyboard.context(value) },
    setShortcutsEnabled(enabled) { assertActive(); keyboard.shortcuts(enabled) },
    setEdgeScrolling(enabled) { assertActive(); change({ edgeScrolling: Boolean(enabled) }); navigation.finishFrame() },
    setViewport(value) { assertActive(); minimap.cancel(); navigation.setViewport(value) },
    setMinimap(value) { assertActive(); minimap.setSize(value) },
    navigate(action, point = null, time = Math.max(0, lastTime)) {
      assertActive()
      if (!Number.isFinite(time) || time < 0) throw new Error('输入时间需要非负有限毫秒。')
      lastTime = Math.max(lastTime, time); minimap.cancel(); navigation.navigate(action, point, lastTime); navigation.finishFrame()
    },
    setCamera(value) { assertActive(); if (!value) throw new Error('相机需要有限坐标和正数缩放。'); const checked = checkedCamera(value); keyboard.cancel(); minimap.cancel(); navigation.reset(); tool.cancel(); change({ camera: checked }) },
    dispatch(value) {
      assertActive()
      const input = normalizeInput(value)
      if (input.time < lastTime) throw new Error('输入时间必须单调递增。')
      lastTime = input.time
      try {
        const routed = keyboard.route(input)
        return routed.input ? dispatchCore(routed.input) : routed.result ?? routed.handled
      } catch (error) { keyboard.cancel(); minimap.cancel(); navigation.cancel(); tool.cancel(); report(error); throw error }
    },
    dispose() { if (disposed) return; keyboard.cancel(); minimap.cancel(); navigation.cancel(); tool.cancel(); stop(); disposed = true },
  })
}
