import './test-sandbox.mjs'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
    // 临时仓库复用正式检查器所用的解析器，不另装环境或软链依赖。
    for(const name of ['check.mjs','check-content-isolation.mjs'])write('tools/'+name, readFileSync(join(dirname(checker),name), 'utf8').replace("from '@babel/parser'", `from '${import.meta.resolve('@babel/parser')}'`))
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

for (const [name, path, content] of [
  ['CSS 隐藏', 'src/styles.css', '[data-testid="tl-watermark-unlicensed"] { display: none !important; }'],
  ['CSS 透明与移出画布', 'src/styles.css', '.tl-watermark { opacity: 0; transform: translateX(100vw); }'],
  ['父层选择器遮挡', 'src/styles.css', '.canvas:has([data-testid="tl-watermark-licensed"]) { visibility: hidden; }'],
  ['DOM 改写', 'src/editor/localize.js', 'document.querySelector("[data-testid=tl-watermark-unlicensed]").textContent = "别的提示"'],
  ['组件替换', 'src/components.jsx', 'export const components = { Watermark: () => null }'],
  ['桌面注入', 'desktop/preload.cjs', 'document.querySelector(".tl-watermark").remove()'],
  ['HTML 内联隐藏', 'index.html', '<style>.tl-watermark { display: none }</style>'],
  ['构建时注入', 'tools/build.mjs', 'const css = ".tl-watermark { display: none }"'],
]) {
  test(`许可提示守卫拦住${name}`, () => fixture(({ write, check }) => {
    write('DESIGN.md', '# Design\n')
    write(path, content)
    const result = check()
    assert.equal(result.status, 1, result.output)
    assert.ok(result.output.includes('不得改写、隐藏或遮挡 tldraw 许可提示'), result.output)
  }))
}

test('许可提示守卫允许普通样式、SDK 导入和检查用例', () => fixture(({ write, check }) => {
  write('DESIGN.md', '# Design\n')
  write('src/styles.css', '.canvas { display: block; }')
  write('src/sdk.js', 'import { Tldraw } from "tldraw"\n')
  write('src/image.js', 'export const options = { watermark: "用户图片水印" }\n')
  write('tools/license.test.mjs', 'import "./test-sandbox.mjs"\nconst fixture = ".tl-watermark { display: none }"\n')
  assert.equal(check().status, 0)
}))

