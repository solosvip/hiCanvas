import { supportsShapeLink, checkedShapeLink } from '../shape-links.js'
import { unlockedShapes } from '../container-geometry.js'
import { CanvasEditError } from '../errors.js'

export function setShapeLink(store, { id, url }) {
  const shape = store.get(id)
  if (!supportsShapeLink(shape)) throw new CanvasEditError('此对象不支持附加链接。')
  if (!unlockedShapes(store, [shape]).length) throw new CanvasEditError('对象或祖先已锁定，不能编辑链接。')
  const next = checkedShapeLink(url)
  // Keep the stored spelling when the destination is semantically unchanged.
  // Invalid historical values can still be repaired or explicitly cleared.
  let previous
  try { previous = checkedShapeLink(shape.props.url) } catch { previous = null }
  if (next !== previous) store.put([{ ...shape, props: { ...shape.props, url: next } }])
  return { shapeId: id }
}
