import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRendererBoundary } from './check-renderer-boundary.mjs'

test('TipTap仅能由文字视图和schema引用；绘图、模型和几何不能借此放宽依赖', async () => {
  const root = await mkdtemp(join(tmpdir(), 'renderer-text-boundary-'))
  try {
    await mkdir(join(root, 'renderer')); await mkdir(join(root, 'model'))
    await mkdir(join(root, 'node_modules/@tiptap/core'), { recursive: true })
    await writeFile(join(root, 'node_modules/@tiptap/core/package.json'), JSON.stringify({ name: '@tiptap/core', main: 'index.js' }))
    await writeFile(join(root, 'node_modules/@tiptap/core/index.js'), 'export const value = 1')
    for (const file of ['text-editing-view', 'text-schema']) {
      await writeFile(join(root, `renderer/${file}.js`), "export { value } from '@tiptap/core'")
      await writeFile(join(root, 'renderer/index.js'), `export * from './${file}.js'`)
      await checkRendererBoundary({ root })
      await writeFile(join(root, 'renderer/geometry.js'), `export * from './${file}.js'`)
      await assert.rejects(checkRendererBoundary({ root, geometry: true }), /几何/)
    }
    for (const [file, source] of [['renderer/drawing.js', "export * from '@tiptap/core'"], ['model/index.js', "export * from '@tiptap/core'"], ['renderer/text-schema.js', "export * from '@tiptap-pro/extension-ai'"]]) {
      await writeFile(join(root, file), source)
      await writeFile(join(root, 'renderer/index.js'), `export * from '../${file}'`)
      await assert.rejects(checkRendererBoundary({ root }), /未允许|越界/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('真实渲染入口可浏览器打包，几何入口独立且没有 React/DOM', async () => {
  const inputs = await checkRendererBoundary()
  assert.ok(inputs.some(path => path.includes('@tldraw/state-react/')))
  assert.ok(inputs.some(path => path.includes('react-dom/')))
  const pure = await checkRendererBoundary({ geometry: true })
  assert.ok(pure.some(path => path.includes('node_modules/fontkit/')))
  assert.ok(pure.some(path => path.includes('node_modules/linebreak/')))
  assert.ok(pure.some(path => path.includes('node_modules/unicode-segmenter/')))
  assert.deepEqual(pure.filter(path => /node_modules\/(?:react|react-dom)\//.test(path)), [])
})
test('共用通道只经公开入口使用，内部不得反向依赖旧界面、渲染、编辑、Node或React',async()=>{
  const root=await mkdtemp(join(tmpdir(),'channel-boundary-'))
  try{
    await mkdir(join(root,'renderer'));await mkdir(join(root,'content-channel'))
    await writeFile(join(root,'renderer/index.js'),"export * from '../content-channel/index.js'")
    await writeFile(join(root,'content-channel/index.js'),"export * from './protocol.js'")
    await writeFile(join(root,'content-channel/protocol.js'),'export const protocol=1')
    await checkRendererBoundary({root})
    for(const dependency of ['../src/filmPlayback.js','../renderer/index.js','../engine/index.js','node:fs','react','tldraw','html2canvas/dist/lib/index.js','mediabunny']){
      await writeFile(join(root,'content-channel/protocol.js'),`import ${JSON.stringify(dependency)}`)
      await assert.rejects(checkRendererBoundary({root}),/内容通道越界/,dependency)
    }
    await writeFile(join(root,'content-channel/protocol.js'),'export const protocol=1')
    // The exception is both filename- and exact-path-specific, never a package
    // prefix allowlist that could later admit unrelated internals.
    for(const dependency of ['html2canvas','html2canvas/dist/lib/other.js','react','node:fs','tldraw']){
      await writeFile(join(root,'content-channel/capture-clip-fix.js'),`import ${JSON.stringify(dependency)}`)
      await assert.rejects(checkRendererBoundary({root}),/内容通道越界/)
    }
    await writeFile(join(root,'content-channel/capture-clip-fix.js'),'export const capture=1')
    for(const dependency of ['mediabunny/internal','node:fs','react','tldraw']){
      await writeFile(join(root,'content-channel/film-video-frames.js'),`import ${JSON.stringify(dependency)}`)
      await assert.rejects(checkRendererBoundary({root}),/内容通道越界/)
    }
    await writeFile(join(root,'content-channel/film-video-frames.js'),'export const video=1')
    await mkdir(join(root,'content-channel/nested'))
    await writeFile(join(root,'content-channel/nested/hidden.js'),"import 'react'")
    await assert.rejects(checkRendererBoundary({root}),/内容通道越界/)
    await writeFile(join(root,'content-channel/nested/hidden.js'),"export * from '../protocol.js'")
    await checkRendererBoundary({root})
    await writeFile(join(root,'renderer/index.js'),"export * from '../content-channel/protocol.js'")
    await assert.rejects(checkRendererBoundary({root}),/渲染层越界/)
    await writeFile(join(root,'renderer/geometry.js'),"export * from '../content-channel/index.js'")
    await writeFile(join(root,'content-channel/protocol.js'),'export const doc=window.document')
    await assert.rejects(checkRendererBoundary({root,geometry:true}),/几何/)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('渲染经模型公开入口读取内部数据，模型不能反向导入渲染且渲染不能直达模型内部', async () => {
  const base = await mkdtemp(join(tmpdir(), 'renderer-model-boundary-'))
  const actual = join(base, 'actual'), root = join(base, 'linked-project')
  await mkdir(actual)
  await symlink(actual, root, process.platform === 'win32' ? 'junction' : 'dir')
  try {
    await mkdir(join(root, 'renderer')); await mkdir(join(root, 'model'))
    await writeFile(join(root, 'renderer/index.js'), "export * from '../model/index.js'\n")
    await writeFile(join(root, 'model/index.js'), "export * from './services.js'\n")
    await writeFile(join(root, 'model/services.js'), 'export const constraint = 200\n')
    const inputs = await checkRendererBoundary({ root })
    assert.ok(inputs.includes('model/services.js'))
    await writeFile(join(root, 'renderer/index.js'), "export * from '../model/services.js'\n")
    await assert.rejects(checkRendererBoundary({ root }), /越界/)
    await writeFile(join(root, 'renderer/index.js'), "export * from '../model/index.js'\n")
    await writeFile(join(root, 'renderer/drawing.js'), 'export const drawing = 1\n')
    await writeFile(join(root, 'model/services.js'), "export * from '../renderer/drawing.js'\n")
    await assert.rejects(checkRendererBoundary({ root }), /越界/)
    for (const specifier of ['react', 'unlisted-package']) {
      await writeFile(join(root, 'model/services.js'), `export * from '${specifier}'\n`)
      await assert.rejects(checkRendererBoundary({ root }), /未允许的依赖/)
    }
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('临时插入直接与间接违规引用都报红，删除探针后恢复；拦截发生在读取受限包之前', async () => {
  const root = await mkdtemp(join(tmpdir(), 'renderer-boundary-'))
  try {
    await mkdir(join(root, 'renderer'))
    await writeFile(join(root, 'renderer/index.js'), "export * from './probe.js'\n")
    for (const source of ["import '../engine/index.js'", "export * from '../server/index.js'", "import '../src/App.jsx'", "import 'tldraw'", "import '@tldraw/editor'", "import '@tldraw/assets'", "import 'node:fs'", "import 'fs'"]) {
      await writeFile(join(root, 'renderer/probe.js'), source)
      await assert.rejects(checkRendererBoundary({ root }), undefined, source)
    }
    await writeFile(join(root, 'renderer/geometry.js'), "export * from './probe.js'\n")
    for (const source of ["import 'react'", "import 'react-dom/client'", 'export const x = document.body', "export const x = globalThis['document']", 'export const x = new DOMRect()', "export const x = new globalThis['DOMPoint']()", 'export const x = new CanvasRenderingContext2D()']) {
      await writeFile(join(root, 'renderer/probe.js'), source)
      await assert.rejects(checkRendererBoundary({ root, geometry: true }), /几何/, source)
    }
    await writeFile(join(root, 'renderer/geometry.js'), "export * from './dom.jsx'\n")
    await writeFile(join(root, 'renderer/dom.jsx'), 'export const x = <div>{document.title}</div>')
    await assert.rejects(checkRendererBoundary({ root, geometry: true }), /几何/)
    await writeFile(join(root, 'renderer/geometry.js'), "export * from './probe.js'\n")
    await writeFile(join(root, 'renderer/probe.js'), 'export const clean = 1')
    await checkRendererBoundary({ root })
    await checkRendererBoundary({ root, geometry: true })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('仅认mediabunny已登记的禁用Node空模块，其他disabled路径仍越界',async()=>{
  const root=await mkdtemp(join(tmpdir(),'disabled-boundary-'))
  try{
    for(const directory of ['renderer','content-channel','node_modules/mediabunny'])await mkdir(join(root,directory),{recursive:true})
    await writeFile(join(root,'renderer/index.js'),"export * from '../content-channel/index.js'")
    await writeFile(join(root,'content-channel/index.js'),"export * from './film-video-frames.js'")
    await writeFile(join(root,'content-channel/film-video-frames.js'),"export * from 'mediabunny'")
    await writeFile(join(root,'node_modules/mediabunny/package.json'),JSON.stringify({name:'mediabunny',main:'index.js',browser:{'./other.js':false}}))
    await writeFile(join(root,'node_modules/mediabunny/index.js'),"import './other.js';export const sample=1")
    await writeFile(join(root,'node_modules/mediabunny/other.js'),'export const nodeAdapter=1')
    await assert.rejects(checkRendererBoundary({root}),/渲染依赖图越界：\(disabled\):node_modules\/mediabunny\/other\.js/)
  }finally{await rm(root,{recursive:true,force:true})}
})
