#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const staged = process.argv.includes('--staged')
const errors = []
let baseline

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

function walk(directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['.git', 'node_modules', '.scratch', '.local', 'dist', 'build'].includes(entry.name)) return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [relative(root, path)]
  })
}

function listFiles() {
  try {
    const args = staged
      ? ['ls-files', '--cached', '-z']
      : ['ls-files', '--cached', '--others', '--exclude-standard', '-z']
    return [...new Set(git(args).split('\0').filter(Boolean))]
      .filter((path) => staged || existsSync(join(root, path)))
  } catch (error) {
    if (staged || existsSync(join(root, '.git'))) throw error
    return walk()
  }
}

function read(path) {
  return staged ? git(['show', `:${path}`]) : readFileSync(join(root, path), 'utf8')
}

function lines(content) {
  return content === '' ? 0 : content.split('\n').length - Number(content.endsWith('\n'))
}

function resolveBaseline() {
  const index = process.argv.indexOf('--base')
  const requested = index === -1 ? undefined : process.argv[index + 1]
  if (index !== -1 && (!requested || requested.startsWith('--'))) throw new Error('--base 缺少提交基点。')
  if (requested && /^0{40,64}$/.test(requested)) return undefined
  try {
    return git(['rev-parse', '--verify', `${requested ?? 'HEAD'}^{commit}`]).trim()
  } catch (error) {
    if (requested) throw new Error(`无法读取指定基点 ${requested}，请获取对应 Git 历史。`, { cause: error })
    return undefined
  }
}

function checkSource(path, content) {
  if (!/\.(?:[cm]?js|jsx|tsx?|py|sh|swift|rs|css)$/.test(path)) return
  const count = lines(content)
  if (count > 900) errors.push(`${path}：${count} 行，超过源码 900 行上限。`)
  if (!baseline) return
  try {
    const previous = lines(git(['show', `${baseline}:${path}`]))
    if (previous > 500 && count > previous) {
      errors.push(`${path}：原文件已超过 500 行，本次仍在增长。`)
    }
  } catch {
    // 新文件在基点中没有可比较的旧版本。
  }
}

function checkLicenseWatermark(path, content) {
  if (path === 'tools/check.mjs' || /\.test\.[cm]?[jt]sx?$/.test(path)
    || !/\.(?:[cm]?[jt]sx?|css|html)$/.test(path)) return
  // 提示由 SDK 管理；应用不应再选择、替换或重新命名它。
  if (/tl[-_]watermark/i.test(content) || /\b(?:Watermark\s*[:=]|TldrawLogo\b)/.test(content)) {
    errors.push(`${path}：不得改写、隐藏或遮挡 tldraw 许可提示；保留 SDK 原始组件与样式。`)
  }
}

