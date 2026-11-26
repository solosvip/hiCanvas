import { create, registerFormat, registerShaper } from 'fontkit/core'
import { WOFF2Font } from 'fontkit/formats/WOFF2Font'
import { DefaultShaper } from 'fontkit/shapers/DefaultShaper'
import { graphemeSegments } from 'unicode-segmenter/grapheme'
import { FALLBACK_UNITS, fallbackAdvance, isColourEmoji } from './text-fallback.js'
import { drawFontAxes } from './font-families.js'
import { applyChromiumVariableMetrics } from './text-variable-metrics.js'

registerFormat(WOFF2Font)
registerShaper(DefaultShaper)
let sources = new Map(), faces = new Map(), measured = new Map(), baseFonts = new Map()
const stats = { parsedFaces: 0, shapedRuns: 0, measurements: 0 }
const faceKey = ({ font = 'sans', weight = 400, style = 'normal' }) => `${font}/${weight === 700 ? 700 : 400}/${style === 'italic' ? 'italic' : 'normal'}`

// The host reads/fetches bytes. This module does no I/O and has no platform
// objects; Node and the browser use exactly the same shaping and fallback math.
export function prepareTextLayout(inputs) {
  const next = new Map()
  for (const { key, weight, style, bytes } of inputs) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 4 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'wOF2') throw new Error('文字排版需要完整的本地 WOFF2 字体。')
    next.set(faceKey({ font: key, weight: Number(weight), style }), bytes)
  }
  if (next.size !== 16) throw new Error('文字排版需要四套字体的粗细与斜体，共16种样式。')
  sources = next; faces = new Map(); measured = new Map(); baseFonts = new Map()
}

function face(options) {
  const key = faceKey(options)
  if (!faces.has(key)) {
    const bytes = sources.get(key)
    if (!bytes) throw new Error('请先由宿主准备文字排版字体（prepareTextLayout）。')
    if (!baseFonts.has(bytes)) baseFonts.set(bytes, create(bytes))
    let font = baseFonts.get(bytes)
    if (key.startsWith('draw/')) {
      font = font.getVariation(drawFontAxes[key.slice(5)])
      applyChromiumVariableMetrics(font)
    }
    faces.set(key, { font, units: font.unitsPerEm, covered: new Set(font.characterSet), widths: new Map() })
    stats.parsedFaces++
  }
  return faces.get(key)
}

export function textSegments(text) {
  return [...graphemeSegments(text)].map(({ segment, index }) => ({ text: segment, start: index, end: index + segment.length }))
}

function shapedWidth(face, text) {
  if (!face.widths.has(text)) {
    const width = face.font.layout(text).positions.reduce((sum, p) => sum + p.xAdvance, 0)
    if (face.widths.size >= 8192) face.widths.delete(face.widths.keys().next().value)
    face.widths.set(text, width); stats.shapedRuns++
  }
  return face.widths.get(text)
}

export function measureText(text, options = {}) {
  const { size = 24, font = 'sans', style = 'normal', offset = 0 } = options
  if (!Number.isFinite(size) || size <= 0) throw new Error('字号需要有限正数。')
  const initial = text.includes('\t') ? offset : 0
  const key = JSON.stringify([faceKey(options), size, text, initial])
  if (measured.has(key)) return measured.get(key)
  stats.measurements++
  const f = face(options), unknown = new Set()
  let primary = initial * f.units / size, fallback = 0, run = ''
  const flush = () => { if (run) primary += shapedWidth(f, run); run = '' }
  for (const { text: cluster } of textSegments(text)) {
    if (cluster === '\t') {
      flush()
      const space = shapedWidth(f, ' '), stop = space * 2
      const current = primary * FALLBACK_UNITS + fallback * f.units
      let target = (Math.floor(current / (stop * FALLBACK_UNITS)) + 1) * stop * FALLBACK_UNITS
      // Chromium 148 advances an extra tab stop if less than half a SPACE
      // remains. It uses space advance here, not the CSS draft's half ch.
      if (target - current < space / 2 * FALLBACK_UNITS) target += stop * FALLBACK_UNITS
      primary = target / FALLBACK_UNITS; fallback = 0
      continue
    }
    if (/^[\r\n\u00ad\u200b\u200c\u200d\u2060\ufeff]+$/u.test(cluster)) continue
    const visible = cluster.replace(/[\uFE00-\uFE0F]/gu, '')
    if (!isColourEmoji(cluster) && [...visible.normalize('NFC')].every(c => f.covered.has(c.codePointAt(0)))) run += visible
    else { flush(); fallback += fallbackAdvance(cluster, font, style, unknown, size) }
  }
  flush()
  const result = Object.freeze({ width: (primary * FALLBACK_UNITS + fallback * f.units) * size / (f.units * FALLBACK_UNITS) - initial, unknown: Object.freeze([...unknown]) })
  if (measured.size >= 8192) measured.delete(measured.keys().next().value)
  measured.set(key, result)
  return result
}

export function getTextLayoutStats() { return { ...stats } }
