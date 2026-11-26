import { layoutText } from './text.js'
import { richTextRuns } from './text-runs.js'

// Native old editor, 2026-11-26: s/m/l/xl = 18/22/26/32, line-height
// 1.35 rounded down to 1/64px, ~16-unit inset; all nine alignments observed.
export function geoLabelLayout(props) {
  const scale = props.scale || 1, padding = 16 * scale
  const size = ({ s: 18, m: 22, l: 26, xl: 32 }[props.size] || 22) * scale
  const content = richTextRuns(props.richText), font = props.font || 'sans'
  const layout = layoutText(content.text, { font, size, width: Math.max(1, props.w - padding * 2), runs: content.runs })
  const lineHeight = Math.floor(size * 1.35 * 64) / 64, h = layout.lines.length * lineHeight
  const w = Math.max(1, layout.w), height = props.h + Math.max(0, props.growY || 0)
  const x = ['start', 'start-legacy'].includes(props.align) ? padding : ['end', 'end-legacy'].includes(props.align) ? props.w - padding - w : (props.w - w) / 2
  const y = props.verticalAlign === 'start' ? padding : props.verticalAlign === 'end' ? height - padding - h : (height - h) / 2
  return { ...layout, lineHeight, x, y, w, h, font, scale: 1, align: props.align || 'middle', padding, unsupported: content.unsupported }
}
