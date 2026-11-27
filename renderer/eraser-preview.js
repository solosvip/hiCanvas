import { atom } from '@tldraw/state'

// Each mounted shape subscribes only to its own bit. Updating a few roots
// never invalidates the record subscriptions of all other visible shapes.
export function createEraserPreview(store, color) {
  // DESIGN emits eight-digit hex; never replace a shape's own opacity or mask
  // a zero-sized group. The token is checked when a preview is first shown, not
  // at mount: display-only hosts (the content host, other products) load no
  // editing tokens and must still mount the renderer.
  let alpha = null
  const checkedAlpha = () => {
    if (alpha !== null) return alpha
    const hex = typeof color === 'string' && color.trim().match(/^#[\da-f]{6}([\da-f]{2})$/i)
    if (!hex) throw new Error('橡皮淡化缺少八位十六进制设计令牌。')
    return (alpha = parseInt(hex[1], 16) / 255)
  }
  const bits = new Map()
  let active = new Set()
  const bit = id => {
    if (!bits.has(id)) bits.set(id, atom(`eraser preview ${id}`, active.has(id)))
    return bits.get(id)
  }
  const stop = store.addHistoryInterceptor(({ changes }) => {
    for (const id of Object.keys(changes.removed)) { bits.get(id)?.set(false); bits.delete(id); active.delete(id) }
  })
  return {
    read: id => bit(id).get(),
    opacity: (id, original = 1) => original * (bit(id).get() ? checkedAlpha() : 1),
    set(overlays) {
      const next = new Set(overlays.filter(item => item.kind === 'eraser').flatMap(item => item.ids).filter(id => store.get(id)?.typeName === 'shape'))
      if (next.size) checkedAlpha()
      for (const id of active) if (!next.has(id)) bits.get(id)?.set(false)
      for (const id of next) if (!active.has(id)) bits.get(id)?.set(true)
      active = next
    },
    dispose() { stop(); bits.clear(); active.clear() },
  }
}
