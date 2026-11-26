import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
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

test('渲染经模型公开入口读取内部数据，模型不能反向导入渲染且渲染不能直达模型内部', async () => {
  const base = await mkdtemp(join(tmpdir(), 'renderer-model-boundary-'))
  const actual = join(base, 'actual'), root = join(base, 'linked-project')
  await mkdir(actual)
  await symlink(actual, root, process.platform === 'win32' ? 'junction' : 'dir')
  try {
    await mkdir(join(root, 'renderer')); await mkdir(join(root, 'model'))
    await writeFile(join(root, 'renderer/index.js'), "export * from '../model/index.js'\n")
    await writeFile(join(root, 'model/index.js'), "export * from './services.js'\n")
    await writeFile(join(root, 'model/services.js'), 'export const constraint = 200\n')
    const inputs = await checkRendererBoundary({ root })
    assert.ok(inputs.includes('model/services.js'))
    await writeFile(join(root, 'renderer/index.js'), "export * from '../model/services.js'\n")
    await assert.rejects(checkRendererBoundary({ root }), /越界/)
    await writeFile(join(root, 'renderer/index.js'), "export * from '../model/index.js'\n")
    await writeFile(join(root, 'renderer/drawing.js'), 'export const drawing = 1\n')
    await writeFile(join(root, 'model/services.js'), "export * from '../renderer/drawing.js'\n")
    await assert.rejects(checkRendererBoundary({ root }), /越界/)
    for (const specifier of ['react', 'unlisted-package']) {
      await writeFile(join(root, 'model/services.js'), `export * from '${specifier}'\n`)
      await assert.rejects(checkRendererBoundary({ root }), /未允许的依赖/)
    }
  } finally { await rm(base, { recursive: true, force: true }) }
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
