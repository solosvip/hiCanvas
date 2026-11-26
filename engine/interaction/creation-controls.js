import { geometryVariants, creationToolIds } from './creation-presets.js'

// Product choices stay in the interaction atom. They never become commands,
// preferences in a document record, or entries in an actor's undo history.
export function createCreationControls({ read, change, switchTool, canUseTool }) {
  let generation = 0, toolbarTool = null
  change({ creation: Object.freeze({ geo: 'rectangle', toolLocked: false, dynamicSize: false, recentTool: null, dragFromToolbar: false }) })
  function endToolbar() {
    if (read().creation.dragFromToolbar) change({ creation: Object.freeze({ ...read().creation, dragFromToolbar: false }) })
  }
  function takeSource(id) {
    if (toolbarTool !== id) return 'canvas'
    toolbarTool = null
    change({ creation: Object.freeze({ ...read().creation, dragFromToolbar: true }) })
    return 'toolbar'
  }
  function beginToolDrag(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['toolId', 'geo'].includes(key))) throw new Error('工具栏起手需要工具及可选几何变体。')
    if (!creationToolIds.includes(options.toolId) || !canUseTool(options.toolId)) throw new Error('创建工具未向本产品开放。')
    if (Object.hasOwn(options, 'geo') && (options.toolId !== 'geo' || !geometryVariants.includes(options.geo))) throw new Error('未知或不适用的几何变体。')
    if (Object.hasOwn(options, 'geo')) setOptions({ geo: options.geo })
    toolbarTool = options.toolId
    try { switchTool(options.toolId) } finally { toolbarTool = null }
  }
  function toolChanged(id) {
    generation++
    if (!creationToolIds.includes(id)) return
    const recentTool = Object.freeze({ toolId: id, ...(id === 'geo' && { geo: read().creation.geo }) })
    change({ creation: Object.freeze({ ...read().creation, recentTool }) })
  }
  function setOptions(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['geo', 'toolLocked', 'dynamicSize'].includes(key))) throw new Error('创建选项需要已知的属性。')
    if (Object.hasOwn(patch, 'geo') && !geometryVariants.includes(patch.geo)) throw new Error('未知的几何变体。')
    for (const key of ['toolLocked', 'dynamicSize']) if (Object.hasOwn(patch, key) && typeof patch[key] !== 'boolean') throw new Error('工具锁和动态尺寸需要布尔值。')
    const changedGeo = Object.hasOwn(patch, 'geo') && patch.geo !== read().creation.geo
    change({ creation: Object.freeze({ ...read().creation, ...patch }) })
    if (changedGeo && read().toolId === 'geo') toolChanged('geo')
  }
  function useRecentTool() {
    const recent = read().creation.recentTool || { toolId: 'geo', geo: read().creation.geo }
    if (!canUseTool(recent.toolId)) throw new Error('工具未向本产品开放。')
    if (recent.geo) setOptions({ geo: recent.geo })
    switchTool(recent.toolId)
  }
  function handle(input) {
    if (input.type !== 'key_down' || input.repeat || input.metaKey || input.ctrlKey || input.altKey || input.shiftKey) return { handled: false }
    const key = input.key.toLowerCase(), tool = { r: 'geo', o: 'geo', g: 'geo', f: 'frame' }[key]
    if (key === 'q' && creationToolIds.some(canUseTool)) { setOptions({ toolLocked: !read().creation.toolLocked }); return { handled: true } }
    if (key === 'a' && canUseTool('ai-image')) return { handled: true, result: switchTool('ai-image').activateAtCenter() }
    if (!tool || !canUseTool(tool)) return { handled: false }
    if (key === 'r' || key === 'o') setOptions({ geo: key === 'r' ? 'rectangle' : 'ellipse' })
    switchTool(tool)
    return { handled: true }
  }
  return { setOptions, useRecentTool, beginToolDrag, takeSource, endToolbar, toolChanged, handle, generation: () => generation }
}
