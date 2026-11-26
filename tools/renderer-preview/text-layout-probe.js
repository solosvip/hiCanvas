import { measureText, layoutText } from '../../renderer/geometry.js'
import { canvasFontStyle } from '../../renderer/index.js'
import { graphemeSegments } from 'unicode-segmenter/grapheme'
import { textLayoutCorpus, textFaces, widthSamples, wrapSamples } from './text-layout-corpus.js'
import { variableReference } from './text-variable-reference.js'

const check = (condition, message) => { if (!condition) throw new Error(message) }
function nativeLines(element, text) {
  element.textContent = text + (text.endsWith('\n') ? '\u200b' : '')
  const node = element.firstChild, lines = new Map()
  if (!node) return ['']
  for (const { segment, index } of graphemeSegments(element.textContent)) {
    const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + segment.length)
    const boxes = [...range.getClientRects()]
    const rect = boxes.filter(box => box.height && box.width).at(-1) || boxes.filter(box => box.height).at(-1) || range.getBoundingClientRect()
    lines.set(rect.top, (lines.get(rect.top) || '') + segment)
  }
  return [...lines.values()].map(value => value.replace(/\n$/, '').replace(/\u200b$/, ''))
}

export function runTextLayoutProbe(expected) {
  const actual = textLayoutCorpus(measureText, layoutText)
  check(JSON.stringify(actual) === JSON.stringify(expected), '浏览器与Node的336项宽度／208项换行未逐位相同')
  const probe = document.createElement('div'), widths = [], wraps = [], calibration = [], variable = []
  Object.assign(probe.style, { position: 'absolute', left: '-20000px', top: 0, margin: 0, padding: 0, lineHeight: '1.35', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'normal', tabSize: '2', letterSpacing: 'normal', textSpacingTrim: 'space-all', textAutospace: 'no-autospace' })
  document.body.append(probe)
  try {
    for (const face of textFaces) {
      Object.assign(probe.style, canvasFontStyle(face.font, face.weight, face.style))
      probe.style.whiteSpace = 'pre'; probe.style.width = 'max-content'
      for (const sample of widthSamples) for (const size of [18, 24, 44]) {
        probe.style.fontSize = size + 'px'; probe.textContent = sample.text
        const nativeWidth = probe.getBoundingClientRect().width, predicted = measureText(sample.text, { ...face, size }).width
        widths.push({ ...face, kind: sample.kind, size, nativeWidth, predicted, error: predicted - nativeWidth })
      }
      probe.style.fontSize = '24px'
      for (const sample of ['𠀀', '𠮷', '❤', '天', 'あ', 'ｱ', '한', '😀', '。']) {
        probe.textContent = sample; calibration.push({ ...face, sample, width: probe.getBoundingClientRect().width })
      }
      if (face.font === 'sans' && face.weight === 400 && face.style === 'normal') {
        for (const size of [4, 8, 10, 11, 12, 12.25, 13, 14, 15, 15.5, 16, 16.25, 17, 17.5, 18, 18.25, 19, 19.5, 20, 20.5, 21, 21.5, 22, 22.5, 23, 23.5, 23.9, 24, 24.1, 26, 28, 32, 36, 44]) {
          probe.style.fontSize = size + 'px'
          for (const sample of ['👨‍👩‍👧‍👦', '😀']) {
            probe.textContent = sample; calibration.push({ ...face, size, sample, width: probe.getBoundingClientRect().width })
          }
        }
      }
      probe.style.width = '240px'; probe.style.whiteSpace = 'pre-wrap'; probe.contentEditable = 'true'
      const cases = [...[18, 24, 44].map(size => ({ ...widthSamples.find(s => s.kind === 'long'), size })), ...wrapSamples.map(s => ({ ...s, size: 24 }))]
      for (const sample of cases) {
        probe.style.fontSize = sample.size + 'px'
        const native = nativeLines(probe, sample.text), predicted = layoutText(sample.text, { ...face, size: sample.size, width: 240 }).lines.map(line => line.text)
        wraps.push({ ...face, kind: sample.kind, size: sample.size, native, predicted, match: JSON.stringify(native) === JSON.stringify(predicted) })
      }
      probe.removeAttribute('contenteditable')
    }
    probe.style.width = 'max-content'; probe.style.whiteSpace = 'pre'
    for (const { text, width: reference, ...face } of variableReference) {
      Object.assign(probe.style, canvasFontStyle('draw', face.weight, face.style))
      probe.style.fontSize = face.size + 'px'; probe.textContent = text
      const nativeWidth = probe.getBoundingClientRect().width, predicted = measureText(text, { ...face, font: 'draw' }).width
      variable.push({ ...face, text, nativeWidth, reference, predicted, error: predicted - nativeWidth })
    }
  } finally { probe.remove() }
  const maxWidthError = Math.max(...widths.map(row => Math.abs(row.error)))
  const max24WidthError = Math.max(...widths.filter(row => row.size === 24).map(row => Math.abs(row.error)))
  check(max24WidthError < .1 && maxWidthError < .2, `文字自然宽度超出已校准误差：24px=${max24WidthError}，全部=${maxWidthError}；${JSON.stringify(widths.filter(row => Math.abs(row.error) >= .2).slice(0, 2))}；${JSON.stringify(calibration.filter(row => row.size))}`)
  const maxVariableError = Math.max(...variable.map(row => Math.abs(row.error)))
  check(maxVariableError < .05, `C四种样式的100项实际浏览器宽度误差超过0.05px：${maxVariableError}`)
  const calibrationErrors = calibration.map(row => ({ ...row, predicted: measureText(row.sample, { ...row, size: row.size || 24 }).width }))
  const maxCalibrationError = Math.max(...calibrationErrors.map(row => Math.abs(row.predicted - row.width)))
  check(maxCalibrationError < .1, `系统后备字／emoji字号校准偏差：${JSON.stringify(calibrationErrors.filter(row => Math.abs(row.predicted - row.width) >= .1))}`)
  return { bitExact: true, widths: actual.widths.length, wraps: actual.wraps.length, uncalibrated: actual.uncalibrated, maxWidthError, max24WidthError, maxVariableError, maxCalibrationError, variable, nativeWidths: widths, nativeWraps: wraps, calibration }
}
