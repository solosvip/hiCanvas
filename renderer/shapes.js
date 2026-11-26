import { createElement as h, memo } from 'react'
import { useValue } from '@tldraw/state-react'
import { Text, FrameTitle } from './text-view.js'
import { getShapeBounds } from './bounds.js'
import { Geometry } from './geo.js'
import { colorPaint } from './palette.js'
import { Embed } from './embed.js'
import { Bookmark } from './bookmark.js'
import { FrameState } from './frame-state.js'
import { Note } from './note.js'
import { Connection } from './connection.js'
import { Stroke } from './stroke.js'
import { BackgroundLayer } from './backgrounds.js'
import { ImageShape as Image } from './image.js'

const drawings = Object.freeze({ draw: { body: Stroke }, highlight: { body: Stroke, background: Stroke } })

const colorOf = props => colorPaint(props).stroke
const connectionTypes = { line: Connection, arrow: Connection }

const Children = memo(function Children({ scene, parentId, camera }) {
  const ids = useValue('child ids', () => scene.ids(parentId), [scene, parentId])
  return ids.map(id => h(Shape, { scene, id, camera, key: id }))
})

const Shape = memo(function Shape({ scene, id, camera }) {
  const shape = useValue('shape record', () => scene.store.get(id), [scene, id])
  if (!shape || shape.opacity === 0) return null
  const props = shape.props
  let body = null
  if (shape.type === 'frame') body = [
    h('svg', { key: 'body', width: props.w, height: props.h, overflow: 'visible' },
      h('rect', { width: props.w, height: props.h, fill: 'white', stroke: colorOf(props), strokeWidth: 2 })),
    h(FrameTitle, { key: 'title', text: props.name || '', width: props.w, camera }),
    h('div', { key: 'children', 'data-frame-clip': id, style: { position: 'absolute', left: 0, top: 0, width: props.w, height: props.h, overflow: 'hidden' } }, h(BackgroundLayer, { scene, drawings, parentId: id }), h(Children, { scene, parentId: id, camera })),
    h(FrameState, { shape, key: 'generation-state' })
  ]
  else {
    if (connectionTypes[shape.type]) body = h(connectionTypes[shape.type], { scene, shape, key: 'body' })
    else if (getShapeBounds(shape)) body = shape.type === 'note' ? h(Note, { scene, shape, key: 'body' }) : shape.type === 'bookmark' ? h(Bookmark, { shape, scene, key: 'body' }) : shape.type === 'embed' ? h(Embed, { shape, scene, key: 'body' }) : shape.type === 'image' ? h(Image, { scene, props, key: 'body' }) : shape.type === 'text' ? h(Text, { props, key: 'body' }) : drawings[shape.type]?.body ? h(drawings[shape.type].body, { shape, key: 'body' }) : shape.type === 'geo' ? h(Geometry, { shape, key: 'body' }) : null
    body = [body, h(Children, { scene, parentId: id, camera, key: 'children' })]
  }
  return h('div', { 'data-shape-id': id, 'data-shape-type': shape.type, style: { position: 'absolute', left: 0, top: 0, transform: `translate(${shape.x}px, ${shape.y}px) rotate(${shape.rotation || 0}rad)`, transformOrigin: '0 0', opacity: shape.opacity ?? 1 } }, body)
})

export function CanvasWorld({ scene, camera }) {
  const { x, y, z } = useValue(camera)
  // Zero depth preserves the 2D camera math while changing the browser's
  // compositing strategy. Camera changes never touch shape records.
  return h('div', { 'data-renderer-world': '', style: { position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `scale(${z}) translate3d(${x}px, ${y}px, 0)` } }, h(BackgroundLayer, { scene, drawings }), h(Children, { scene, parentId: scene.pageId, camera }))
}
