import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRendererBoundary } from './check-renderer-boundary.mjs'

test('真实渲染入口可浏览器打包，几何入口独立且没有 React/DOM', async () => {
  const inputs = await checkRendererBoundary()
  assert.ok(inputs.some(path => path.includes('@tldraw/state-react/')))
  assert.ok(inputs.some(path => path.includes('react-dom/')))
  const pure = await checkRendererBoundary({ geometry: true })
  assert.ok(pure.some(path => path.includes('node_modules/fontkit/')))
  assert.ok(pure.some(path => path.includes('node_modules/linebreak/')))
  assert.ok(pure.some(path => path.includes('node_modules/unicode-segmenter/')))
  assert.deepEqual(pure.filter(path => /node_modules\/(?:react|react-dom)\//.test(path)), [])
})

test('临时插入直接与间接违规引用都报红，删除探针后恢复；拦截发生在读取受限包之前', async () => {
  const root = await mkdtemp(join(tmpdir(), 'renderer-boundary-'))
  try {
    await mkdir(join(root, 'renderer'))
    await writeFile(join(root, 'renderer/index.js'), "export * from './probe.js'\n")
    for (const source of ["import '../engine/index.js'", "export * from '../server/index.js'", "import '../src/App.jsx'", "import 'tldraw'", "import '@tldraw/editor'", "import '@tldraw/assets'", "import 'node:fs'", "import 'fs'"]) {
      await writeFile(join(root, 'renderer/probe.js'), source)
      await assert.rejects(checkRendererBoundary({ root }), undefined, source)
    }
    await writeFile(join(root, 'renderer/geometry.js'), "export * from './probe.js'\n")
    for (const source of ["import 'react'", "import 'react-dom/client'", 'export const x = document.body', "export const x = globalThis['document']", 'export const x = new DOMRect()', "export const x = new globalThis['DOMPoint']()", 'export const x = new CanvasRenderingContext2D()']) {
      await writeFile(join(root, 'renderer/probe.js'), source)
      await assert.rejects(checkRendererBoundary({ root, geometry: true }), /几何/, source)
    }
    await writeFile(join(root, 'renderer/geometry.js'), "export * from './dom.jsx'\n")
    await writeFile(join(root, 'renderer/dom.jsx'), 'export const x = <div>{document.title}</div>')
    await assert.rejects(checkRendererBoundary({ root, geometry: true }), /几何/)
    await writeFile(join(root, 'renderer/geometry.js'), "export * from './probe.js'\n")
    await writeFile(join(root, 'renderer/probe.js'), 'export const clean = 1')
    await checkRendererBoundary({ root })
    await checkRendererBoundary({ root, geometry: true })
  } finally { await rm(root, { recursive: true, force: true }) }
})
