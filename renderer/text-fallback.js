// DOM calibration, macOS / Chromium 148.0.7778.271, 2026-11-25.
// Advances are 1/64 px at 24 px (1536 = one em). space-all removes the
// context-dependent punctuation pair compression; its pair table is empty.
import { isExtendedPictographic } from 'unicode-segmenter/emoji'

export const FALLBACK_UNITS = 1536
const punctuation = new Set([...'，。！？；：「」『』（）［］｛｝《》〈〉【】、・～'])

export function isColourEmoji(cluster) {
  const cp = cluster.codePointAt(0), emoji = isExtendedPictographic(cp) || cp >= 0x1f1e6 && cp <= 0x1f1ff
  return emoji && (/\ufe0f|\u200d/u.test(cluster) || cp >= 0x1f000)
}

export function fallbackAdvance(cluster, font, style, unknown, size = 24) {
  const cp = cluster.codePointAt(0)
  if (cluster === '𠀀') return font === 'sans' ? 725 : font === 'mono' ? 922 : font === 'serif' ? style === 'italic' ? 652 : 713 : 1076
  if (cluster === '𠮷') return 1536
  if (cluster === '❤') return font === 'mono' && style !== 'italic' ? 925 : 1398
  // Native Apple colour emoji uses larger advances below 24px and rounds to
  // whole pixels. Calibrated at 34 integer/fractional sizes in Chromium 148.
  if (isColourEmoji(cluster)) return Math.round(size <= 16 ? size * 1.25 : size < 24 ? size / 2 + 12 : size) * FALLBACK_UNITS / size
  if (punctuation.has(cluster)) return 1536
  if (cp >= 0xac00 && cp <= 0xd7a3 || cp >= 0x1100 && cp <= 0x11ff) return font === 'serif' ? 1535 : 1329
  if (cp >= 0xff61 && cp <= 0xff9f) return 768
  if (cp >= 0x3040 && cp <= 0x30ff || cp >= 0x2e80 && cp <= 0x9fff || cp >= 0xff01 && cp <= 0xff60) return 1536
  // Unmeasured scripts and supplementary Han are not silently called calibrated.
  // Use one em per grapheme, and return that grapheme to the caller for review.
  unknown.add(cluster)
  return 1536
}
