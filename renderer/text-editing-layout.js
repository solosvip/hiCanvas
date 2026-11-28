import { textLayout } from './text.js'
import { geoLabelLayout } from './geo-label.js'
import { getConnectionGeometry } from './connection-geometry.js'
import { noteLayout } from './note-layout.js'

// Pure local-coordinate text placement, shared by painting and editing.
// Title natural width is a host measurement (ADR0011), never saved geometry.
export function getShapeTextLayout(shape, context, { zoom = 1, titleWidth } = {}) {
  if (shape.type === 'geo') return geoLabelLayout(shape.props)
  if (shape.type === 'note') {
    const layout = noteLayout(shape.props)
    return { ...layout, x: 16, y: layout.lines[0]?.top ?? 16, w: layout.paperWidth - 32, h: layout.lines.length * layout.lineHeight, font: shape.props.font, align: shape.props.align, autoSize: false }
  }
  if (shape.type === 'text') {
    const layout = textLayout(shape.props)
    return { ...layout, x: 0, y: 0, w: layout.w / layout.scale, h: layout.h / layout.scale, font: shape.props.font, align: shape.props.textAlign, autoSize: shape.props.autoSize }
  }
  if (shape.type === 'arrow') {
    // A zero-width character survives the label's blank-content guard and
    // supplies caret line height without changing the saved arrow record.
    const empty = { ...shape, props: { ...shape.props, richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u200b' }] }] } } }
    const label = getConnectionGeometry(shape, context).label || getConnectionGeometry(empty, context).label
    return { ...label, ...label.bounds, font: shape.props.font, scale: 1, align: 'middle', autoSize: true }
  }
  if (shape.type === 'frame') return { x: -7 / zoom, y: -28 / zoom, w: Math.max(1, Math.min(titleWidth ?? shape.props.w * zoom, shape.props.w * zoom + 16)) / zoom, h: 24 / zoom, size: 12 / zoom, lineHeight: 24 / zoom, font: null, scale: 1, align: 'start', autoSize: false }
  return null
}
