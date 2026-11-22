import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const checker = join(dirname(fileURLToPath(import.meta.url)), 'check.mjs')

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'hicanvas-check-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim()
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const check = (...args) => {
    const result = spawnSync(process.execPath, ['tools/check.mjs', ...args], { cwd: root, encoding: 'utf8' })
    assert.ifError(result.error)
    return { status: result.status, output: result.stdout + result.stderr }
  }
  try {
    git('init', '-b', 'main')
    git('config', 'core.hooksPath', '.disabled-hooks')
    write('AGENTS.md', '# Fixture rules\n')
    mkdirSync(join(root, 'tools'))
    copyFileSync(checker, join(root, 'tools/check.mjs'))
    run({ root, git, write, check })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('允许合规的初始仓库及无密钥配置模板', () => fixture(({ write, check }) => {
  write('.env.example', 'IMAGE_API_KEY=\n')
  assert.equal(check().status, 0)
}))

for (const [name, path, content, reason] of [
  ['未登记文档', 'notes.md', '# Notes\n', '文档位置尚未登记'],
  ['超长源码', 'src/large.js', '// line\n'.repeat(901), '超过源码 900 行上限'],
  ['密钥配置', '.env.local', 'KEY=fake\n', '密钥配置'],
  ['用户数据', 'data/canvas.json', '{}', '本地数据'],
  ['冲突的规则入口', 'CLAUDE.md', '# Rules\n', '统一放在 AGENTS.md'],
  ['超出读取上限的规则', 'AGENTS.md', 'a'.repeat(32769), '超过 32KB'],
  ['缺少设计规范的正式界面', 'src/App.tsx', 'export const App = () => null\n', '缺少经确认的 DESIGN.md'],
]) {
  test(`拦住${name}`, () => fixture(({ write, check }) => {
    write(path, content)
    const result = check()
    assert.equal(result.status, 1, result.output)
    assert.ok(result.output.includes(reason), result.output)
  }))
}

test('提交前检查读取暂存区，忽略尚未暂存的修改', () => fixture(({ git, write, check }) => {
  write('src/file.js', '// valid\n')
  git('add', '.')
  write('src/file.js', '// invalid\n'.repeat(901))
  assert.equal(check('--staged').status, 0)
  assert.equal(check().status, 1)
}))

test('工作区修正不能掩盖暂存区中的违规内容', () => fixture(({ git, write, check }) => {
  write('src/file.js', '// invalid\n'.repeat(901))
  git('add', '.')
  write('src/file.js', '// valid\n')
  assert.equal(check('--staged').status, 1)
  assert.equal(check().status, 0)
}))

test('已有超过 500 行的源码只能缩短', () => fixture(({ git, write, check }) => {
  write('src/file.js', '// baseline\n'.repeat(501))
  git('add', '.')
  git('-c', 'user.name=hiCanvas Test', '-c', 'user.email=test@example.invalid', 'commit', '--no-gpg-sign', '--no-verify', '-m', 'fixture')
  write('src/file.js', '// grown\n'.repeat(502))
  const grown = check()
  assert.equal(grown.status, 1, grown.output)
  assert.ok(grown.output.includes('原文件已超过 500 行'), grown.output)
  write('src/file.js', '// reduced\n'.repeat(500))
  assert.equal(check().status, 0)
}))

test('CI 检查已提交的改动时使用指定基点', () => fixture(({ git, write, check }) => {
  const commit = () => {
    git('add', '.')
    git('-c', 'user.name=hiCanvas Test', '-c', 'user.email=test@example.invalid', 'commit', '--no-gpg-sign', '--no-verify', '-m', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  write('src/file.js', '// baseline\n'.repeat(501))
  const base = commit()
  write('src/file.js', '// grown\n'.repeat(502))
  commit()
  const result = check('--base', base)
  assert.equal(result.status, 1, result.output)
  assert.ok(result.output.includes('原文件已超过 500 行'), result.output)
}))

test('无效基点必须报错，首次推送的全零基点允许通过', () => fixture(({ check }) => {
  assert.equal(check('--base', 'missing-ref').status, 1)
  assert.equal(check('--base', '0'.repeat(40)).status, 0)
  assert.equal(check('--base').status, 1)
}))
