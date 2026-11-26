import { plainText } from './text.js'
import { measureNoteText, splitNoteCharacters } from './note-text-metrics.js'

const paperWidth = 200, padding = 16, textWidth = paperWidth - padding * 2

function wrapParagraph(paragraph, size, font) {
  const lines = []
  let text = ''
  const push = () => { lines.push(text); text = '' }
  // Latin words stay together; CJK and emoji may break at grapheme boundaries.
  // Runtime pre-wrap preserves spaces; TAB occupies one space. A trailing run
  // may hang past the line, moving the following word to the next line.
  const tokens = paragraph.replace(/\t/g, ' ').match(/[\u0000-\u024f]+|[^\u0000-\u024f]+/gu) || []
  const words = tokens.flatMap(token => /^[\u0000-\u024f]+$/.test(token) ? token.match(/[^ ]+| +/g) : splitNoteCharacters(token))
  for (const word of words) {
    if (/^ +$/.test(word)) { text += word; continue }
    if (measureNoteText(text + word, size, font) > textWidth && text) push()
    if (measureNoteText(word, size, font) <= textWidth) text += word
    else for (const char of splitNoteCharacters(word)) {
      if (measureNoteText(text + char, size, font) > textWidth && text) push()
      text += char
    }
  }
  push()
  return lines
}

// 2026-11-25 对照运行中的旧版画面测量：200×200，四边16；
// 四档字号18/22/26/32，行高1.35，Chromium布局取1/64像素。
export function noteLayout(props) {
  const scale = props.scale || 1
  const size = ({ s: 18, m: 22, l: 26, xl: 32 }[props.size] || 22) * (props.fontSizeAdjustment ?? 1)
  const lineHeight = Math.floor(size * 1.35 * 64) / 64
  const lines = plainText(props.richText).split('\n').flatMap(paragraph => wrapParagraph(paragraph, size, props.font)).map(text => ({ text, width: measureNoteText(text, size, props.font) }))
  const height = Math.max(paperWidth + Math.max(0, props.growY || 0), lines.length * lineHeight + padding * 2)
  const top = props.verticalAlign === 'start' ? padding : props.verticalAlign === 'end' ? height - padding - lines.length * lineHeight : (height - lines.length * lineHeight) / 2
  for (const [i, line] of lines.entries()) {
    const alignedWidth = line.width > textWidth ? measureNoteText(line.text.trimEnd(), size, props.font) : line.width
    line.left = ['start', 'start-legacy'].includes(props.align) ? padding : ['end', 'end-legacy'].includes(props.align) ? paperWidth - padding - alignedWidth : (paperWidth - alignedWidth) / 2
    line.top = top + i * lineHeight
  }
  return { w: paperWidth * scale, h: height * scale, paperWidth, height, size, scale, lineHeight, lines }
}
