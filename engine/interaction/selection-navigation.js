// Session-only selection commands, shared by pointer, keyboard and access links.
export function createSelectionNavigation({ index, targets, read, change }) {
  function reveal(id) {
    const box = index.getBounds(id), { camera, viewport } = read()
    if (!box) return {}
    const next = { ...camera }, z = camera.z
    // Native skip-to-content/Tab, 2026-11-26: preserve zoom, leave visible items
    // alone; an offscreen top-left lands at (256,256) CSS px even at 640×480.
    for (const [axis, size, extent] of [['x', 'w', viewport.w], ['y', 'h', viewport.h]]) {
      const start = (box[axis] + camera[axis]) * z, end = start + box[size] * z
      const padding = Math.min(256, Math.max(0, extent - box[size] * z))
      if (box[size] * z > extent) next[axis] = extent / (2 * z) - box[axis] - box[size] / 2
      else if (start < 0) next[axis] = padding / z - box[axis]
      else if (end > extent) next[axis] = (extent - padding) / z - box[axis] - box[size]
    }
    return { camera: next }
  }
  function run(action) {
    const state = read(), scope = targets.validScope(state.focusedGroupId), ids = state.selectedIds
    const selected = ids[0], record = index.getRecord(selected)
    if (action === 'all') { change({ selectedIds: targets.children(scope) }); return true }
    if (action === 'clear') {
      if (scope !== targets.pageId) change({ selectedIds: [scope], focusedGroupId: targets.scopeFor(scope, scope) })
      else change({ selectedIds: [] })
      return true
    }
    if (action === 'enter' || action === 'child') {
      if (ids.length !== 1 || !['group', 'frame'].includes(record?.type) || action === 'enter' && record.type !== 'group') return false
      const children = targets.children(selected)
      if (!children.length) return false
      change({ selectedIds: action === 'enter' ? children : [children[0]], ...(record.type === 'group' && { focusedGroupId: selected }) }); return true
    }
    if (action === 'parent') {
      const parent = index.getRecord(record?.parentId)
      if (parent?.typeName !== 'shape' || !targets.isSelectable(parent.id)) return false
      change({ selectedIds: [parent.id], focusedGroupId: targets.scopeFor(parent.id, scope) }); return true
    }
    const ordered = targets.readingOrder(action === 'first' ? targets.pageId : scope)
    let id = null
    if (action === 'first') id = ordered[0]
    else if (action === 'next' || action === 'previous') {
      const position = ordered.indexOf(selected), step = action === 'next' ? 1 : -1
      id = ordered[position < 0 ? (step > 0 ? 0 : ordered.length - 1) : (position + step + ordered.length) % ordered.length]
    } else if (['left', 'right', 'up', 'down'].includes(action)) id = selected ? targets.neighbor(selected, action, scope) : ordered[0]
    else throw new Error('未知选择操作。')
    if (!id) return false
    change({ selectedIds: [id], ...(action === 'first' && { focusedGroupId: targets.pageId }), ...reveal(id) }); return true
  }
  return { run }
}
