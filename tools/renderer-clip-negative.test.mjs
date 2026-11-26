import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { checkOpaqueBorderCut } from './renderer-preview/clip-negative-guard.mjs'

test('a negative pixel probe cannot swallow evidence IO failure when both PNGs remain readable', async () => {
  const directory = await mkdtemp(new URL('../.scratch/clip-negative-', import.meta.url))
  let clipped = false
  const contents = {
    async executeJavaScript(code) {
      if (code.includes('module.beginClipPixelProbe')) return { viewport: { width: 1, height: 1 }, semiShapes: [], opaqueBoxes: [] }
      if (code.includes('module.endClipPixelProbe')) return true
      if (code.includes('module.setClipPixelMode')) clipped = code.includes('"clipped":true')
      if (code.includes('module.readOpaqueEdgeCandidates')) return { candidates: [], rejected: [] }
      if (code.includes('return !document.querySelector')) return true
      if (code.includes('node.innerHTML')) return { x: 0, y: 0, width: 1, height: 1 }
    },
    async capturePage() {
      const bytes = Buffer.from(clipped ? [255, 255, 255, 255] : [0, 0, 0, 255])
      return { getSize: () => ({ width: 1, height: 1 }), toBitmap: () => bytes, toPNG: () => bytes }
    },
  }
  try {
    await mkdir(`${directory}/cut-pixels.json`)
    await assert.rejects(checkOpaqueBorderCut(contents, { directory, label: 'cut', failureOnly: true }, bytes => ({ toBitmap: () => bytes })), /失败证据写入失败/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
