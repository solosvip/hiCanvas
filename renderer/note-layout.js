import { layoutText } from './text.js'
import { richTextRuns, sliceTextRuns } from './text-runs.js'

const paperWidth = 200, padding = 16, textWidth = paperWidth - padding * 2
const cached = new WeakMap()
const layoutKeys = ['scale', 'size', 'fontSizeAdjustment', 'font', 'richText', 'growY', 'verticalAlign', 'align']

// Observed note geometry stays 200px wide with 16px padding. Only its shared
// text measurement/wrapping seam changes; line height retains 1/64px rounding.
export function noteLayout(props) {
  const values = layoutKeys.map(key => props[key]), previous = cached.get(props)
  if (previous && values.every((value, i) => Object.is(value, previous.values[i]))) return previous.result
  const scale = props.scale || 1
  const size = ({ s: 18, m: 22, l: 26, xl: 32 }[props.size] || 22) * (props.fontSizeAdjustment ?? 1)
  const font = props.font || 'draw', content = richTextRuns(props.richText)
  const layout = layoutText(content.text, { font, size, width: textWidth, runs: content.runs })
  const lineHeight = Math.floor(size * 1.35 * 64) / 64
  const height = Math.max(paperWidth + Math.max(0, props.growY || 0), layout.lines.length * lineHeight + padding * 2)
  const top = props.verticalAlign === 'start' ? padding : props.verticalAlign === 'end' ? height - padding - layout.lines.length * lineHeight : (height - layout.lines.length * lineHeight) / 2
  const lines = layout.lines.map((line, i) => {
    let alignedWidth = line.width
    if (line.width > textWidth && /[ \t]+$/u.test(line.text)) {
      const trimmed = line.text.replace(/[ \t]+$/u, ''), end = line.start + trimmed.length
      const runs = sliceTextRuns(content.runs, line.start, end).map(run => ({ ...run,
        start: run.start - line.start, end: run.end - line.start,
      }))
      alignedWidth = layoutText(trimmed, { font, size, runs }).w
    }
    const left = ['start', 'start-legacy'].includes(props.align) ? padding : ['end', 'end-legacy'].includes(props.align) ? paperWidth - padding - alignedWidth : (paperWidth - alignedWidth) / 2
    return { ...line, left, top: top + i * lineHeight }
  })
  const result = { w: paperWidth * scale, h: height * scale, paperWidth, height, size, scale, lineHeight, lines, unknown: layout.unknown, unsupported: content.unsupported }
  cached.set(props, { values, result })
  return result
}
