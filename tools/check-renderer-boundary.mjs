import { build } from 'esbuild'
import { parse } from '@babel/parser'
import { readFile, realpath } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const dataPackages = /^@tldraw\/(?:store|tlschema|state|state-react|utils|validate)(?:\/|$)/
const textPackages = /^(?:fontkit|linebreak|unicode-segmenter)(?:\/|$)/
const reactPackages = /^(?:react|react-dom)(?:\/|$)/
const domGlobals = new Set(['window', 'document', 'navigator', 'self', 'location', 'history', 'screen', 'Element', 'Node', 'Text', 'Image', 'Audio', 'Event', 'EventTarget', 'ImageData', 'Path2D', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'OffscreenCanvas', 'customElements', 'localStorage', 'sessionStorage', 'CSS'])
const isDomName = name => domGlobals.has(name) || /^(?:DOM|HTML|SVG|Canvas|WebGL|CSS|XML|XPath)[A-Z][A-Za-z0-9]*$/.test(name || '') || /^(?:Mouse|Pointer|Keyboard|Wheel|Touch|Input|Focus|Drag|Clipboard|Custom|Animation|Transition|Message)Event$/.test(name || '')

function checkNoDom(source, path) {
  const walk = node => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'Identifier' && isDomName(node.name)
      || node.type === 'MemberExpression' && node.computed && isDomName(node.property?.value)) throw new Error(`几何入口不能引用 DOM：${path}`)
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'comments', 'tokens'].includes(key)) continue
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') walk(value)
    }
  }
  walk(parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] }).program)
}

export async function checkRendererBoundary({ root = projectRoot, geometry = false } = {}) {
  // esbuild reports canonical importers; compare them against the same root,
  // including macOS temporary directories reached through /var symlinks.
  root = await realpath(root)
  const entry = geometry ? 'renderer/geometry.js' : 'renderer/index.js'
  const result = await build({
    absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'renderer-boundary', setup(builder) {
      builder.onLoad({ filter: /[/\\]node_modules[/\\](?:tldraw|@tldraw[/\\](?:editor|assets))[/\\]/ }, () => { throw new Error('拒绝加载受限包源码。') })
      builder.onResolve({ filter: /.*/ }, args => {
        const specifier = args.path
        if (specifier.startsWith('node:') || builtinModules.includes(specifier)) throw new Error(`渲染层不能引用 Node：${specifier}`)
        if (/^(?:tldraw|@tldraw\/)/.test(specifier) && !dataPackages.test(specifier)) throw new Error(`渲染层不能引用受限包：${specifier}`)
        if (geometry && reactPackages.test(specifier)) throw new Error('几何入口不能引用 React。')
        const importer = relative(root, args.importer)
        if (args.kind === 'entry-point' || !/^(?:renderer|model)\//.test(importer)) return
        if (specifier.startsWith('.') || specifier.startsWith('/')) {
          const target = relative(root, resolve(dirname(args.importer), specifier))
          const versionMetadata = importer === 'renderer/text-variable-metrics.js' && target === 'node_modules/fontkit/package.json'
          const allowed = importer.startsWith('model/') ? target.startsWith('model/') : target.startsWith('renderer/') || target === 'model/index.js' || versionMetadata
          if (!allowed) throw new Error(`渲染层越界引用：${target}`)
        } else if (!dataPackages.test(specifier) && (importer.startsWith('model/') || (!reactPackages.test(specifier) && !textPackages.test(specifier)))) throw new Error(`渲染层未允许的依赖：${specifier}`)
      })
      if (geometry) builder.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
        const contents = await readFile(args.path, 'utf8')
        checkNoDom(contents, relative(root, args.path))
        const extension = extname(args.path).slice(1)
        return { contents, loader: ['jsx', 'ts', 'tsx'].includes(extension) ? extension : 'js' }
      })
    } }]
  })
  for (const path of Object.keys(result.metafile.inputs)) {
    if (!/^(?:renderer|model|node_modules)\//.test(path)) throw new Error(`渲染依赖图越界：${path}`)
    if (geometry && /(?:^|\/)node_modules\/(?:react|react-dom)\//.test(path)) throw new Error(`几何依赖图带入 React：${path}`)
  }
  if (Object.values(result.metafile.outputs).some(output => output.imports.some(item => item.external))) throw new Error('渲染依赖必须完整打包，不能用 external 绕过检查。')
  return Object.keys(result.metafile.inputs)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await checkRendererBoundary()
    await checkRendererBoundary({ geometry: true })
    console.log('渲染层浏览器依赖与无 React/DOM 的独立几何入口检查通过。')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
