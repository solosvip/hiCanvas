import { createElement as h } from 'react'
import { textLayout } from './text.js'
import { colorPaint } from './palette.js'

let context
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
function fontMetrics(size, family) {
  context ||= document.createElement('canvas').getContext('2d')
  context.font = `${size}px ${family}`
  const metrics = context.measureText('M')
  return { ascent: metrics.fontBoundingBoxAscent, descent: metrics.fontBoundingBoxDescent }
}

// Chromium re-lays out SVG text when an ancestor's CSS scale changes, including
// during native wheel hit testing. HTML lines keep their layout across camera
// transforms. Measure only when a record renders, never for camera updates.
function Line({ text, width, size, family, baseline }) {
  // SVG's collapsed whitespace displayed tabs as spaces. Keep that display
  // semantic while preserving the raw record and the shared estimated widths.
  const displayed = text.replace(/\t/g, ' ')
  const { ascent, descent } = fontMetrics(size, family)
  const naturalWidth = context.measureText(displayed).width
  // Per-line transforms are expensive on large boards. Use
  // spacing for the existing approximate widths; glyphs retain their height.
  const letters = [...graphemes.segment(displayed)].length
  const letterSpacing = width && letters ? (width - naturalWidth) / letters : 0
  return h('div', { style: { position: 'absolute', left: 0, top: baseline - (size + ascent - descent) / 2, fontFamily: family, fontSize: size, lineHeight: `${size}px`, whiteSpace: 'pre', letterSpacing } }, displayed)
}

export function Text({ props }) {
  const { lines, size, scale, lineHeight, w, h: height } = textLayout(props)
  return h('div', { style: { width: w, height, color: colorPaint(props).text } },
    h('div', { style: { transformOrigin: '0 0', transform: `scale(${scale})` } },
      lines.map((line, i) => h(Line, { key: i, text: line.text, width: line.width, size, family: 'monospace', baseline: i * lineHeight + size }))))
}

export function FrameTitle({ text, color }) {
  return h('div', { style: { position: 'absolute', left: 0, top: 0, color } }, h(Line, { text, size: 14, family: 'sans-serif', baseline: -8 }))
}
