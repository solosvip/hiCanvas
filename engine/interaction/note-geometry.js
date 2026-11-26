import { getShapeBounds } from '../../renderer/geometry.js'
import { connectionCoordinates } from './connection-coordinates.js'

// 2026-11-26 opaque legacy app; native clicks and public getShapeHandles /
// shape records: edge midpoints, 200-square paper, gap10 * scale. Half/double
// scale right-neighbours began at +105/+420; growY100 bottom began at +310.
export function noteGeometry(index, shape) {
  const { w, h } = getShapeBounds(shape), scale = shape.props.scale || 1
  const coordinates = connectionCoordinates(index, shape.id)
  const offsets = { top: { x: 0, y: -(200 + 10) * scale }, right: { x: w + 10 * scale, y: 0 }, bottom: { x: 0, y: h + 10 * scale }, left: { x: -(200 + 10) * scale, y: 0 } }
  const midpoints = { top: { x: w / 2, y: 0 }, right: { x: w, y: h / 2 }, bottom: { x: w / 2, y: h }, left: { x: 0, y: h / 2 } }
  return { w, h, coordinates, offsets, handles: Object.entries(midpoints).map(([id, point]) => ({ id, kind: 'create', ...coordinates.page(point) })) }
}

export function adjacentNote(context, source, direction, id = `shape:${globalThis.crypto.randomUUID()}`) {
  const geometry = noteGeometry(context.index, source), offset = geometry.offsets[direction]
  const center = geometry.coordinates.page({ x: offset.x + geometry.w / 2, y: offset.y + 100 * (source.props.scale || 1) })
  const existing = context.index.hitsAtPoint(center).find(candidate => candidate !== source.id && context.index.getRecord(candidate)?.type === 'note' && context.index.getRecord(candidate).parentId === source.parentId && context.targets.isSelectable(candidate))
  if (existing) return { id: existing, commands: [] }
  const c = Math.cos(source.rotation), s = Math.sin(source.rotation)
  return { id, commands: [{ type: 'create_shape', id, shapeType: 'note', parentId: source.parentId, rotation: source.rotation,
    x: source.x + c * offset.x - s * offset.y, y: source.y + s * offset.x + c * offset.y,
    props: { ...source.props, growY: 0, textFirstEditedBy: null, richText: { type: 'doc', content: [{ type: 'paragraph' }] }, url: '' } }] }
}

// First strong letter, respecting an explicit rich-text direction. Native
// Arabic Tab selected the left neighbour, Shift+Tab reused the right one.
export function noteIsRtl(node) {
  if (['rtl', 'ltr'].includes(node?.attrs?.dir)) return node.attrs.dir === 'rtl'
  const text = node?.text || ''
  for (const char of text) {
    if (/\p{Letter}/u.test(char)) return /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(char)
  }
  for (const child of node?.content || []) {
    const direction = noteIsRtl(child)
    if (direction !== null) return direction
  }
  return null
}
