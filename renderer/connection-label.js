import { plainText } from './text.js'
import { connectionWidth, CONNECTION_METRICS } from './connection-metrics.js'
import { canvasFonts } from './font-families.js'

// ASCII advances measured at 20px from running legacy synthetic labels,
// 2026-11-25. Geometry uses measurements, never font files or browser objects.
const advances = Object.freeze({"draw":[6.86,5.84,9.98,19.68,14,19.22,13.4,5.46,9.48,9.16,10.06,14,5.78,10.16,6,8.16,13.74,8.44,14,14,14.64,12.42,14,13.96,14,14,6.02,6,14,14,14,10.16,17.9,15.1,12.38,12.26,13.54,13.28,11.66,16.04,14.48,11.68,12.52,13.44,10.74,20.04,15.78,13.9,11.9,15.2,14.46,11.24,12.68,13.34,13.76,19.22,12.94,12.38,12.78,10.18,8.16,9.98,12.2,14,7.08,13.34,11.94,10.04,13.52,12.16,8.9,13.2,13.34,6.14,5.8,12.62,7.3,18.38,13.08,12.18,11.94,12.44,10.3,10.42,9.78,12.28,11.9,18.78,11.22,12,12.42,10.76,6.4,10.76,14],"sans":[4.72,5.96,9.02,13.56,11.98,18.94,14.14,5.06,6.72,6.72,10.28,12,5.8,8.02,5.8,8.34,12,12,12,12,12,12,12,12,12,12,6.2,6.2,12,12,12,9.74,17.92,13.24,13.18,12.68,13.66,11.86,11.4,14.1,14.28,8.32,10.62,13.2,10.26,16.28,14.28,14.24,12.54,14.24,13.1,11.96,11.54,13.72,12.56,18.52,12.78,12.34,11.82,6.5,8.34,6.5,12,11.22,12,10.98,11.84,10.2,11.84,11.12,6.8,10.74,11.6,5.3,5.3,10.94,5.7,17.64,11.6,11.28,11.84,11.84,7.66,9.88,7.3,11.6,10.24,15.98,10.6,10.28,9.74,7.08,7.06,7.12,12],"serif":[4.64,5.84,8.88,13.42,11.86,18.38,14.52,4.98,6.72,6.72,10.12,12,5.44,7.92,5.44,7.84,12,12,12,12,12,12,12,12,12,12,5.84,5.86,12,12,12,10.02,18.28,13.84,13.7,13.12,14.56,12.98,12.64,14.88,15.98,7.26,9.62,14.7,12.12,17.64,15.68,14.72,13,14.72,13.98,12.1,13.54,15,13.54,19.86,13.88,13.1,12.88,6.18,7.84,6.18,12,11.26,12,11.06,12.18,10.48,12.38,10.94,7.2,11.2,12.7,6.46,6.22,11.94,6.2,19.16,12.96,11.44,12.44,12.2,9.28,9.94,7.22,12.62,10.98,16.34,11.48,11,10.22,6.98,6.64,6.98,12],"mono":[12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12]})

// Local author faces are ready before mounting. Widths remain the #71 estimates
// until the shared browser/Node measurement strategy is approved (#103).
export const connectionFonts = canvasFonts
export function connectionLabel(props, path) {
  const text = plainText(props.richText)
  if (!text.trim()) return null
  // Legacy four-size mono labels measured 2026-11-25: 18/20/24/28px.
  const scale = props.scale || 1, size = ({ s: 18, m: 20, l: 24, xl: 28 }[props.size] || 20) * scale
  const font = advances[props.font] || advances.sans, lines = text.split('\n')
  const widths = lines.map(line => [...line].reduce((sum, c) => {
    const n = c.codePointAt(0); return sum + (n >= 32 && n <= 126 ? font[n - 32] / 20 : n > 255 ? 1 : .6) * size
  }, 0))
  const lineHeight = size * CONNECTION_METRICS.labelLineHeight, w = Math.max(...widths), h = lines.length * lineHeight
  // End-label sweeps (none/arrow/triangle/dot, every size) leave 24.25,
  // 27.25,30.25,60.25 units beyond half the label at capped ends. None/pipe
  // permit the label center at the terminal; short paths center the label.
  const width = connectionWidth(props), reserve = Math.max(20 * scale + 2 * width, 6 * width) + .25 * scale
  const limit = head => ['none', 'pipe', undefined].includes(head) ? 0 : w / 2 + reserve
  const min = limit(props.arrowheadStart), max = path.length - limit(props.arrowheadEnd)
  const position = Math.max(0, Math.min(1, props.labelPosition ?? .5)) * path.length
  const center = path.atDistance(min > max ? path.length / 2 : Math.max(min, Math.min(max, position)))
  return { text, lines, widths, size, lineHeight, font: connectionFonts[props.font] || connectionFonts.sans, center, bounds: { x: center.x - w / 2, y: center.y - h / 2, w, h } }
}
