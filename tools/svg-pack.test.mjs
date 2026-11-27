import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { svgAttacks } from './renderer-preview/svg-fixtures.js'

test('SVG准备和最终保存运行于专用桌面格式bundle，不借源码；实际五包都有原文许可', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url)), evidence = join(root, '.scratch/svg-observation')
  await mkdir(evidence, { recursive: true })
  const stage = await mkdtemp(join(evidence, 'bundle-'))
  t.after(() => rm(stage, { recursive: true, force: true }))
  const result = await build({ entryPoints: [join(root, 'server/canvas-media.mjs')], outfile: join(stage, 'media.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', metafile: true, logLevel: 'silent', banner: { js: "import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);" } })
  await cp(fileURLToPath(import.meta.resolve('unicode-properties/data.trie')), join(stage, 'data.trie'))
  const packages = [['@xmldom/xmldom', 'xmldom'], ['postcss', 'postcss'], ['nanoid', 'nanoid'], ['picocolors', 'picocolors'], ['source-map-js', 'source-map-js']], licenses = []
  for (const [name, file] of packages) {
    assert.ok(Object.keys(result.metafile.inputs).some(path => path.includes(`node_modules/${name}/`)), `${name}实际进入bundle`)
    const source = join(root, 'node_modules', name), pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    const license = await readFile(join(root, 'licenses', file + '.txt'), 'utf8')
    assert.equal(license, await readFile(join(source, 'LICENSE'), 'utf8'))
    await cp(join(root, 'licenses', file + '.txt'), join(stage, file + '.txt'))
    licenses.push({ name, version: pkg.version, license: pkg.license, bytes: Buffer.byteLength(license) })
  }
  const input = 'data:image/svg+xml;base64,' + Buffer.from(svgAttacks[0].source).toString('base64')
  const script = `
    import {registerHooks} from 'node:module';import {fileURLToPath} from 'node:url';
    import {mkdir,readFile,readdir} from 'node:fs/promises';
    registerHooks({resolve(specifier,context,next){const r=next(specifier,context);if(!r.url.startsWith('node:')&&!fileURLToPath(r.url).startsWith(${JSON.stringify(stage + '/')}))throw Error('借用了源码或node_modules:'+r.url);return r}});
    const {createCanvasMedia}=await import(${JSON.stringify(pathToFileURL(join(stage, 'media.mjs')).href)});
    const dir=${JSON.stringify(join(stage, 'assets'))};await mkdir(dir);
    const media=createCanvasMedia({assetsDir:async()=>dir});
    const prepared=await media.reference('synthetic',{purpose:'file-import-prepare',dataUrl:${JSON.stringify(input)}});
    const empty=(await readdir(dir)).length===0;
    const saved=await media.reference('synthetic',{purpose:'file-import',dataUrl:${JSON.stringify(input)},sanitized:true});
    const bytes=await readFile(saved.assetPath,'utf8');
    console.log(JSON.stringify({empty,mime:saved.mimeType,safe:!/<script|svg-test.invalid/.test(bytes),same:prepared.dataUrl==='data:image/svg+xml;base64,'+Buffer.from(bytes).toString('base64')}));
  `
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { timeout: 10000 })
  assert.deepEqual(JSON.parse(stdout), { empty: true, mime: 'image/svg+xml', safe: true, same: true })
  await writeFile(join(evidence, 'bundle-metafile.json'), JSON.stringify(result.metafile, null, 2))
  await writeFile(join(evidence, 'bundle-licenses.json'), JSON.stringify(licenses, null, 2))
})
