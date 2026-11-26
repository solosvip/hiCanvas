import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { canvasFontFaces } from '../renderer/fonts/manifest.js'
import { prepareTextLayout, measureText, layoutText, textLayout } from '../renderer/geometry.js'
import { variableReference } from './renderer-preview/text-variable-reference.js'
import { textLayoutCorpus } from './renderer-preview/text-layout-corpus.js'
import { create } from 'fontkit/core'
import { applyChromiumVariableMetrics, assertFontkitVersion } from '../renderer/text-variable-metrics.js'
import { drawFontAxes } from '../renderer/font-families.js'
import { build } from 'esbuild'

const bytes = new Map()
await prepareTextLayout(await Promise.all(canvasFontFaces.map(async face => {
  if (!bytes.has(face.url.href)) bytes.set(face.url.href, readFile(face.url))
  return { ...face, bytes: new Uint8Array(await bytes.get(face.url.href)) }
})))

test('shared layout shapes Latin runs and uses calibrated Chinese, emoji and grapheme boundaries', () => {
  assert.equal(measureText('天地かな', { font: 'sans', size: 24 }).width, 96)
  assert.equal(measureText('👨‍👩‍👧‍👦', { font: 'sans', size: 24 }).width, 24)
  assert.deepEqual(layoutText('👨‍👩‍👧‍👦中', { font: 'sans', size: 24, width: 25 }).lines.map(l => l.text), ['👨‍👩‍👧‍👦', '中'])
  assert.ok(measureText('AV', { font: 'sans', size: 24 }).width < measureText('A', { font: 'sans', size: 24 }).width + measureText('V', { font: 'sans', size: 24 }).width)
})

test('unknown fallback graphemes are explicit and rich text uses bold and italic runs', () => {
  assert.deepEqual(measureText('中𞸀中𞸀', { font: 'sans', size: 24 }).unknown, ['𞸀'])
  const richText = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'AV', marks: [{ type: 'bold' }] },
    { type: 'text', text: ' ffi', marks: [{ type: 'italic' }] },
  ] }] }
  const result = textLayout({ font: 'sans', size: 'm', w: 240, autoSize: false, richText })
  assert.equal(result.lines[0].runs[0].weight, 700)
  assert.equal(result.lines[0].runs[1].style, 'italic')
  assert.equal(result.lines[0].width, measureText('AV', { font: 'sans', size: 24, weight: 700 }).width + measureText(' ffi', { font: 'sans', size: 24, style: 'italic' }).width)
})

test('macOS colour emoji advances follow the calibrated small-size and pixel rounding rules', () => {
  for (const [size, width] of [[4, 5], [10, 13], [12.25, 15], [16, 20], [17.5, 21], [18, 21], [20, 22], [22, 23], [23.9, 24], [24, 24], [24.1, 24], [44, 44]]) {
    for (const text of ['😀', '👨‍👩‍👧‍👦', '❤️']) assert.equal(measureText(text, { font: 'sans', size }).width, width)
  }
})

test('plain geometry callers can replace layout fields without receiving stale cached bounds', () => {
  const richText = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'AB' }] }] }
  const props = { font: 'sans', size: 'm', scale: 1, w: 120, autoSize: false, richText }
  const initial = textLayout(props)
  props.scale = 2
  assert.equal(textLayout(props).w, 240)
  assert.equal(textLayout(props).h, initial.h * 2)
  props.richText = { type: 'doc', content: [...richText.content, ...richText.content] }
  assert.equal(textLayout(props).h, initial.h * 4)
})

test('all four C instances match the independently observed 100 natural DOM widths', () => {
  for (const { text, width, ...face } of variableReference) {
    const actual = measureText(text, { ...face, font: 'draw' }).width
    assert.ok(Math.abs(actual - width) < .05, `${JSON.stringify(face)} ${text}: ${actual} vs ${width}`)
  }
})

test('the original author font reproduces the uncorrected fontkit variable kerning defect', async () => {
  const sample = variableReference.find(row => row.size === 24 && row.weight === 400 && row.style === 'italic' && row.text.startsWith('ABC'))
  const source = canvasFontFaces.find(face => face.key === 'draw')
  const font = create(new Uint8Array(await readFile(source.url))).getVariation(drawFontAxes['400/italic'])
  const raw = font.layout(sample.text).positions.reduce((sum, p) => sum + p.xAdvance, 0) * sample.size / font.unitsPerEm
  assert.ok(Math.abs(raw - sample.width) > 2, 'the regression must prove a real library defect, not only test the repair')
})

