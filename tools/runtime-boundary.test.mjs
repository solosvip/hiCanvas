import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRuntimeBoundary } from './check-runtime-boundary.mjs'

test('运行时完整打包，只依赖编辑层、模型、纯几何与 MIT 数据包', async () => {
  const inputs = await checkRuntimeBoundary()
  assert.ok(inputs.includes('engine/commands/index.js'))
  assert.ok(inputs.includes('model/index.js'))
  assert.ok(inputs.includes('renderer/geometry.js'))
  assert.ok(inputs.some(path => path.includes('@tldraw/state/')))
})

test('纯几何的间接依赖也受运行时守卫约束，渲染入口和 React 仍报红', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-geometry-boundary-'))
  try {
    await mkdir(join(root, 'engine/runtime'), { recursive: true })
    await mkdir(join(root, 'renderer'), { recursive: true })
    await writeFile(join(root, 'engine/runtime/index.js'), "export * from '../../renderer/geometry.js'")
    await writeFile(join(root, 'renderer/geometry.js'), "export * from './bounds.js'")
    await writeFile(join(root, 'renderer/bounds.js'), 'export const bounds = 1')
    assert.ok((await checkRuntimeBoundary({ root })).includes('renderer/bounds.js'))
    // 纯几何新增的小文件不用登记即可放行；编辑层跳过入口直接引用渲染层内部文件仍报红。
    await writeFile(join(root, 'renderer/bounds.js'), "export * from './geo-extra.js'")
    await writeFile(join(root, 'renderer/geo-extra.js'), 'export const extra = 1')
    assert.ok((await checkRuntimeBoundary({ root })).includes('renderer/geo-extra.js'))
    await writeFile(join(root, 'engine/runtime/index.js'), "export * from '../../renderer/bounds.js'")
    await assert.rejects(checkRuntimeBoundary({ root }), /越界引用/)
    await writeFile(join(root, 'engine/runtime/index.js'), "export * from '../../renderer/geometry.js'")
    await writeFile(join(root, 'renderer/shapes.js'), 'export const shapes = 1')
    await writeFile(join(root, 'renderer/bounds.js'), "export * from './shapes.js'")
    await assert.rejects(checkRuntimeBoundary({ root }), /越界引用/)
    await writeFile(join(root, 'renderer/index.js'), 'export const mount = 1')
    for (const source of ["export * from './index.js'", "export * from 'react'", 'export const bounds = document.body']) {
      await writeFile(join(root, 'renderer/bounds.js'), source)
      await assert.rejects(checkRuntimeBoundary({ root }), undefined, source)
    }
    await writeFile(join(root, 'engine/runtime/index.js'), "export * from '../../renderer/index.js'")
    await assert.rejects(checkRuntimeBoundary({ root }), /越界引用/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('边界守卫拦截直接和间接的宿主依赖，不读取受限包源码', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-boundary-'))
  try {
    await mkdir(join(root, 'engine/runtime'), { recursive: true })
    await writeFile(join(root, 'engine/runtime/index.js'), "export * from './probe.js'\n")
    for (const source of ["import '../../server/routes.mjs'", "import '../../renderer/index.js'", "import '../../src/App.jsx'", "import 'tldraw'", "import '@tldraw/editor'", "import '@tldraw/assets'", "import 'node:fs'", "import 'http'", "import 'react'", "import '@tldraw/state-react'", 'export const x = document.body', "export const x = globalThis['document']", "export const x = fetch('/api/canvas')", "export const x = globalThis?.['fetch']", "const { fetch: request } = globalThis; export const x = request('/api/canvas')", "const { document: doc } = globalThis; export const x = doc.body", "const { 'fetch': request } = globalThis; export const x = request('/api/canvas')", "const { 'document': doc } = globalThis; export const x = doc.body", 'export const x = new DOMRect()', 'export const x = <div />']) {
      await writeFile(join(root, 'engine/runtime/probe.js'), source)
      await assert.rejects(checkRuntimeBoundary({ root }), undefined, source)
    }
    await writeFile(join(root, 'engine/runtime/probe.js'), 'export const clean = 1')
    await checkRuntimeBoundary({ root })
  } finally { await rm(root, { recursive: true, force: true }) }
})