test('许可提示守卫检查暂存区，未暂存的修正不能掩盖隐藏规则', () => fixture(({ git, write, check }) => {
  write('DESIGN.md', '# Design\n')
  write('src/styles.css', '.tl-watermark { display: none }')
  git('add', '.')
  write('src/styles.css', '.canvas { display: block }')
  assert.equal(check('--staged').status, 1)
  assert.equal(check().status, 0)
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

for (const [name, source] of [
  ['没有隔离导入', "import assert from 'node:assert/strict'\n"],
  ['业务模块先加载', "import '../server/storage.mjs'\nimport './test-sandbox.mjs'\n"],
  ['说明注释之间先加载业务模块', "/* 测试 */\nimport { canvasDir } from '../server/storage.mjs'\n/* 为什么先隔离 */\nimport './test-sandbox.mjs'\n"],
  ['注释中的假导入', "// import './test-sandbox.mjs'\nimport '../server/storage.mjs'\n"],
  ['字符串中的假导入', "const note = \"import './test-sandbox.mjs'\"\n"],
  ['同名错误模块', "import '../other/test-sandbox.mjs'\n"],
]) {
  test(`测试隔离守卫拦住${name}`, () => fixture(({ write, check }) => {
    write('tools/unsafe.test.mjs', source)
    const result = check()
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /测试必须第一条导入.*否则可能读取或删除真实资料目录/)
  }))
}

test('测试隔离守卫接受首行副作用导入及其前面的说明注释', () => fixture(({ write, check }) => {
  write('tools/safe.test.mjs', "#!/usr/bin/env node\n/* 为什么先隔离 */\n// 说明\nimport './test-sandbox.mjs';\nimport '../server/storage.mjs'\n")
  write('server/safe.test.mjs', "import '../tools/test-sandbox.mjs'\nimport './storage.mjs'\n")
  assert.equal(check().status, 0)
}))

test('测试隔离守卫检查暂存区，未暂存的补导入不能掩盖危险入口', () => fixture(({ git, write, check }) => {
  write('server/unsafe.test.mjs', "import './storage.mjs'\n")
  git('add', '.')
  write('server/unsafe.test.mjs', "import '../tools/test-sandbox.mjs'\nimport './storage.mjs'\n")
  assert.equal(check('--staged').status, 1)
  assert.equal(check().status, 0)
}))

for (const [name, source] of [
  ['直接赋值', 'snapshot.store[id] = record'],
  ['深层属性', 'snapshot.store[id].props.w = 300'],
  ['删除记录', 'delete snapshot.store[id]'],
  ['累加属性', 'snapshot.store[id].x += 20'],
  ['自增属性', 'snapshot.store[id].x++'],
  ['Object.assign', 'Object.assign(snapshot.store[id].meta, changes)'],
  ['别名', 'const records = snapshot.store; const shape = records[id]; shape.x = 10'],
  ['赋值别名', 'let shape; shape = snapshot.store[id]; shape.x = 99'],
  ['赋值存储别名', 'let records; records = snapshot.store; delete records[id]'],
  ['解构赋值别名', 'let records; ({store: records} = snapshot); delete records[id]'],
  ['解构别名', 'const {store: records} = snapshot; delete records[id]'],
  ['遍历别名', 'for (const shape of Object.values(snapshot.store)) shape.x = 10'],
  ['回调别名', 'Object.values(snapshot.store).forEach(shape => { shape.x = 10 })'],
  ['参数解构', 'function edit({store}, target, value) { store[target] = value }'],
  ['参数改名', 'function edit({store: records}, target) { delete records[target] }'],
  ['参数默认值', 'function edit({store: records = {}} = {}, target) { records[target].x = 30 }'],
  ['已删除的通用写入', 'workspace.mutate(id, revision, snapshot => snapshot)'],
  ['改名的通用写入', 'const write = workspace.mutate; write(id, revision, transform)'],
  ['解构的通用写入', 'const { mutate: write } = workspace; write(id, revision, transform)'],
]) {
  test(`命令写入守卫拦住${name}`, () => fixture(({ write, check }) => {
    write('server/violation.mjs', `export function bad(snapshot, workspace, id, record, revision, changes, transform) { ${source} }`)
    const result = check()
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /server\/violation.mjs.*改用 submitCommands.*旧界面.*replaceLegacySnapshot/)
  }))
}

test('命令写入守卫允许读取、命令数据和测试材料，忽略注释字符串中的示例', () => fixture(({ write, check }) => {
  write('server/valid.mjs', `
    // delete snapshot.store[id]
    const example = 'snapshot.store[id] = record'
    const record = snapshot.store[id]
    workspace.submitCommands(id, revision, actor, () => [{type: 'update', id, changes: {x: record.x + 1}}])
    workspace.replaceLegacySnapshot(id, revision, replacement)
  `)
  write('server/material.test.mjs', "import '../tools/test-sandbox.mjs'\nsnapshot.store[id].x = 10\n")
  assert.equal(check().status, 0)
}))

test('命令写入守卫读取暂存区，未暂存的改正不能掩盖违规', () => fixture(({ git, write, check }) => {
  write('server/violation.mjs', 'snapshot.store[id].x = 50')
  git('add', '.')
  write('server/violation.mjs', 'const record = snapshot.store[id]')
  assert.equal(check('--staged').status, 1)
  assert.equal(check().status, 0)
}))

test('命令写入守卫区分作用域，同名新对象的修改不会被误报', () => fixture(({ write, check }) => {
  write('server/scopes.mjs', `
    function read(snapshot, id) { const record = snapshot.store[id]; return record.x }
    function create() { const record = {x: 1}; record.x = 2; return record }
    function shadow(snapshot, id) {
      const record = snapshot.store[id]
      { const record = {x: 1}; record.x = 2 }
      return record.x
    }
  `)
  assert.equal(check().status, 0)
}))
