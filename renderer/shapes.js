import { createElement as h, memo } from 'react'
import { useValue } from '@tldraw/state-react'
import { textLayout } from './text.js'
import { getShapeBounds } from './bounds.js'
import { Geometry } from './geo.js'
import { colorPaint } from './palette.js'

const colorOf = props => colorPaint(props).stroke

const Children = memo(function Children({ scene, parentId }) {
  const ids = useValue('child ids', () => scene.ids(parentId), [scene, parentId])
  return ids.map(id => h(Shape, { scene, id, key: id }))
})

function Text({ props }) {
  const { lines, size, scale, lineHeight, w, h: height } = textLayout(props)
  return h('svg', { width: w, height, overflow: 'visible' },
    h('g', { transform: `scale(${scale})`, fill: colorPaint(props).text, fontFamily: 'monospace', fontSize: size },
      lines.map((line, i) => h('text', { key: i, x: 0, y: i * lineHeight + size, textLength: line.width || undefined, lengthAdjust: 'spacingAndGlyphs' }, line.text))))
}

function Image({ scene, props }) {
  const asset = useValue('image asset', () => props.assetId ? scene.store.get(props.assetId) : undefined, [scene, props.assetId])
  return h('img', { src: asset?.props.src || undefined, alt: props.altText || '', width: props.w, height: props.h, draggable: false, decoding: 'async' })
}

const Shape = memo(function Shape({ scene, id }) {
  const shape = useValue('shape record', () => scene.store.get(id), [scene, id])
  if (!shape || shape.opacity === 0) return null
  const props = shape.props
  let body = null
  if (shape.type === 'frame') body = [
    h('svg', { key: 'body', width: props.w, height: props.h, overflow: 'visible' },
      h('rect', { width: props.w, height: props.h, fill: 'white', stroke: colorOf(props), strokeWidth: 2 }),
      h('text', { x: 0, y: -8, fill: colorOf(props), fontFamily: 'sans-serif', fontSize: 14 }, props.name || '')),
    h('div', { key: 'children', 'data-frame-clip': id, style: { position: 'absolute', left: 0, top: 0, width: props.w, height: props.h, overflow: 'hidden' } }, h(Children, { scene, parentId: id }))
  ]
  else {
    if (getShapeBounds(shape)) body = shape.type === 'image' ? h(Image, { scene, props, key: 'body' }) : shape.type === 'text' ? h(Text, { props, key: 'body' }) : h(Geometry, { shape, key: 'body' })
    body = [body, h(Children, { scene, parentId: id, key: 'children' })]
  }
  return h('div', { 'data-shape-id': id, 'data-shape-type': shape.type, style: { position: 'absolute', left: 0, top: 0, transform: `translate(${shape.x}px, ${shape.y}px) rotate(${shape.rotation || 0}rad)`, transformOrigin: '0 0', opacity: shape.opacity ?? 1 } }, body)
})

export function CanvasWorld({ scene, camera }) {
  const { x, y, z } = useValue(camera)
  return h('div', { 'data-renderer-world': '', style: { position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `scale(${z}) translate(${x}px, ${y}px)` } }, h(Children, { scene, parentId: scene.pageId }))
}
