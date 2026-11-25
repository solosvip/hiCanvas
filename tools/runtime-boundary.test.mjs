import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRuntimeBoundary } from './check-runtime-boundary.mjs'

test('运行时完整打包，只依赖编辑层、模型与 MIT 数据包', async () => {
  const inputs = await checkRuntimeBoundary()
  assert.ok(inputs.includes('engine/commands/index.js'))
  assert.ok(inputs.includes('model/index.js'))
  assert.ok(inputs.some(path => path.includes('@tldraw/state/')))
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
