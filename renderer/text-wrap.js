import { LineBreaker } from 'linebreak'
import { textSegments } from './text-measure.js'

function paragraphs(text) {
  const breaker = new LineBreaker(text), result = []
  let next, start = 0
  while ((next = breaker.nextBreak())) {
    const marker = text.slice(start, next.position).match(/(?:\r\n|[\n\r\u000b\u000c\u0085\u2028\u2029])$/u)
    // The library reports required=false for a final newline. Preserve that
    // final empty line as well as its required interior line boundaries.
    if (next.required || marker) {
      result.push({ text: text.slice(start, next.position - (marker?.[0].length || 0)), offset: start })
      start = next.position
    }
  }
  result.push({ text: text.slice(start), offset: start })
  return result
}

// UAX #14 (linebreak 2.0.0) opportunities are UTF-16 offsets. Filter through
// Unicode 17 grapheme boundaries so an emergency break cannot split an emoji.
export function wrapText(text, maxWidth, measure) {
  const lines = []
  for (const { text: paragraph, offset } of paragraphs(text)) {
    if (!paragraph) { lines.push({ text: '', start: offset, end: offset, width: 0 }); continue }
    const graphemes = textSegments(paragraph), ends = graphemes.map(g => g.end), boundaries = new Set(ends)
    const breaker = new LineBreaker(paragraph), allowed = []
    let next
    while ((next = breaker.nextBreak())) if (boundaries.has(next.position)) allowed.push(next.position)
    if (allowed.at(-1) !== paragraph.length) allowed.push(paragraph.length)
    let start = 0
    const fit = (candidates, hanging) => {
      let end = 0
      for (const stop of candidates) {
        if (stop <= start) continue
        const value = paragraph.slice(start, stop), visible = hanging ? value.replace(/[ \t]+$/, '') : value
        const hyphenated = stop < paragraph.length && paragraph[stop - 1] === '\u00ad'
        if (measure(start + offset, start + offset + visible.length, hyphenated).width <= maxWidth) end = stop
        // A taken soft hyphen can be wider than the following unbroken tail.
        // Keep searching after that candidate rather than rejecting a whole
        // word which fits without the discretionary hyphen.
        else if (!hyphenated) break
      }
      return end
    }
    while (start < paragraph.length) {
      const end = fit(allowed, true) || fit(ends, false) || ends.find(stop => stop > start)
      const value = paragraph.slice(start, end)
      const hyphenated = end < paragraph.length && value.endsWith('\u00ad')
      const result = measure(start + offset, end + offset, hyphenated)
      lines.push({ text: value, start: start + offset, end: end + offset, width: result.width, hyphenated })
      start = end
    }
  }
  return lines
}
