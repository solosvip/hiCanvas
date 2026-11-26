import { build } from 'esbuild'
import { parse } from '@babel/parser'
import { readFile, realpath } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const dataPackages = /^@tldraw\/(?:store|tlschema|state|utils|validate)(?:\/|$)/
const textPackages = /^(?:fontkit|linebreak|unicode-segmenter)(?:\/|$)/
// 编辑层只能经纯几何入口进入渲染层；入口带进来的渲染层文件不许是画面入口或组件文件，
// React 与 DOM 另由下面的依赖和宿主检查拦住。新增纯几何小文件不用改这里。
const geometryEntry = 'renderer/geometry.js'
const drawingInput = path => /^renderer\/(?:index|mount|shapes)\.js$/.test(path) || /^renderer\/.*\.[jt]sx$/.test(path)
export const pureGeometryInput = path => /^renderer\/[^/]+\.js$/.test(path) && !drawingInput(path)
export const allowedEngineInput = path => /^(?:engine|model|node_modules)\//.test(path) || pureGeometryInput(path)
const hostNames = new Set(['window', 'document', 'navigator', 'self', 'location', 'history', 'screen', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'localStorage', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'Element', 'Node', 'Text', 'Image', 'Audio', 'ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'customElements'])
const forbiddenName = name => hostNames.has(name) || /^(?:DOM|HTML|SVG|CanvasRenderingContext|CanvasGradient|CanvasPattern|WebGL|CSS)/.test(name || '')

function checkHostAccess(source, path) {
  function walk(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'ObjectPattern' && node.properties.some(property => forbiddenName(property.key?.name ?? property.key?.value))) throw new Error(`运行时不能解构宿主对象：${path}`)
    if (node.type?.startsWith('JSX') || node.type === 'Identifier' && forbiddenName(node.name)
      || ['MemberExpression', 'OptionalMemberExpression'].includes(node.type) && node.object?.name === 'globalThis' && forbiddenName(node.computed ? node.property?.value : node.property?.name)) throw new Error(`运行时不能引用 HTTP、DOM 或界面：${path}`)
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'comments', 'tokens'].includes(key)) continue
      if (key === 'property' && !node.computed && ['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) continue
      if (key === 'key' && !node.computed && ['ObjectProperty', 'ObjectMethod'].includes(node.type)) continue
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') walk(value)
    }
  }
  walk(parse(source, { sourceType: 'module', plugins: ['jsx'] }).program)
}

export async function checkRuntimeBoundary({ root = projectRoot, entryPoints = ['engine/runtime/index.js', 'engine/interaction/index.js'] } = {}) {
  root = await realpath(root)
  const result = await build({
    absWorkingDir: root, entryPoints, outdir: '.scratch/runtime-boundary', bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'runtime-boundary', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const specifier = args.path
        if (specifier.startsWith('node:') || builtinModules.includes(specifier)) throw new Error(`运行时不能引用 Node：${specifier}`)
        if (/^(?:react|react-dom|tldraw|@tldraw\/)/.test(specifier) && !dataPackages.test(specifier)) throw new Error(`运行时不允许的依赖：${specifier}`)
        const importer = relative(root, args.importer)
        if (args.kind === 'entry-point' || !/^(?:engine|model)\//.test(importer) && !pureGeometryInput(importer)) return
        if (specifier.startsWith('.') || specifier.startsWith('/')) {
          const target = relative(root, resolve(dirname(args.importer), specifier))
          const inside = /^(?:engine|model)\//.test(target)
          const versionMetadata = importer === 'renderer/text-variable-metrics.js' && target === 'node_modules/fontkit/package.json'
          const allowed = /^(?:engine|model)\//.test(importer) ? inside || importer.startsWith('engine/') && target === geometryEntry : pureGeometryInput(target) || target.startsWith('model/') || versionMetadata
          if (!allowed) throw new Error(`运行时越界引用：${target}`)
        } else if (!dataPackages.test(specifier) && !textPackages.test(specifier)) throw new Error(`运行时不允许的依赖：${specifier}`)
      })
      // 在加载前拒绝，避免检查本身读取受限包的源码。
      builder.onLoad({ filter: /[/\\]node_modules[/\\](?:tldraw|@tldraw[/\\](?:editor|assets))[/\\]/ }, () => { throw new Error('拒绝加载受限包源码。') })
      builder.onLoad({ filter: /\.[cm]?jsx?$/ }, async args => {
        const path = relative(root, args.path)
        if (!/^(?:engine|model)\//.test(path) && !pureGeometryInput(path)) return
        const contents = await readFile(args.path, 'utf8')
        checkHostAccess(contents, relative(root, args.path))
        return { contents, loader: args.path.endsWith('.jsx') ? 'jsx' : 'js' }
      })
    } }],
  })
  const inputs = Object.keys(result.metafile.inputs)
  if (inputs.some(path => !allowedEngineInput(path))) throw new Error('运行时依赖图越界。')
  if (Object.values(result.metafile.outputs).some(output => output.imports.some(item => item.external))) throw new Error('运行时不能用 external 绕过边界。')
  return inputs
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await checkRuntimeBoundary(); console.log('运行时无 HTTP、DOM、React、Node 依赖检查通过。') }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
