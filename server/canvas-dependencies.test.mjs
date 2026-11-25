import '../tools/test-sandbox.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { allowedEngineInput } from '../tools/check-runtime-boundary.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))

function assertEngineBoundary(inputs) {
  assert.deepEqual(inputs.filter(path => !allowedEngineInput(path)), [])
  assert.deepEqual(inputs.filter(path => /(?:^|\/)node_modules\/(?:tldraw|@tldraw\/(?!store\/|tlschema\/|utils\/|state\/|validate\/)[^/]+|react|react-dom)\//.test(path) || /^renderer\/(?:index|mount|shapes)\.js$/.test(path)), [])
}

test('编辑层可独立在浏览器打包，只依赖模型、纯几何与 MIT 数据层，无 Node 或界面依赖', async () => {
  // browser 目标且不声明 external：引入 Node 内置模块会直接打包失败。
  const result = await build({ absWorkingDir: root, entryPoints: ['engine/index.js'], bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', logLevel: 'silent' })
  const inputs = Object.keys(result.metafile.inputs)
  assert.ok(inputs.includes('model/index.js'))
  assert.ok(inputs.includes('renderer/geometry.js'))
  assert.ok(inputs.includes('engine/interaction/index.js'))
  assertEngineBoundary(inputs)
  assert.deepEqual(Object.values(result.metafile.outputs).flatMap(output => output.imports).filter(item => item.external), [])
})

test('编辑层边界放行纯几何，但引入挂载入口、渲染组件或 React 会报红', async () => {
  for (const entry of ['renderer/geometry.js', 'renderer/index.js', 'renderer/mount.js', 'renderer/shapes.js', 'react']) {
    const result = await build({ absWorkingDir: root, stdin: { contents: `export * from ${JSON.stringify(entry === 'react' ? entry : './' + entry)}`, resolveDir: root }, bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', logLevel: 'silent' })
    const check = () => assertEngineBoundary(Object.keys(result.metafile.inputs).filter(path => path !== '<stdin>'))
    if (entry === 'renderer/geometry.js') assert.doesNotThrow(check)
    else assert.throws(check, assert.AssertionError, entry)
  }
})

test('共享数据模型可独立打包，不依赖界面、渲染或服务端', async () => {
  const result = await build({ absWorkingDir: root, entryPoints: ['model/index.js'], bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', logLevel: 'silent' })
  const inputs = Object.keys(result.metafile.inputs)
  assert.ok(inputs.some(path => path.includes('node_modules/@tldraw/tlschema/')))
  assert.deepEqual(inputs.filter(path => /^(?:src|server)\//.test(path) || /(?:^|\/)node_modules\/(?:tldraw|@tldraw\/(?:editor|assets|driver)|react|react-dom)\//.test(path)), [])
})

test('服务端、MCP 与桌面实际打包的依赖图不含受限包或界面模块', async () => {
  for (const entry of ['bin/hicanvas-service.mjs', 'bin/hicanvas-mcp.mjs', 'desktop/main.mjs']) {
    const result = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', target: 'node24', external: ['electron'], logLevel: 'silent' })
    const inputs = Object.keys(result.metafile.inputs)
    if (entry === 'bin/hicanvas-service.mjs') assert.ok(inputs.some(path => path.includes('node_modules/@tldraw/tlschema/')), entry)
    assert.deepEqual(inputs.filter(path => /(?:^|\/)node_modules\/(?:tldraw|@tldraw\/(?:editor|assets|driver))\//.test(path) || path.startsWith('src/')), [], entry)
  }
})

test('使用的数据包为直接精确依赖，与锁定编辑器版本一致且许可原文为 MIT', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
  const version = lock.packages['node_modules/tldraw'].version
  for (const name of ['store', 'tlschema', 'utils']) {
    const key = `@tldraw/${name}`
    assert.equal(pkg.devDependencies[key], version)
    assert.equal(lock.packages[''].devDependencies[key], version)
    assert.equal(lock.packages[`node_modules/${key}`].version, version)
    assert.match(await readFile(new URL(`../node_modules/${key}/LICENSE.md`, import.meta.url), 'utf8'), /^MIT License/)
  }
})
