import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const checker = join(dirname(fileURLToPath(import.meta.url)), 'check.mjs')

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'hicanvas-check-'))
  // Git 钩子会导出 GIT_DIR/GIT_INDEX_FILE；子仓库必须清掉，不能操作真实仓库。
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' }).toString().trim()
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const check = (...args) => {
    const result = spawnSync(process.execPath, ['tools/check.mjs', ...args], { cwd: root, env, encoding: 'utf8' })
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

test('提交钩子的 Git 环境不能让测试改写外层仓库', () => fixture(({ root, git, write }) => {
  write('outside.txt', '必须保留\n')
  git('add', '.')
  git('-c', 'user.name=hiCanvas Test', '-c', 'user.email=test@example.invalid', 'commit', '--no-gpg-sign', '--no-verify', '-m', 'outer')
  const head = git('rev-parse', 'HEAD')
  const original = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE }
  try {
    process.env.GIT_DIR = join(root, '.git')
    process.env.GIT_INDEX_FILE = join(root, '.git', 'index')
    fixture(({ root: inner, git: innerGit, write: innerWrite }) => {
      assert.equal(realpathSync(innerGit('rev-parse', '--absolute-git-dir')), realpathSync(join(inner, '.git')))
      innerWrite('inside.txt', '只在临时仓库\n')
      innerGit('add', '.')
      innerGit('-c', 'user.name=hiCanvas Test', '-c', 'user.email=test@example.invalid', 'commit', '--no-gpg-sign', '--no-verify', '-m', 'inner')
    })
    assert.equal(git('rev-parse', 'HEAD'), head)
    assert.equal(git('status', '--porcelain'), '')
    assert.equal(git('config', 'core.hooksPath'), '.disabled-hooks')
  } finally {
    for (const [key, value] of Object.entries(original)) if (value === undefined) delete process.env[key]; else process.env[key] = value
  }
}))

test('允许合规的初始仓库及无密钥配置模板', () => fixture(({ write, check }) => {
  write('.env.example', 'IMAGE_API_KEY=\n')
  assert.equal(check().status, 0)
}))

test('只分发一个 hicanvas 技能和参考文档，拦住额外技能及任意笔记', () => fixture(({ write, check }) => {
  write('skills/hicanvas/SKILL.md', '---\nname: hicanvas\ndescription: 打开画板\n---\n')
  write('skills/hicanvas/references/runtime-contract.md', '# 播放协议\n')
  assert.equal(check().status, 0)
  write('skills/hicanvas/notes.md', '# 未登记笔记\n')
  write('skills/hicanvas-extra/SKILL.md', '# 不再分发第二个技能\n')
  write('skills/hicanvas/references/SKILL.md', '# 参考目录也不能藏第二个入口\n')
  const result = check()
  assert.equal(result.status, 1)
  assert.ok(result.output.includes('skills/hicanvas/notes.md：文档位置尚未登记'))
  assert.ok(result.output.includes('skills/hicanvas-extra/SKILL.md：文档位置尚未登记'))
  assert.ok(result.output.includes('skills/hicanvas/references/SKILL.md：文档位置尚未登记'))
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
