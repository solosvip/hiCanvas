import { atom } from '@tldraw/state'
import { checkedCamera, createSpatialIndex, screenToCanvas } from '../../renderer/geometry.js'
import { normalizeInput } from './input.js'
import { createSelectionTool } from './select.js'
import { createSelectionTargets } from './targets.js'

// Input contract: every event has time (monotonic host milliseconds) and modifier
// booleans. Pointer events carry CSS host-relative point, pointerId/type, pressure,
// button/buttons; key events carry key/code/repeat; wheel carries CSS-pixel delta.
// Products choose allowed tools from this registry; tool state never enters the
// document Store. Future tools get the same normalized input and context.
export const canvasToolRegistry = Object.freeze({ select: createSelectionTool })

export function createCanvasInteraction({ session, camera, pageId, toolIds = ['select'] }) {
  if (!session?.store || !toolIds.length || toolIds.some(id => !Object.hasOwn(canvasToolRegistry, id))) throw new Error('交互模块需要运行时和已登记工具。')
  const initial = session.store.allRecords(), activePage = pageId || initial.find(r => r.typeName === 'page')?.id
  const index = createSpatialIndex(initial, activePage), targets = createSelectionTargets(index, activePage)
  const state = atom('canvas interaction', Object.freeze({ toolId: toolIds[0], selectedIds: Object.freeze([]), hoveredId: null, marquee: null, camera: Object.freeze(checkedCamera(camera)), mode: 'idle', overlays: Object.freeze([]), lastError: null }))
  let disposed = false, tool, lastTime = -Infinity
  function read() { return state.get() }
  function change(patch = {}) {
    if (disposed) return
    const previous = read(), next = { ...previous, ...patch }
    next.selectedIds = Object.freeze([...next.selectedIds].filter(id => targets.isSelectable(id)))
    if (next.hoveredId && !targets.isSelectable(next.hoveredId)) next.hoveredId = null
    next.camera = Object.freeze(checkedCamera(next.camera))
    next.marquee = next.marquee && Object.freeze({ ...next.marquee })
    const overlays = next.selectedIds.map(id => ({ kind: 'selection', id, bounds: index.getBounds(id) })).filter(o => o.bounds)
    if (next.marquee) overlays.push({ kind: 'marquee', bounds: next.marquee })
    next.overlays = Object.freeze(overlays.map(o => Object.freeze({ ...o, bounds: Object.freeze({ ...o.bounds }) })))
    if (JSON.stringify(next) !== JSON.stringify(previous)) state.set(Object.freeze(next))
  }
  function report(error) { change({ lastError: Object.freeze({ code: error.code || 'interaction', message: error.message }) }) }
  const context = { session, index, targets, read, change, report }
  tool = canvasToolRegistry[read().toolId](context)
  const stop = session.store.addHistoryInterceptor(({ changes }) => { index.applyChanges(changes); change() })
  function assertActive() { if (disposed) throw new Error('交互模块已关闭。') }
  return Object.freeze({
    state: Object.freeze({ get: read }),
    setTool(id) {
      assertActive()
      if (!toolIds.includes(id)) throw new Error('工具未向本产品开放。')
      tool.cancel(); tool = canvasToolRegistry[id](context); change({ toolId: id })
    },
    setCamera(value) { assertActive(); if (!value) throw new Error('相机需要有限坐标和正数缩放。'); const checked = checkedCamera(value); tool.cancel(); change({ camera: checked }) },
    dispatch(value) {
      assertActive()
      const input = normalizeInput(value)
      if (input.time < lastTime) throw new Error('输入时间必须单调递增。')
      lastTime = input.time
      if (session.state.get().isSubmitting) return
      try {
        if (input.type === 'wheel') {
          const camera = read().camera
          if (input.ctrlKey || input.metaKey) {
            const point = screenToCanvas(input.point, camera), z = Math.min(8, Math.max(.01, camera.z * Math.exp(-input.delta.y * .002)))
            change({ camera: { x: input.point.x / z - point.x, y: input.point.y / z - point.y, z } })
          } else change({ camera: { ...camera, x: camera.x - input.delta.x / camera.z, y: camera.y - input.delta.y / camera.z } })
          return
        }
        return tool.dispatch(input)
      } catch (error) { tool.cancel(); report(error); throw error }
    },
    dispose() { if (disposed) return; tool.cancel(); stop(); disposed = true },
  })
}