test('the variable adapter leaves all twelve static IBM font advances bit-identical', async () => {
  for (const source of canvasFontFaces.filter(face => face.key !== 'draw')) {
    const font = create(new Uint8Array(await readFile(source.url)))
    const text = 'AVATAR To Wa ffi office Café é 0123456789'
    const before = font.layout(text).positions.map(p => p.xAdvance)
    assert.equal(applyChromiumVariableMetrics(font), font)
    assert.deepEqual(font.layout(text).positions.map(p => p.xAdvance), before)
  }
})

test('a different installed fontkit version fails immediately and requests reassessment', async () => {
  assert.doesNotThrow(() => assertFontkitVersion('3.0.0'))
  for (const version of ['2.0.4', '3.0.1', '3.1.0']) assert.throws(() => assertFontkitVersion(version), /重新评估/)
  const result = await build({ entryPoints: [new URL('../renderer/text-variable-metrics.js', import.meta.url).pathname], bundle: true, write: false, platform: 'browser', format: 'esm', plugins: [{ name: 'synthetic-installed-version', setup(builder) {
    builder.onLoad({ filter: /fontkit[/\\]package\.json$/ }, () => ({ contents: '{"version":"3.0.1"}', loader: 'json' }))
  } }] })
  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '--eval', result.outputFiles[0].text], { stdio: 'pipe' }), error => /fontkit 3\.0\.1.*重新评估/.test(String(error.stderr)))
})

test('second-round corpus retains 336 widths, 208 wraps, and an explicit unknown list', () => {
  const { widths, wraps, uncalibrated } = textLayoutCorpus(measureText, layoutText)
  assert.equal(widths.length, 336)
  assert.equal(wraps.length, 208)
  assert.deepEqual(widths.flatMap(row => row.unknown), [])
  assert.deepEqual(wraps.flatMap(row => row.unknown), [])
  assert.equal(uncalibrated.length, 16)
  for (const row of uncalibrated) {
    assert.deepEqual(row.measured, { width: 96, unknown: ['𞸀'] })
    assert.deepEqual(row.laidOut, ['𞸀'])
  }
  for (const row of [...widths, ...wraps.flatMap(row => row.lines)]) assert.ok(Number.isFinite(row.width))
  assert.deepEqual(layoutText('第一行\n\n第二行\n', { font: 'sans', size: 24, width: 240 }).lines.map(line => line.text), ['第一行', '', '第二行', ''])
})

test('mandatory Unicode line boundaries and CRLF preserve height and original text offsets', () => {
  for (const separator of ['\n', '\r', '\r\n', '\u2028', '\u2029', '\u0085', '\v', '\f']) {
    const layout = layoutText('A' + separator + 'B' + separator, { font: 'sans', size: 24, width: 1000 })
    assert.deepEqual(layout.lines.map(line => line.text), ['A', 'B', ''])
    assert.equal(layout.lines[1].start, 1 + separator.length)
    assert.equal(layout.h, 3 * 24 * 1.35)
  }
})

test('soft hyphens consume width only at a taken break and paint a visible hyphen in nowrap lines', () => {
  const options = { font: 'sans', size: 24 }
  const text = 'soft\u00adhyphen'
  const wide = layoutText(text, { ...options, width: 300 })
  assert.equal(wide.lines.length, 1)
  assert.equal(wide.w, measureText('softhyphen', options).width)
  const narrow = layoutText(text, { ...options, width: 60 })
  assert.equal(narrow.lines[0].text, 'soft\u00ad')
  assert.equal(narrow.lines[0].runs.map(run => run.text).join(''), 'soft\u2010')
  assert.equal(narrow.lines[0].width, measureText('soft\u2010', options).width)
  const tighter = layoutText(text, { ...options, width: 45 })
  assert.equal(tighter.lines[0].hyphenated, false)
  assert.ok(tighter.lines[0].width <= 45)
  const shortTail = 'i\u00adi'
  const unbroken = measureText(shortTail, options).width
  const taken = measureText('i\u2010', options).width
  assert.ok(taken > unbroken)
  const fitsWithoutBreak = layoutText(shortTail, { ...options, width: (unbroken + taken) / 2 })
  assert.deepEqual(fitsWithoutBreak.lines.map(line => line.text), [shortTail])
})
