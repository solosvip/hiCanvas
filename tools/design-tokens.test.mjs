import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, copyFile, symlink, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'

test('官方同次导出生成CSS与宿主数值令牌；任一产物漂移都会被check拒绝', async () => {
  const root = await mkdtemp(resolve('.scratch/design-tokens-'))
  try {
    await mkdir(join(root, 'tools')); await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir')
    await copyFile(new URL('./generate-tokens.mjs', import.meta.url), join(root, 'tools/generate-tokens.mjs'))
    const design = await readFile(new URL('../DESIGN.md', import.meta.url), 'utf8')
    await writeFile(join(root, 'DESIGN.md'), design.replace('overlay-handle-hit: 12px', 'overlay-handle-hit: 18px'))
    const run = (...args) => execFileSync(process.execPath, [join(root, 'tools/generate-tokens.mjs'), ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
    run(); run('--check')
    const cssPath = join(root, 'src/styles/tokens.css'), jsPath = join(root, 'src/styles/tokens.js')
    const css = await readFile(cssPath, 'utf8'), js = await readFile(jsPath, 'utf8')
    const values = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', "import('./src/styles/tokens.js').then(values => process.stdout.write(JSON.stringify(values)))"], { cwd: root, encoding: 'utf8' }))
    const mapping = { handleCornerHitSize: 'overlay-handle-hit', handleEdgeHitSize: 'overlay-edge-hit', handleRotationOffset: 'overlay-rotate-offset', handleRotationRadius: 'overlay-rotate-radius' }
    for (const [name, token] of Object.entries(mapping)) assert.equal(values[name], Number(css.match(new RegExp(`--spacing-${token}:\\s*([0-9.]+)px;`))[1]))
    assert.equal(values.handleCornerHitSize, 18, '改DESIGN必须同时改变数值产物')
    await writeFile(jsPath, js + '// drift\n'); assert.throws(() => run('--check'), /tokens.js/)
    await writeFile(jsPath, js); await writeFile(cssPath, css + '/* drift */\n'); assert.throws(() => run('--check'), /tokens.css/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
