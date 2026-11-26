import './test-sandbox.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import config from '../vite.config.js'
import { canvasFontFaces, canvasFontFamily } from '../renderer/fonts/manifest.js'
import { prepareCanvasFonts } from '../renderer/fonts/prepare.js'

function fontDocument(failed = -1) {
  const calls = [], added = new Set()
  class FontFace {
    constructor(family, source, descriptors) {
      Object.assign(this, { family, source, ...descriptors, index: calls.length })
      calls.push(this)
    }
    async load() {
      if (this.index === failed) throw new Error('synthetic missing font')
      return this
    }
  }
  return { doc: { defaultView: { FontFace }, fonts: { add: f => added.add(f), delete: f => added.delete(f) } }, calls, added }
}

test('sixteen original local fonts retain pinned bytes and CSS style mapping', async () => {
  assert.equal(canvasFontFaces.length, 16)
  assert.equal(new Set(canvasFontFaces.map(f => `${f.family}/${f.weight}/${f.style}`)).size, 16)
  const sources = (await readFile(new URL('../licenses/fonts-sources.txt', import.meta.url), 'utf8'))
    .split('\n').filter(line => line.includes(' | renderer/fonts/files/')).map(line => line.split(' | '))
  assert.equal(sources.length, 16)
  for (const face of canvasFontFaces) {
    const bytes = await readFile(face.url)
    assert.equal(bytes.subarray(0, 4).toString(), 'wOF2')
    assert.equal(bytes.length, face.bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), face.sha256)
    assert.equal(face.url.protocol, 'file:')
    const source = sources.find(row => face.url.pathname.endsWith(row[1]))
    assert.ok(source)
    assert.equal(source[4], face.sha256)
    assert.match(source[2], /^https:\/\/raw\.githubusercontent\.com\/(?:IBM\/plex|arrowtype\/shantell-sans)\/[a-f0-9]{40}\//)
    if (face.key !== 'draw' && face.weight === '400') assert.match(face.url.pathname, /Medium(?:Italic)?\.woff2$/)
  }
  assert.match(canvasFontFamily('draw'), /sans-serif$/)
  assert.match(canvasFontFamily('serif'), /, serif$/)
  assert.match(canvasFontFamily('mono'), /monospace$/)
  for (const [file, hash] of [
    ['IBM-Plex-OFL.txt', '7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da'],
    ['Shantell-Sans-OFL.txt', 'ebfce7d104d597c385b71e9fbf8f0e2034e73320f857086105dc265b82c05caa'],
  ]) assert.equal(createHash('sha256').update(await readFile(new URL(`../licenses/${file}`, import.meta.url))).digest('hex'), hash)
})

test('preparation awaits every face, registers once per document, and isolates documents', async () => {
  const { doc, calls, added } = fontDocument()
  const first = prepareCanvasFonts(doc), second = prepareCanvasFonts(doc)
  assert.equal(first, second)
  await first
  assert.equal(calls.length, 16)
  assert.equal(added.size, 16)
  await prepareCanvasFonts(doc)
  assert.equal(calls.length, 16)
  const other = fontDocument()
  await prepareCanvasFonts(other.doc)
  assert.equal(other.added.size, 16)
})

test('a failed face rejects preparation, leaves no partial registration, and can retry', async () => {
  const { doc, added } = fontDocument(5)
  await assert.rejects(prepareCanvasFonts(doc), /画板字体加载失败/)
  assert.equal(added.size, 0)
  await prepareCanvasFonts(doc)
  assert.equal(added.size, 16)
  assert.throws(() => prepareCanvasFonts({}), /不支持本地字体/)
})

test('a standalone Vite build emits sixteen unchanged font files without inlining', async () => {
  const output = await mkdtemp(join(tmpdir(), 'hicanvas-font-build-'))
  try {
    await build({ configFile: false, publicDir: false, logLevel: 'silent', build: {
      assetsInlineLimit: config.build.assetsInlineLimit, outDir: output,
      rollupOptions: { input: new URL('../renderer/fonts/manifest.js', import.meta.url).pathname, preserveEntrySignatures: 'strict' },
    } })
    const emitted = await readdir(join(output, 'assets'))
    const hashes = []
    for (const file of emitted.filter(file => file.endsWith('.woff2'))) {
      hashes.push(createHash('sha256').update(await readFile(join(output, 'assets', file))).digest('hex'))
    }
    assert.deepEqual(hashes.sort(), canvasFontFaces.map(face => face.sha256).sort())
    const scripts = emitted.filter(file => file.endsWith('.js'))
    assert.equal(scripts.length, 1)
    const script = await readFile(join(output, 'assets', scripts[0]), 'utf8')
    assert.doesNotMatch(script, /data:font|base64|file:\/\//)
    for (const file of emitted.filter(file => file.endsWith('.woff2'))) assert.ok(script.includes(file))
  } finally { await rm(output, { recursive: true, force: true }) }
})
