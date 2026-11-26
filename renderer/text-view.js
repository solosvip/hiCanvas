import { createElement as h, useMemo, useRef } from 'react'
import { textLayout, plainText } from './text.js'
import { colorPaint, FRAME_TITLE_PAINT } from './palette.js'
import { useValue } from '@tldraw/state-react'
import { canvasFontStyle } from './font-families.js'
import { measureFrameTitle } from './frame-title-measure.js'
import { geoLabelLayout } from './geo-label.js'

// Shape data supplies dimensions and font size. Each calculated line is kept
// intact; the browser only paints glyphs, never chooses another line break.
export function TextLines({ layout, font, align = 'start' }) {
  return layout.lines.map((line, i) => h('div', { key: i, 'data-text-line': i, style: {
    ...canvasFontStyle(font),
    position: 'absolute', left: 0, top: i * layout.lineHeight, width: '100%', height: layout.lineHeight,
    fontSize: layout.size, lineHeight: `${layout.lineHeight}px`, whiteSpace: 'pre', tabSize: 2,
    textAlign: align === 'middle' ? 'center' : align, textSpacingTrim: 'space-all', textAutospace: 'no-autospace',
  } }, line.runs.map((run, j) => h('span', { key: j, style: canvasFontStyle(font, run.weight, run.style) }, run.text))))
}

export function Text({ props }) {
  const layout = textLayout(props)
  return h('div', { 'data-shape-text': '', style: { width: layout.w, height: layout.h, color: colorPaint(props).text } },
    h('div', { style: { position: 'relative', width: layout.w / layout.scale, height: layout.h / layout.scale, transformOrigin: '0 0', transform: `scale(${layout.scale})` } },
      h(TextLines, { layout, font: props.font, align: props.textAlign })))
}

export function GeoLabel({ props }) {
  if (!plainText(props.richText).trim()) return null
  const layout = geoLabelLayout(props)
  if (!layout.lines.some(line => line.text.trim())) return null
  return h('div', { 'data-shape-text': '', 'data-geo-label': '', style: { position: 'absolute', left: layout.x, top: layout.y, width: layout.w, height: layout.h, color: colorPaint({ color: props.labelColor || props.color }).text } }, h(TextLines, { layout, font: props.font, align: props.align }))
}

export function FrameTitle({ text, width, camera }) {
  const { z } = useValue(camera)
  const label = text || 'Frame'
  const naturalWidth = useMemo(() => measureFrameTitle(label), [label])
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
  return h('div', { 'data-frame-title-root': '', style: { position: 'absolute', left: 0, top: 0, width: naturalWidth, height: 28, contain: 'strict', transformOrigin: '0 0', transform: `scale(${1 / z}) translate(-7px, -28px)`, fontFamily: 'system-ui', fontSize: 12, color: FRAME_TITLE_PAINT.text, textSpacingTrim: 'space-all', textAutospace: 'no-autospace' } },
    h('div', { 'data-frame-title': '', style: { width: viewport.current.width, height: 28, boxSizing: 'border-box', paddingBottom: 4, overflow: 'hidden' } },
      h('div', { style: { height: 24, display: 'flex', alignItems: 'center', borderRadius: 4, background: FRAME_TITLE_PAINT.background, boxShadow: `inset 0 0 0 1px ${FRAME_TITLE_PAINT.background}` } },
        h('span', { title: label, style: { padding: '0 6px', whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' } }, label))))
}
