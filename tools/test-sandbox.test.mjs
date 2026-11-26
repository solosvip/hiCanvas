import './test-sandbox.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { canvasDir } from '../server/storage.mjs'
import { imageSettingsDirectory } from '../server/image-settings-path.mjs'
import { desktopConfigDir } from '../mcp/connection.mjs'

function inside(root, path) {
  const child = relative(root, path)
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

test('静态导入的默认画板、图片设置、桌面配置与主目录均在测试沙箱内', () => {
  const sandbox = dirname(homedir())
  assert.match(sandbox, /[/\\]hicanvas-test-[^/\\]+$/, '必须先建立独有测试目录，不能使用真实主目录')
  assert.equal(inside(tmpdir(), sandbox), true)
  for (const path of [homedir(), canvasDir, imageSettingsDirectory(), desktopConfigDir()]) {
    assert.equal(inside(sandbox, path), true, '业务模块计算出的默认目录必须在本次测试沙箱内')
  }
  for (const [name, path] of Object.entries(process.env)) {
    if (/^(?:HICANVAS|COWART)_.+_DIR$/.test(name)) assert.equal(inside(sandbox, path), true, `${name} 不能指向沙箱外`)
  }
})

test('预加载覆盖继承的目录配置，重复导入保持同一沙箱，独立进程退出后自动清理', () => {
  const preload = new URL('./test-sandbox.mjs', import.meta.url).href
  const connection = new URL('../mcp/connection.mjs', import.meta.url).href
  const probe = `
    import assert from 'node:assert/strict'
    import { homedir } from 'node:os'
    import { dirname } from 'node:path'
    const home = homedir()
    await import(${JSON.stringify(preload + '?duplicate')})
    assert.equal(homedir(), home)
    const { loadConnection } = await import(${JSON.stringify(connection)})
    console.log(JSON.stringify({ root: dirname(home), home, hasUrl: Object.hasOwn(process.env, 'HICANVAS_URL'), hasPort: Object.hasOwn(process.env, 'HICANVAS_PORT'), baseUrl: loadConnection().baseUrl, directories: Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:HICANVAS|COWART)_.+_DIR$/.test(name))) }))
  `
  const roots = []
  for (let i = 0; i < 2; i++) {
    const result = spawnSync(process.execPath, ['--import', preload, '--input-type=module', '-e', probe], {
      encoding: 'utf8', env: { ...process.env, HICANVAS_PROJECT_DIR: join(homedir(), 'inherited-project'), COWART_CANVAS_DIR: join(homedir(), 'inherited-canvas'), HICANVAS_FUTURE_DIR: join(homedir(), 'inherited-extra'), HICANVAS_URL: 'http://127.0.0.1:54321', HICANVAS_PORT: '54322' },
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
    const state = JSON.parse(result.stdout)
    roots.push(state.root)
    assert.equal(state.hasUrl, false, '不能继承外部会话的服务地址')
    assert.equal(state.hasPort, false, '不能继承外部会话的服务端口')
    assert.notEqual(state.baseUrl, 'http://127.0.0.1:54321', '默认连接不能指向继承的服务地址')
    assert.notEqual(state.baseUrl, 'http://127.0.0.1:54322', '默认连接不能指向继承的端口')
    assert.notEqual(state.root, dirname(homedir()), '不同进程使用独立沙箱，不能清理父进程的目录')
    for (const path of [state.home, ...Object.values(state.directories)]) assert.equal(inside(state.root, path), true)
    assert.equal(existsSync(state.root), false, '退出时必须删除刚建立的临时目录')
  }
  assert.notEqual(roots[0], roots[1], '并行或重复测试不能共用固定目录')
})

test('没有额外启动参数的派生进程也继承隔离后的主目录与业务路径', () => {
  const script = `
    import { canvasDir } from ${JSON.stringify(new URL('../server/storage.mjs', import.meta.url).href)}
    import { imageSettingsDirectory } from ${JSON.stringify(new URL('../server/image-settings-path.mjs', import.meta.url).href)}
    import { desktopConfigDir } from ${JSON.stringify(new URL('../mcp/connection.mjs', import.meta.url).href)}
    console.log(JSON.stringify([canvasDir, imageSettingsDirectory(), desktopConfigDir()]))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: process.env })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  for (const path of JSON.parse(result.stdout)) assert.equal(inside(dirname(homedir()), path), true)
})

test('npm 使用的强制测试退出方式也会清理沙箱', t => {
  const probe = mkdtempSync(join(homedir(), 'exit-probe-'))
  t.after(() => rmSync(probe, { recursive: true, force: true }))
  const entry = join(probe, 'exit.test.mjs'), record = join(probe, 'sandbox.json')
  const preload = new URL('./test-sandbox.mjs', import.meta.url).href
  writeFileSync(entry, `
    import ${JSON.stringify(preload)}
    import test from 'node:test'
    import { writeFileSync } from 'node:fs'
    import { homedir } from 'node:os'
    import { dirname } from 'node:path'
    test('record', () => { writeFileSync(${JSON.stringify(record)}, JSON.stringify(dirname(homedir()))); setInterval(() => {}, 1000) })
  `)
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT // 建独立测试运行器，不能沿用当前 worker 的递归测试标记。
  const result = spawnSync(process.execPath, ['--import', preload, '--test', '--test-force-exit', entry], { encoding: 'utf8', env, timeout: 5000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const root = JSON.parse(readFileSync(record, 'utf8'))
  assert.equal(existsSync(root), false, '测试结束后不能遗留被强制退出进程的临时资料')
})

test('导入沙箱时建好仓库 .scratch，干净检出里的测试可以直接在其中建临时目录', () => {
  const checkout = mkdtempSync(join(tmpdir(), 'hicanvas-clean-checkout-'))
  try {
    mkdirSync(join(checkout, 'tools'))
    writeFileSync(join(checkout, 'tools', 'test-sandbox.mjs'), readFileSync(new URL('./test-sandbox.mjs', import.meta.url)))
    assert.equal(existsSync(join(checkout, '.scratch')), false)
    const probe = `await import(${JSON.stringify(new URL('file://' + join(checkout, 'tools', 'test-sandbox.mjs')).href)}); const { mkdtempSync } = await import('node:fs'); mkdtempSync(${JSON.stringify(join(checkout, '.scratch', 'probe-'))})`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(join(checkout, '.scratch')), true)
  } finally {
    rmSync(checkout, { recursive: true, force: true })
  }
})
