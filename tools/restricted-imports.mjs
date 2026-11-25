import { parse } from '@babel/parser'
import postcss from 'postcss'
import { posix } from 'node:path'

// 按已安装的 5.1.1 包内 LICENSE.md 核对；未核对的新包默认受限。
const mitPackages = new Set(['store', 'tlschema', 'state', 'state-react', 'utils', 'validate'].map(name => `@tldraw/${name}`))
export const sourceFile = path => /\.(?:[cm]?[jt]sx?|css)$/.test(path)
const serverFile = path => /^(?:server|mcp|desktop|bin)\//.test(path)
const unknownModule = '[动态模块目标无法静态确定，请改用字面量]'
const restricted = specifier => {
  if (specifier === unknownModule) return true
  const name = specifier.replace(/^.*?node_modules\//, '').split('/').slice(0, specifier.includes('@tldraw/') ? 2 : 1).join('/')
  return name === 'tldraw' || (name.startsWith('@tldraw/') && !mitPackages.has(name))
}

export function moduleReferences(path, source) {
  if (!sourceFile(path)) return []
  const references = []
  const add = (specifier, names = ['*']) => {
    if (typeof specifier === 'string') for (const name of names) references.push({ specifier, key: `${specifier}#${name}` })
  }
  if (path.endsWith('.css')) {
    postcss.parse(source).walkAtRules(/^(?:import|value)$/i, rule => {
      const match = rule.params.match(/(?:^|\bfrom\s+)(?:url\(\s*)?(?:["']([^"']+)["']|([^\s)]+))/)
      if (match) add(match[1] ?? match[2])
    })
    return references
  }
  const literal = node => {
    if (node?.type === 'StringLiteral') return node.value
    if (node?.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked
    if (node?.type === 'BinaryExpression' && node.operator === '+') {
      const left = literal(node.left), right = literal(node.right)
      if (left !== undefined && right !== undefined) return left + right
    }
  }
  const nodes = []
  const collect = node => {
    if (!node || typeof node !== 'object') return
    nodes.push(node)
    for (const [key, child] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'comments'].includes(key)) continue
      if (Array.isArray(child)) child.forEach(collect)
      else if (child && typeof child === 'object') collect(child)
    }
  }
  collect(parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'], allowReturnOutsideFunction: true }))
  const factories = new Set(['createRequire']), loaders = new Set(['require'])
  for (const node of nodes) if (node.type === 'ImportDeclaration' && ['module', 'node:module'].includes(node.source.value)) {
    for (const specifier of node.specifiers) if (specifier.imported?.name === 'createRequire') factories.add(specifier.local.name)
  }
  const memberName = node => node.computed ? literal(node.property) : node.property?.name
  const factory = node => (node?.type === 'Identifier' && factories.has(node.name)) || (node?.type === 'MemberExpression' && memberName(node) === 'createRequire')
  const loader = node => (node?.type === 'Identifier' && loaders.has(node.name)) || (node?.type === 'CallExpression' && factory(node.callee))
  // 识别 createRequire 返回的加载器及其别名，不能通过改变量名规避。
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (node.type !== 'VariableDeclarator') continue
      if (node.id.type === 'ObjectPattern') for (const property of node.id.properties) {
        if ((property.key?.name ?? property.key?.value) === 'createRequire' && property.value?.type === 'Identifier' && !factories.has(property.value.name)) {
          factories.add(property.value.name)
          changed = true
        }
      }
      if (node.id.type !== 'Identifier') continue
      for (const [matches, names] of [[factory(node.init), factories], [loader(node.init), loaders]]) {
        if (matches && !names.has(node.id.name)) { names.add(node.id.name); changed = true }
      }
    }
  }
  const visit = node => {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
      add(node.source.value, node.specifiers?.length ? node.specifiers.map(s => s.type === 'ImportDefaultSpecifier' ? 'default'
        : ['ImportNamespaceSpecifier', 'ExportNamespaceSpecifier'].includes(s.type) ? '*' : s.imported?.name ?? s.imported?.value ?? s.local?.name) : ['*'])
    } else if (node.type === 'TSExternalModuleReference') add(literal(node.expression) ?? unknownModule)
    else if (node.type === 'TSImportType') add(literal(node.argument) ?? unknownModule)
    else if (node.type === 'ImportExpression') add(literal(node.source) ?? unknownModule)
    else if (node.type === 'CallExpression') {
      const callee = node.callee
      const resolveCall = callee.type === 'MemberExpression' && memberName(callee) === 'resolve'
        && (loader(callee.object) || callee.object.type === 'MetaProperty')
      if (callee.type === 'Import' || loader(callee) || resolveCall) add(literal(node.arguments[0]) ?? unknownModule)
    }
  }
  nodes.forEach(visit)
  return references
}

function added(current, allowed = []) {
  const counts = new Map()
  for (const value of allowed) counts.set(value, (counts.get(value) ?? 0) + 1)
  return current.filter(value => {
    const count = counts.get(value) ?? 0
    if (!count) return true
    counts.set(value, count - 1)
    return false
  })
}

export function checkRestrictedImports(files, baseline, { previousBaseline, previousFiles } = {}) {
  const errors = []
  const references = new Map([...files].filter(([path]) => sourceFile(path)).map(([path, source]) => [path, moduleReferences(path, source)]))
  for (const [path, refs] of references) {
    const current = refs.filter(r => restricted(r.specifier)).map(r => r.key)
    const allowed = path.startsWith('src/') ? baseline[path] : []
    for (const key of added(current, allowed)) errors.push(`${path}：新增受限引用 ${key}；服务端、MCP、桌面及新代码禁止引用受限包。`)
    if (previousFiles?.has(path)) {
      const previous = moduleReferences(path, previousFiles.get(path)).filter(r => restricted(r.specifier)).map(r => r.key)
      for (const key of added(current, previous)) errors.push(`${path}：已移除的受限引用不能重新加入 ${key}。`)
    }
  }
  if (previousBaseline) for (const [path, keys] of Object.entries(baseline)) {
    for (const key of added(keys, previousBaseline[path])) errors.push(`${path}：受限引用基线不能增加 ${key}。`)
  }
  const localTarget = (path, specifier) => {
    if (!specifier.startsWith('.')) return null
    const target = posix.normalize(posix.join(posix.dirname(path), decodeURIComponent(specifier.split(/[?#]/)[0])))
    return [target, ...['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '/index.js', '/index.mjs'].map(ext => target + ext)].find(candidate => references.has(candidate))
  }
  for (const path of references.keys()) {
    if (!serverFile(path)) continue
    const visited = new Set()
    const trace = (current, chain) => {
      if (visited.has(current)) return
      visited.add(current)
      for (const ref of references.get(current) ?? []) {
        if (restricted(ref.specifier) && current !== path) errors.push(`${path}：间接受限引用 ${[...chain, ref.specifier].join(' → ')}。`)
        const target = localTarget(current, ref.specifier)
        if (target) trace(target, [...chain, target])
      }
    }
    trace(path, [path])
  }
  return errors
}
