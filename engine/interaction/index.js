import { atom } from '@tldraw/state'
import { checkedCamera, createSpatialIndex } from '../../renderer/geometry.js'
import { normalizeInput } from './input.js'
import { createSelectionTool } from './select.js'
import { createSelectionTargets } from './targets.js'
import { createHandTool } from './camera-pan.js'
import { createCameraContent } from './camera-content.js'
import { createCameraNavigation } from './camera-navigation.js'
import { checkedViewport } from './camera-math.js'

// Input contract: every event has time (monotonic host milliseconds) and modifier
// booleans. Pointer events carry CSS host-relative point, pointerId/type, pressure,
// button/buttons; key events carry key/code/repeat; wheel carries CSS-pixel delta.
// Products choose allowed tools from this registry; tool state never enters the
// document Store. Future tools get the same normalized input and context.
export const canvasToolRegistry = Object.freeze({ select: createSelectionTool, hand: createHandTool })

export function createCanvasInteraction({ session, camera, pageId, toolIds = ['select', 'hand'], viewport, inputDevice = null, invertZoom = false, reduceMotion = false, edgeScrolling = true }) {
  if (!session?.store || !toolIds.length || toolIds.some(id => !Object.hasOwn(canvasToolRegistry, id))) throw new Error('交互模块需要运行时和已登记工具。')
  const initial = session.store.allRecords(), activePage = pageId || initial.find(r => r.typeName === 'page')?.id
  const index = createSpatialIndex(initial, activePage), targets = createSelectionTargets(index, activePage)
  const content = createCameraContent(initial, index, activePage)
  const state = atom('canvas interaction', Object.freeze({ toolId: toolIds[0], selectedIds: Object.freeze([]), hoveredId: null, marquee: null, camera: Object.freeze(checkedCamera(camera)), mode: 'idle', viewport: checkedViewport(viewport), contentOffscreen: false, edgeScrolling: Boolean(edgeScrolling), needsFrame: false, temporaryTool: null, overlays: Object.freeze([]), lastError: null }))
  let disposed = false, tool, navigation, lastTime = -Infinity
  function read() { return state.get() }
  function change(patch = {}) {
    if (disposed) return
    const previous = read(), next = { ...previous, ...patch }
    next.selectedIds = Object.freeze([...next.selectedIds].filter(id => targets.isSelectable(id)))
    if (next.hoveredId && !targets.isSelectable(next.hoveredId)) next.hoveredId = null
    next.camera = Object.freeze(checkedCamera(next.camera))
    next.contentOffscreen = content.offscreen(next.camera, next.viewport)
    next.marquee = next.marquee && Object.freeze({ ...next.marquee })
    const overlays = next.selectedIds.map(id => ({ kind: 'selection', id, bounds: index.getBounds(id) })).filter(o => o.bounds)
    if (next.marquee) overlays.push({ kind: 'marquee', bounds: next.marquee })
    next.overlays = Object.freeze(overlays.map(o => Object.freeze({ ...o, bounds: Object.freeze({ ...o.bounds }) })))
    if (JSON.stringify(next) !== JSON.stringify(previous)) state.set(Object.freeze(next))
  }
  function report(error) { change({ lastError: Object.freeze({ code: error.code || 'interaction', message: error.message }) }) }
  function setTool(id) {
    if (!toolIds.includes(id)) throw new Error('工具未向本产品开放。')
    navigation?.cancel(); tool?.cancel(); tool = canvasToolRegistry[id](context); change({ toolId: id })
  }
  const context = { session, index, targets, read, change, report }
  navigation = createCameraNavigation({ session, read, change, content, cancelTool: () => tool.cancel(), setTool: id => { if (!toolIds.includes(id)) return false; setTool(id); return true }, inputDevice, invertZoom, reduceMotion })
  context.navigation = navigation
  tool = canvasToolRegistry[read().toolId](context)
  const stop = session.store.addHistoryInterceptor(({ changes }) => { index.applyChanges(changes); content.apply(changes); change() })
  change()
  function assertActive() { if (disposed) throw new Error('交互模块已关闭。') }
  return Object.freeze({
    state: Object.freeze({ get: read }),
    setTool(id) { assertActive(); setTool(id) },
    setEdgeScrolling(enabled) { assertActive(); change({ edgeScrolling: Boolean(enabled) }); navigation.finishFrame() },
    setViewport(value) { assertActive(); navigation.setViewport(value) },
    navigate(action, point = null, time = Math.max(0, lastTime)) {
      assertActive()
      if (!Number.isFinite(time) || time < 0) throw new Error('输入时间需要非负有限毫秒。')
      lastTime = Math.max(lastTime, time); navigation.navigate(action, point, lastTime); navigation.finishFrame()
    },
    setCamera(value) { assertActive(); if (!value) throw new Error('相机需要有限坐标和正数缩放。'); const checked = checkedCamera(value); navigation.reset(); tool.cancel(); change({ camera: checked }) },
    dispatch(value) {
      assertActive()
      const input = normalizeInput(value)
      if (input.time < lastTime) throw new Error('输入时间必须单调递增。')
      lastTime = input.time
      // History rejection must preserve the active editing gesture. Runtime
      // owns busy/conflict checks; never route its rejection through tool.cancel.
      if (input.type === 'key_down' && input.key.toLowerCase() === 'z' && (input.metaKey || input.ctrlKey)) {
        return session[input.shiftKey ? 'redo' : 'undo']().then(result => { change({ lastError: null }); return result }).catch(error => { report(error); throw error })
      }
      if (session.state.get().isSubmitting) return
      try {
        const routed = navigation.handle(input)
        const result = routed.replay ? tool.dispatch(routed.replay) : routed.handled ? undefined : tool.dispatch(input)
        navigation.finishFrame()
        return result
      } catch (error) { navigation.cancel(); tool.cancel(); report(error); throw error }
    },
    dispose() { if (disposed) return; navigation.cancel(); tool.cancel(); stop(); disposed = true },
  })
}