function checkTestSandbox(path, content) {
  if (!path.endsWith('.test.mjs')) return
  let source = content.replace(/^\uFEFF/, '').replace(/^#![^\n]*(?:\n|$)/, '')
  // 按首个注释结束符前进；重复正则会回溯跨过业务导入，误认后面的隔离导入。
  while (true) {
    source = source.trimStart()
    if (source.startsWith('//')) {
      const end = source.indexOf('\n')
      source = end === -1 ? '' : source.slice(end + 1)
    } else if (source.startsWith('/*')) {
      const end = source.indexOf('*/', 2)
      if (end === -1) break
      source = source.slice(end + 2)
    } else break
  }
  const first = source.match(/^import\s*(['"])([^'"\r\n]+)\1\s*(?:;|\r?\n|$)/)
  if (!first || !first[2].startsWith('.') || resolve(root, dirname(path), first[2]) !== join(root, 'tools/test-sandbox.mjs')) {
    errors.push(`${path}：测试必须第一条导入 tools/test-sandbox.mjs；否则可能读取或删除真实资料目录。`)
  }
}

const rootDocs = new Set(['README.md', 'AGENTS.md', 'CONTEXT.md', 'DESIGN.md', '版本管理.md', 'todolist.md', '架构说明.md'])
function checkDocument(path) {
  if (!/\.md$/i.test(path)) return
  const allowed = rootDocs.has(path)
    || /^docs\/(?:adr|agents|验收)\/.+\.md$/.test(path)
    || path === 'docs/事故档案.md'
    || /^skills\/hicanvas\/(?:SKILL\.md|references\/(?!SKILL\.md$)[^/]+\.md)$/.test(path)
  if (!allowed) errors.push(`${path}：文档位置尚未登记，请先更新 AGENTS.md 文档地图及检查。`)
}

function checkPrivateFile(path) {
  const segments = path.split('/')
  if (segments.some((part) => ['canvas', 'data', 'userdata', 'models', '.scratch', '.local', 'node_modules', '.venv'].includes(part))) {
    errors.push(`${path}：本地数据或运行目录不应进入仓库。`)
  }
  const name = segments.at(-1)
  if ((/^\.env(?:\.|$)/.test(name) && name !== '.env.example')
    || /\.(?:db|sqlite3?)(?:-.*)?$|\.(?:pem|key|log)$/.test(name)) {
    errors.push(`${path}：密钥配置、数据库或日志不应进入仓库。`)
  }
}

function checkRules(files, contents) {
  const forbidden = new Set(['CLAUDE.md', 'CLAUDE.local.md'])
  for (const path of files) {
    if (forbidden.has(path.split('/').at(-1))) errors.push(`${path}：AI 规则统一放在 AGENTS.md。`)
  }
  let parent = dirname(root)
  while (true) {
    for (const name of ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md']) {
      if (existsSync(join(parent, name))) errors.push(`${join(parent, name)}：上级规则入口会阻止读取 AGENTS.md。`)
    }
    const next = dirname(parent)
    if (next === parent) break
    parent = next
  }
  if (!contents.has('AGENTS.md')) errors.push('缺少项目根 AGENTS.md。')
  const rules = files.filter((path) => path.split('/').at(-1) === 'AGENTS.md')
  for (const path of rules) {
    const parents = path.split('/').slice(0, -1)
    let bytes = Buffer.byteLength(contents.get('AGENTS.md') ?? '')
    for (let i = 1; i <= parents.length; i += 1) {
      bytes += Buffer.byteLength(contents.get(`${parents.slice(0, i).join('/')}/AGENTS.md`) ?? '')
    }
    if (bytes > 32 * 1024) errors.push(`${path}：规则链合计 ${bytes} 字节，超过 32KB。`)
  }
  const hasPages = files.some((path) => /^(?:src|web\/src)\/.+\.(?:jsx|tsx|css)$/.test(path))
  if (hasPages && !contents.has('DESIGN.md')) errors.push('已有正式界面，但缺少经确认的 DESIGN.md。')
}

try {
  baseline = resolveBaseline()
  const files = listFiles()
  const contents = new Map()
  for (const path of files) {
    checkDocument(path)
    checkPrivateFile(path)
    if (/\.(?:[cm]?js|jsx|tsx?|py|sh|swift|rs|css|html|md|json|ya?ml)$/.test(path)) {
      const content = read(path)
      contents.set(path, content)
      checkSource(path, content)
      checkLicenseWatermark(path, content)
      checkTestSandbox(path, content)
    }
  }
  checkRules(files, contents)
  if (files.includes('tools/check-restricted-imports.mjs')) {
    try {
      execFileSync(process.execPath, ['tools/check-restricted-imports.mjs', ...(staged ? ['--staged'] : []), ...(baseline ? ['--base', baseline] : [])], { cwd: root, stdio: 'pipe' })
    } catch (error) {
      errors.push(`受限引用检查未通过：${error.stderr?.toString().trim() || error.message}`)
    }
  }
  if (errors.length) {
    process.stderr.write(`${errors.map((error) => `✗ ${error}`).join('\n')}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`hiCanvas 基础检查通过（${staged ? '暂存区' : '工作区'}，${files.length} 个文件）。\n`)
  }
} catch (error) {
  process.stderr.write(`hiCanvas 检查无法完成：${error.message}\n`)
  process.exitCode = 1
}
