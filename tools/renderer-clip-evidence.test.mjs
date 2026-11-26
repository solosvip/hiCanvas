import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { checkClipPixels } from './renderer-preview/clip-pixel-guard.mjs'

function contents(width) {
  let clipped = false
  return {
    async executeJavaScript(code) {
      if (code.includes('module.beginClipPixelProbe')) return { viewport: { width: 1, height: 1 }, semiShapes: [], opaqueBoxes: [] }
      if (code.includes('module.endClipPixelProbe')) return true
      if (code.includes('module.setClipPixelMode')) clipped = code.includes('"clipped":true')
      if (code.includes('module.readOpaqueEdgeCandidates')) return { candidates: [], rejected: [] }
    },
    async capturePage() {
      const bytes = Buffer.alloc(width * 4, clipped ? 81 : 80)
      return { getSize: () => ({ width, height: width }), toBitmap: () => bytes, toPNG: () => Buffer.from('captured-frame') }
    },
  }
}

for (const failureOnly of [true, false]) test(`an empty capture preserves frames and validation failure (failureOnly=${failureOnly})`, async () => {
  const directory = await mkdtemp(new URL('../.scratch/clip-evidence-', import.meta.url))
  try {
    await assert.rejects(checkClipPixels(contents(0), { directory, label: 'empty', failureOnly }), /没有非空截图/)
    assert.equal(await readFile(`${directory}/empty-before.png`, 'utf8'), 'captured-frame')
    const report = JSON.parse(await readFile(`${directory}/empty-failure.json`, 'utf8'))
    assert.equal(report.images.before.width, 0)
    assert.match(report.error, /没有非空截图/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('failed evidence writes cannot hide the original clip failure or its pixel counts', async () => {
  const directory = await mkdtemp(new URL('../.scratch/clip-evidence-', import.meta.url))
  try {
    const blocked = `${directory}/file`
    await writeFile(blocked, 'not a directory')
    await assert.rejects(checkClipPixels(contents(1), { directory: blocked, label: 'changed', failureOnly: true }), error => {
      assert.match(error.message, /并集以外/)
      assert.match(error.message, /changedPixels.*1/)
      assert.match(error.message, /ENOTDIR/)
      assert.ok(error.cause instanceof AggregateError)
      return true
    })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

for (const failureOnly of [true, false]) test(`an unsettled capture preserves the final two frames and mode (failureOnly=${failureOnly})`, async () => {
  const directory = await mkdtemp(new URL('../.scratch/clip-evidence-', import.meta.url))
  const source = contents(1)
  let sequence = 0
  source.capturePage = async () => {
    const frame = ++sequence
    return { getSize: () => ({ width: 1, height: 1 }), toBitmap: () => Buffer.alloc(4, frame), toPNG: () => Buffer.from(`frame-${frame}`) }
  }
  try {
    await assert.rejects(checkClipPixels(source, { directory, label: 'moving', failureOnly }), /未停稳/)
    assert.equal(await readFile(`${directory}/moving-before-unstable-previous.png`, 'utf8'), 'frame-6')
    assert.equal(await readFile(`${directory}/moving-before-unstable-current.png`, 'utf8'), 'frame-7')
    const report = JSON.parse(await readFile(`${directory}/moving-failure.json`, 'utf8'))
    assert.match(report.error, /before.*6/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
