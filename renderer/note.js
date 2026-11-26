import { createElement as h } from 'react'
import { useValue } from '@tldraw/state-react'
import { noteLayout } from './note-layout.js'
import { NOTE_FONT_FAMILIES, splitNoteCharacters } from './note-text-metrics.js'
import { colorPaint, NOTE_PAINT, noteLabelPaint } from './palette.js'

let context
function NoteLine({ line, layout, props, index }) {
  const { size, lineHeight } = layout
  const family = NOTE_FONT_FAMILIES[props.font] || NOTE_FONT_FAMILIES.draw
  context ||= document.createElement('canvas').getContext('2d')
  context.font = `${size}px ${family}`
  const count = splitNoteCharacters(line.text).length
  const letterSpacing = count ? (line.width - context.measureText(line.text).width) / count : 0
  return h('div', { 'data-note-line': index, style: { position: 'absolute', left: line.left, top: line.top, fontSize: size, fontFamily: family, lineHeight: `${lineHeight}px`, whiteSpace: 'pre', letterSpacing } }, line.text)
}

export function Note({ shape, scene }) {
  const props = shape.props, layout = noteLayout(props)
  // Persisted attribution points at a document user, never at account settings.
  const name = useValue('note author', () => props.textFirstEditedBy ? scene.store.get(`user:${props.textFirstEditedBy}`)?.name || '' : '', [scene, props.textFirstEditedBy])
  const author = name.trim().split(/\s+/u)[0]
  const hasText = layout.lines.some(line => line.text.trim())
  // 2026-11-25 对照运行中的旧版画面测量：1px角、两层投影和纸面内阴影；
  // 署名11px，右7、下4，最多60%宽，只显示名字第一段，空便签不署名。
  const shadow = `0 4px 5px -5px ${NOTE_PAINT.shadowNear}, 0 11px 13px -10px ${NOTE_PAINT.shadowFar}, 0 48px 10px -10px ${NOTE_PAINT.shadowInset} inset`
  return h('div', { 'data-note-body': '', style: { width: layout.w, height: layout.h } },
    h('div', { style: { position: 'absolute', width: layout.paperWidth, height: layout.height, transformOrigin: '0 0', transform: `scale(${layout.scale})`, background: colorPaint(props).note, borderRadius: 1, boxShadow: shadow, color: noteLabelPaint(props) } },
      layout.lines.map((line, index) => h(NoteLine, { key: index, line, layout, props, index })),
      author && hasText ? h('div', { 'data-note-author': '', title: name, style: { position: 'absolute', right: 7, bottom: 4, maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'sans-serif', fontSize: 11, color: NOTE_PAINT.text, opacity: 0.6 } }, author) : null))
}
