import { createElement as h } from 'react'
import { textLayout } from './text.js'
import { noteLayout } from './note-layout.js'
import { geoLabelLayout } from './geo-label.js'
import { measureText } from './text-measure.js'
import { canvasFontStyle } from './font-families.js'
import { colorPaint, noteLabelPaint, NOTE_PAINT } from './palette.js'

function lines(layout, font, align = 'start') {
  return layout.lines.map((line, i) => {
    const left = line.left ?? (['end', 'end-legacy'].includes(align) ? layout.w / (layout.scale || 1) - line.width : ['middle', 'middle-legacy'].includes(align) ? (layout.w / (layout.scale || 1) - line.width) / 2 : 0)
    let offset = 0
    const runs = []
    for (const run of line.runs) for (const text of run.text.split(/(\t)/u)) {
      if (!text) continue
      if (text !== '\t') runs.push(h('tspan', { key: runs.length, x: left + offset, style: canvasFontStyle(font, run.weight, run.style) }, text))
      offset += measureText(text, { font, size: layout.size, weight: run.weight, style: run.style, offset }).width
    }
    return h('text', { key: i, y: (line.top ?? i * layout.lineHeight) + layout.lineHeight / 2, dominantBaseline: 'central', fontSize: layout.size, style: { whiteSpace: 'pre', textSpacingTrim: 'space-all', textAutospace: 'no-autospace' } }, runs)
  })
}

export function exportText(shape, records) {
  const p = shape.props
  if (shape.type === 'text') {
    const layout = textLayout(p)
    return h('g', { fill: colorPaint(p).text, transform: `scale(${layout.scale})` }, lines(layout, p.font || 'sans', p.textAlign))
  }
  if (shape.type === 'geo') {
    const layout = geoLabelLayout(p)
    return h('g', { transform: `translate(${layout.x} ${layout.y})`, fill: colorPaint({ color: p.labelColor || p.color }).text }, lines(layout, p.font || 'sans', p.align))
  }
  const layout = noteLayout(p), name = records[`user:${p.textFirstEditedBy}`]?.name || ''
  const author = name.trim().split(/\s+/u)[0], hasText = layout.lines.some(line => line.text.trim())
  return h('g', { transform: `scale(${layout.scale})`, fill: noteLabelPaint(p) },
    lines(layout, p.font || 'draw'),
    author && hasText ? h('svg', { x: layout.paperWidth * .4, y: layout.height - 18, width: layout.paperWidth * .6 - 7, height: 14, overflow: 'hidden' }, h('text', { x: layout.paperWidth * .6 - 7, y: 11, textAnchor: 'end', fontFamily: 'sans-serif', fontSize: 11, fill: NOTE_PAINT.text, opacity: .6 }, author)) : null)
}
