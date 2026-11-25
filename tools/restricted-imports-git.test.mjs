import './test-sandbox.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkRepositoryImports } from './check-restricted-imports.mjs'
import { moduleReferences } from './restricted-imports.mjs'

const path = 'src/App.jsx'
const source = "import { Box, useEditor } from 'tldraw'"
const reduced = "import { Box } from 'tldraw'"
const baseline = { [path]: moduleReferences(path, source).map(r => r.key) }

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'hicanvas-imports-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe', encoding: 'utf8' }).trim()
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const commit = () => {
    git('add', '.')
    git('-c', 'user.name=hiCanvas Test', '-c', 'user.email=test@example.invalid', 'commit', '--no-gpg-sign', '--no-verify', '-m', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  const check = options => checkRepositoryImports({ root, env, ...options })
  try {
    git('init', '-b', 'main')
    git('config', 'core.hooksPath', '.disabled-hooks')
    write('tools/restricted-imports-baseline.json', JSON.stringify(baseline))
    write(path, source)
    commit()
    run({ write, git, commit, check })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test('导入检查读取真正的暂存内容，工作区修正不能掩盖待提交违规', () => fixture(({ write, git, check }) => {
  write(path, source + "\nimport { Vec } from 'tldraw'")
  assert.deepEqual(check({ staged: true }), [])
  assert.match(check().join('\n'), /新增受限引用/)
  git('add', '.')
  write(path, source)
  assert.match(check({ staged: true }).join('\n'), /新增受限引用/)
  assert.deepEqual(check(), [])
}))

test('不能同时扩张继承基线和源代码来绕过检查', () => fixture(({ write, check }) => {
  const extra = "import { Vec } from 'tldraw'"
  write('src/New.jsx', extra)
  write('tools/restricted-imports-baseline.json', JSON.stringify({ ...baseline, 'src/New.jsx': moduleReferences('src/New.jsx', extra).map(r => r.key) }))
  assert.match(check().join('\n'), /基线不能增加/)
}))

test('减少依赖后的额度不能恢复，CI 指定基点也能拦住已提交的重新引入', () => fixture(({ write, commit, check }) => {
  write(path, reduced)
  const base = commit()
  write(path, source)
  assert.match(check().join('\n'), /已移除的受限引用不能重新加入/)
  commit()
  assert.match(check({ base }).join('\n'), /已移除的受限引用不能重新加入/)
}))

test('新建未暂存服务端文件也会检查间接受限依赖', () => fixture(({ write, check }) => {
  write('server/new.mjs', "import '../src/App.jsx'")
  assert.match(check().join('\n'), /server\/new.mjs.*间接/)
}))
