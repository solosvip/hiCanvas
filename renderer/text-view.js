import { createElement as h, useMemo, useRef } from 'react'
import { textLayout } from './text.js'
import { colorPaint, FRAME_TITLE_PAINT } from './palette.js'
import { useValue } from '@tldraw/state-react'
import { canvasFontFamily } from './font-families.js'

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
  // Chromium floors half-pixel inline leading. Match its strut rounding so a
  // newly loaded face with odd ascent/descent does not shift above the line.
  return h('div', { style: { position: 'absolute', left: 0, top: baseline - Math.floor((size + ascent - descent) / 2), fontFamily: family, fontSize: size, lineHeight: `${size}px`, whiteSpace: 'pre', letterSpacing } }, displayed)
}

export function Text({ props }) {
  const { lines, size, scale, lineHeight, w, h: height } = textLayout(props)
  return h('div', { style: { width: w, height, color: colorPaint(props).text } },
    h('div', { style: { transformOrigin: '0 0', transform: `scale(${scale})` } },
      lines.map((line, i) => h(Line, { key: i, text: line.text, width: line.width, size, family: canvasFontFamily(props.font), baseline: i * lineHeight + size }))))
}

export function FrameTitle({ text, width, camera }) {
  const { z } = useValue(camera)
  const label = text || 'Frame'
  const naturalWidth = useMemo(() => {
    fontMetrics(12, 'system-ui')
    return Math.max(...label.split('\n').map(line => context.measureText(line).width)) + 12
  }, [label])
  const desiredWidth = Math.min(naturalWidth, width * z + 16)
  const viewport = useRef({ label, frameWidth: width, width: desiredWidth })
  // Ignore subpixel zoom changes until their cumulative difference reaches
  // half a screen pixel. Unclipped titles keep the same width at every zoom;
  // text / frame record changes apply immediately rather than using this gate.
  if (viewport.current.label !== label || viewport.current.frameWidth !== width || Math.abs(viewport.current.width - desiredWidth) >= .5) {
    viewport.current = { label, frameWidth: width, width: desiredWidth }
  }
  // 2026-11-25 对照运行中的旧版画面测量：屏幕字号12、标题高28，
  // 左移7、底留4；24高的浅色底，左右6内边距，系统UI字体。
  // 同一后备字体用于测字和绘制，保留实测的自然宽。仅标题订阅相机，
  // 不把缩放CSS变量继承给整张画板；文字过长省略，显式换行保留。
  // Explicit size + containment prevents title width changes propagating a
  // document-wide layout. Measuring a new label never runs on camera updates.
  return h('div', { 'data-frame-title-root': '', style: { position: 'absolute', left: 0, top: 0, width: naturalWidth, height: 28, contain: 'strict', transformOrigin: '0 0', transform: `scale(${1 / z}) translate(-7px, -28px)`, fontFamily: 'system-ui', fontSize: 12, color: FRAME_TITLE_PAINT.text } },
    h('div', { 'data-frame-title': '', style: { width: viewport.current.width, height: 28, boxSizing: 'border-box', paddingBottom: 4, overflow: 'hidden' } },
      h('div', { style: { height: 24, display: 'flex', alignItems: 'center', borderRadius: 4, background: FRAME_TITLE_PAINT.background, boxShadow: `inset 0 0 0 1px ${FRAME_TITLE_PAINT.background}` } },
        h('span', { title: label, style: { padding: '0 6px', whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' } }, label))))
}
