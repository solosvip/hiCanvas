// Keep plain content and the two supported metric-affecting marks. Other
// formats are reported explicitly; record content is never rewritten.
export function richTextRuns(node) {
  const runs = [], unsupported = new Set()
  let text = ''
  const append = (value, weight = 400, style = 'normal') => {
    if (!value) return
    const previous = runs.at(-1)
    if (previous?.weight === weight && previous?.style === style) { previous.text += value; previous.end += value.length }
    else runs.push({ text: value, start: text.length, end: text.length + value.length, weight, style })
    text += value
  }
  const visit = item => {
    if (!item) return
    if (item.type === 'text') {
      const marks = item.marks || []
      for (const mark of marks) if (!['bold', 'italic'].includes(mark.type)) unsupported.add(mark.type)
      if ([...(item.text || '')].some(c => { const cp = c.codePointAt(0); return cp >= 0x590 && cp <= 0x8ff || cp >= 0xfb1d && cp <= 0xfdff || cp >= 0xfe70 && cp <= 0xfefc })) unsupported.add('rtl')
      append(item.text || '', marks.some(m => m.type === 'bold') ? 700 : 400, marks.some(m => m.type === 'italic') ? 'italic' : 'normal')
    } else if (item.type === 'hardBreak') append('\n')
    else {
      if (!['doc', 'paragraph'].includes(item.type)) unsupported.add(item.type)
      if (item.attrs?.textAlign && item.attrs.textAlign !== 'start') unsupported.add('paragraphAlignment')
      for (let i = 0; i < (item.content || []).length; i++) {
        if (i && ['doc', 'bulletList', 'orderedList', 'listItem'].includes(item.type)) append('\n')
        visit(item.content[i])
      }
    }
  }
  visit(node)
  return { text, runs, unsupported: [...unsupported] }
}

export function sliceTextRuns(runs, start, end) {
  return runs.filter(run => run.start < end && run.end > start).map(run => {
    const from = Math.max(start, run.start), to = Math.min(end, run.end)
    return { ...run, start: from, end: to, text: run.text.slice(from - run.start, to - run.start) }
  })
}

export function lineTextRuns(runs, start, end, hyphenated = false) {
  const result = sliceTextRuns(runs, start, end)
  if (hyphenated && result.length) result.at(-1).text = result.at(-1).text.replace(/\u00ad$/, '\u2010')
  return result
}
