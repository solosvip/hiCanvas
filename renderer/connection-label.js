import { layoutText } from './text.js'
import { connectionWidth, CONNECTION_METRICS } from './connection-metrics.js'
import { canvasFonts } from './font-families.js'
import { richTextRuns } from './text-runs.js'
import { measureText } from './text-measure.js'

// Same deterministic shaping as standalone text; no per-glyph ASCII estimates.
export const connectionFonts = canvasFonts
export function connectionLabel(props, path) {
  const { text, runs } = richTextRuns(props.richText)
  if (!text.trim()) return null
  // Legacy four-size mono labels measured 2026-11-25: 18/20/24/28px.
  const scale = props.scale || 1, size = ({ s: 18, m: 20, l: 24, xl: 28 }[props.size] || 20) * scale
  const layout = layoutText(text, { font: props.font || 'sans', size, runs })
  // SVG treats tabs as spaces. Position each tab-separated run using the same
  // advances as geometry; do not ask SVG to approximate the tab stops.
  const textLines = layout.lines.map(line => {
    let left = 0
    const positionedRuns = []
    for (const run of line.runs) for (const text of run.text.split(/(\t)/)) {
      if (!text) continue
      if (text !== '\t') positionedRuns.push({ ...run, text, left })
      left += measureText(text, { font: props.font || 'sans', size, weight: run.weight, style: run.style, offset: left }).width
    }
    return { ...line, positionedRuns }
  })
  const lines = layout.lines.map(line => line.text), widths = layout.lines.map(line => line.width)
  const lineHeight = size * CONNECTION_METRICS.labelLineHeight, w = layout.w, h = lines.length * lineHeight
  // End-label sweeps (none/arrow/triangle/dot, every size) leave 24.25,
  // 27.25,30.25,60.25 units beyond half the label at capped ends. None/pipe
  // permit the label center at the terminal; short paths center the label.
  const width = connectionWidth(props), reserve = Math.max(20 * scale + 2 * width, 6 * width) + .25 * scale
  const limit = head => ['none', 'pipe', undefined].includes(head) ? 0 : w / 2 + reserve
  const min = limit(props.arrowheadStart), max = path.length - limit(props.arrowheadEnd)
  const position = Math.max(0, Math.min(1, props.labelPosition ?? .5)) * path.length
  const center = path.atDistance(min > max ? path.length / 2 : Math.max(min, Math.min(max, position)))
  return { text, lines, widths, textLines, size, lineHeight, font: connectionFonts[props.font] || connectionFonts.sans, center, bounds: { x: center.x - w / 2, y: center.y - h / 2, w, h } }
}
