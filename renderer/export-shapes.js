import { createElement as h } from 'react'
import { Geometry } from './geo.js'
import { Stroke } from './stroke.js'
import { Connection } from './connection.js'
import { exportText } from './export-text.js'
import { colorPaint, FRAME_TITLE_PAINT } from './palette.js'
import { noteLayout } from './note-layout.js'
import { measureFrameTitle } from './frame-title-measure.js'

function image(shape, source) {
  if (!source) throw new Error('媒体输出未准备好。')
  const p = shape.props, crop = shape.type === 'image' ? p.crop : null
  const a = crop?.topLeft || { x: 0, y: 0 }, b = crop?.bottomRight || { x: 1, y: 1 }
  const w = p.w / (b.x - a.x), height = p.h / (b.y - a.y)
  const flipX = shape.type === 'image' && p.flipX, flipY = shape.type === 'image' && p.flipY
  const clipId = `image-${[...shape.id].map(char => char.codePointAt(0).toString(16)).join('-')}`
  return h('svg', { width: p.w, height: p.h, overflow: 'hidden' },
    crop?.isCircle ? h('defs', null, h('clipPath', { id: clipId }, h('ellipse', { cx: p.w / 2, cy: p.h / 2, rx: p.w / 2, ry: p.h / 2 }))) : null,
    h('g', { clipPath: crop?.isCircle ? `url(#${clipId})` : undefined }, h('image', { href: source, x: -a.x * w, y: -a.y * height, width: w, height, preserveAspectRatio: 'none', transform: `translate(${flipX ? (1 - 2 * a.x) * w : 0} ${flipY ? (1 - 2 * a.y) * height : 0}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})` })))
}

export function exportShape(shape, { scene, store, media, background }) {
  if (shape.type === 'geo') return [h(Geometry, { key: 'geo', shape }), h('g', { key: 'text' }, exportText(shape, scene.records))]
  if (shape.type === 'draw' || shape.type === 'highlight') return h(Stroke, { shape, background })
  if (['arrow', 'line'].includes(shape.type)) return h(Connection, { shape, scene: { store } })
  if (shape.type === 'text') return exportText(shape, scene.records)
  if (shape.type === 'note') {
    const layout = noteLayout(shape.props)
    return [h('rect', { key: 'paper', width: layout.w, height: layout.h, rx: layout.scale, fill: colorPaint(shape.props).note }), h('g', { key: 'text' }, exportText(shape, scene.records))]
  }
  if (shape.type === 'frame') {
    const label = shape.props.name || 'Frame'
    if (!globalThis.document) throw new Error('画框标题输出需要浏览器的共享标题测量。')
    const width = Math.min(measureFrameTitle(label), shape.props.w + 16)
    return [h('rect', { key: 'frame', width: shape.props.w, height: shape.props.h, fill: 'white', stroke: colorPaint(shape.props).stroke, strokeWidth: 2 }),
      h('svg', { key: 'title', x: -7, y: -28, width, height: 24, overflow: 'hidden' }, h('rect', { width: '100%', height: 24, rx: 4, fill: FRAME_TITLE_PAINT.background }), h('text', { x: 6, y: 16, fontFamily: 'system-ui', fontSize: 12, fill: FRAME_TITLE_PAINT.text }, label))]
  }
  if (['image', 'video', 'embed', 'bookmark'].includes(shape.type)) return image(shape, media.get(shape.id))
  if (shape.type === 'group') return null
  throw new Error(`不支持输出对象类型：${shape.type}`)
}
