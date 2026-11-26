import { measureText } from './text-measure.js'
import { wrapText } from './text-wrap.js'
import { richTextRuns, lineTextRuns } from './text-runs.js'

const cached = new WeakMap()
const layoutKeys = ['size', 'scale', 'autoSize', 'w', 'font', 'richText']
export const plainText = node => richTextRuns(node).text

// All lengths are unscaled CSS pixels. Bounds apply shape scale exactly once.
export function layoutText(text, options = {}) {
  const { size = 24, width = Infinity, runs = [{ text, start: 0, end: text.length, weight: options.weight || 400, style: options.style || 'normal' }] } = options
  if (!(width > 0)) throw new Error('排版宽度需要正数或 Infinity。')
  const unknown = new Set()
  const measure = (start, end, hyphenated = false) => {
    let width = 0
    for (const run of lineTextRuns(runs, start, end, hyphenated)) {
      const result = measureText(run.text, { ...options, size, weight: run.weight, style: run.style, offset: width })
      width += result.width; result.unknown.forEach(c => unknown.add(c))
    }
    return { width }
  }
  const lines = wrapText(text, width, measure).map(line => ({ ...line, runs: lineTextRuns(runs, line.start, line.end, line.hyphenated) }))
  return { lines, size, lineHeight: size * 1.35, w: Math.max(0, ...lines.map(line => line.width)), h: lines.length * size * 1.35, unknown: [...unknown] }
}

export function textLayout(props) {
  const values = layoutKeys.map(key => props[key]), previous = cached.get(props)
  if (previous && values.every((value, i) => Object.is(value, previous.values[i]))) return previous.result
  const size = { s: 18, m: 24, l: 36, xl: 44 }[props.size] || 24
  const content = richTextRuns(props.richText), scale = props.scale || 1
  const width = props.autoSize ? Infinity : Math.max(1, props.w || 100)
  const layout = layoutText(content.text, { font: props.font || 'sans', size, width, runs: content.runs })
  const result = { ...layout, scale, w: (props.autoSize ? Math.max(1, layout.w) : width) * scale, h: layout.h * scale, unsupported: content.unsupported }
  cached.set(props, { values, result })
  return result
}
