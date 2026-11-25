#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

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

function checkCommandWrites(path, content) {
  if (!path.startsWith('server/') || path.endsWith('.test.mjs') || !/\.[cm]?js$/.test(path)) return
  // ADR 0006 判据清单（检查工作区与暂存区同样生效）：
  // 1. 禁止读取或调用已移除的 .mutate 通用快照写入接口。
  // 2. 禁止对 .store 及从它取得的记录/属性赋值、自增、delete。
  // 3. 禁止 Object.assign/defineProperty、Reflect.set/deleteProperty 或数组方法就地修改它。
  // 跟踪声明、解构、遍历与集合回调中的别名；读取、构造命令和格式迁移的新对象可保留。
  const nodes = [], aliases = new Set(), scopes = new WeakMap(), parents = new WeakMap()
  const isFunction = node => /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ObjectMethod|ClassMethod)$/.test(node.type)
  function walk(node, scope, parent) {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'Program' || isFunction(node) || ['BlockStatement', 'CatchClause', 'ForStatement', 'ForOfStatement', 'ForInStatement'].includes(node.type)) {
      scope = { parent: scope, bindings: new Map(), function: node.type === 'Program' || isFunction(node) }
    }
    nodes.push(node); scopes.set(node, scope); parents.set(node, parent)
    for (const child of Object.values(node)) if (Array.isArray(child)) child.forEach(value => walk(value, scope, node)); else if (child && typeof child === 'object') walk(child, scope, node)
  }
  walk(parse(content, { sourceType: 'module' }).program)
  function identifiers(pattern) {
    if (!pattern) return []
    if (pattern.type === 'Identifier') return [pattern]
    if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(property => identifiers(property.value || property.argument))
    if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(identifiers)
    if (pattern.type === 'AssignmentPattern') return identifiers(pattern.left)
    if (pattern.type === 'RestElement') return identifiers(pattern.argument)
    return []
  }
  function declare(pattern, scope) {
    for (const identifier of identifiers(pattern)) if (!scope.bindings.has(identifier.name)) scope.bindings.set(identifier.name, {})
  }
  for (const node of nodes) {
    let scope = scopes.get(node)
    if (node.type === 'VariableDeclarator') {
      if (parents.get(node).kind === 'var') while (!scope.function) scope = scope.parent
      declare(node.id, scope)
    }
    if (isFunction(node)) node.params.forEach(parameter => declare(parameter, scope))
    if (node.type === 'CatchClause') declare(node.param, scope)
  }
  function binding(identifier) {
    for (let scope = scopes.get(identifier); scope; scope = scope.parent) if (scope.bindings.has(identifier.name)) return scope.bindings.get(identifier.name)
  }
  const member = node => ['MemberExpression', 'OptionalMemberExpression'].includes(node?.type)
  const name = node => node?.computed ? node.property.value : node?.property?.name
  function stored(node) {
    if (!node) return false
    if (node.type === 'Identifier') return aliases.has(binding(node))
    if (member(node)) return name(node) === 'store' || stored(node.object)
    if (node.type === 'CallExpression') return stored(node.callee?.object) ||
      (['values', 'entries'].includes(name(node.callee)) && node.callee.object?.name === 'Object' && stored(node.arguments[0])) ||
      (node.callee.name === 'structuredClone' && stored(node.arguments[0]))
    return false
  }
  function bind(pattern) {
    for (const identifier of identifiers(pattern)) { const symbol = binding(identifier); if (symbol) aliases.add(symbol) }
  }
  function propagate(pattern, value) {
    if (stored(value)) bind(pattern)
    else if (pattern.type === 'AssignmentPattern') propagate(pattern.left, pattern.right)
    else if (pattern.type === 'ObjectPattern') for (const property of pattern.properties) if ((property.key?.name || property.key?.value) === 'store') bind(property.value)
  }
  let size
  do {
    size = aliases.size
    for (const node of nodes) {
      if (node.type === 'VariableDeclarator') propagate(node.id, node.init)
      if (node.type === 'AssignmentExpression') propagate(node.left, node.right)
      if (isFunction(node)) node.params.forEach(parameter => propagate(parameter))
      if (node.type === 'ForOfStatement' && stored(node.right)) bind(node.left.declarations?.[0]?.id || node.left)
      if (node.type === 'CallExpression' && member(node.callee) && stored(node.callee.object)) {
        for (const callback of node.arguments.filter(arg => ['ArrowFunctionExpression', 'FunctionExpression'].includes(arg.type))) {
          // reduce 的首参是调用方创建的累加器，其余集合方法的首参是记录。
          bind(callback.params[name(node.callee) === 'reduce' ? 1 : 0])
        }
      }
    }
  } while (aliases.size !== size)
  for (const node of nodes) {
    const direct = node.type === 'AssignmentExpression' ? member(node.left) && stored(node.left) : node.type === 'UpdateExpression' || (node.type === 'UnaryExpression' && node.operator === 'delete') ? member(node.argument) && stored(node.argument) : false
    const removed = (member(node) && name(node) === 'mutate') || (node.type === 'ObjectPattern' && node.properties.some(property => (property.key?.name || property.key?.value) === 'mutate'))
    const call = node.type === 'CallExpression' && member(node.callee) && (
      (['assign', 'defineProperty', 'defineProperties', 'set', 'deleteProperty'].includes(name(node.callee)) && ['Object', 'Reflect'].includes(node.callee.object?.name) && stored(node.arguments[0])) ||
      (['push', 'pop', 'shift', 'unshift', 'splice', 'fill', 'copyWithin', 'reverse', 'sort'].includes(name(node.callee)) && stored(node.callee.object) && node.callee.object.type !== 'CallExpression'))
    if (direct || removed || call) errors.push(`${path}:${node.loc.start.line}：服务端不得直接修改快照记录或使用通用写入；改用 submitCommands；旧界面整份提交仅可使用临时例外 replaceLegacySnapshot。`)
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
      checkCommandWrites(path, content)
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
