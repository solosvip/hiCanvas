import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

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
