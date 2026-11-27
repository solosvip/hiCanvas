import '../test-sandbox.mjs'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startInteractionPreview } from './service.mjs'
import { rasterFiles, animatedImage } from './image-fixtures.js'
import { base64 as webm } from './video-data-grid-webm.js'
import { svgFiles, svg } from './svg-fixtures.js'

const root = fileURLToPath(new URL('../../', import.meta.url)), output = resolve(root, '.scratch/image-check')
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('用法：node tools/renderer-preview/image-check.mjs --port 43397')
await mkdir(output, { recursive: true })
const executable = process.env.HICANVAS_TEST_ELECTRON || join(root, 'node_modules/electron/dist', (await readFile(join(root, 'node_modules/electron/path.txt'), 'utf8')).trim())
await access(executable)
const runtime = await mkdtemp(join(output, 'runtime-'))
let preview, child, closed
let interrupted = false
const interrupt = () => { interrupted = true; child?.kill('SIGKILL') }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupt)
try {
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'running', startedAt: new Date().toISOString() }))
  const files = {}
  for (const [key, file] of Object.entries({ ...rasterFiles, gif: { name: 'animated.gif', base64: animatedImage.split(',')[1] } })) {
    files[key] = join(runtime, file.name); await writeFile(files[key], Buffer.from(file.base64, 'base64'))
  }
  files.webm = join(runtime, 'synthetic.webm'); await writeFile(files.webm, Buffer.from(webm, 'base64'))
  for (const [key, file] of Object.entries(svgFiles)) { files[key] = join(runtime, file.name); await writeFile(files[key], file.source) }
  for (const [key, name, bytes] of [['bad', 'broken.png', 'broken image'], ['text', 'unsupported.txt', 'synthetic text']]) {
    files[key] = join(runtime, name); await writeFile(files[key], bytes)
  }
  preview = await startInteractionPreview({ port: args.length ? Number(args[1]) : 0, dataDir: join(runtime, 'data'), watch: false })
  const board = await (await fetch(preview.url + '/__renderer_fixture?gallery=image-import')).json()
  const assets = join(runtime, 'data/canvas/conversations', board.conversationId, 'assets')
  await mkdir(assets, { recursive: true })
  await writeFile(join(assets, 'svg-positive-pixel.png'), Buffer.from(rasterFiles.png.base64, 'base64'))
  await writeFile(join(assets, 'svg-positive-control.svg'), svg(`<rect width="320" height="180" fill="red"/><script><![CDATA[console.log('HICANVAS_SVG_EXEC');fetch('https://svg-test.invalid/control')]]></script><image href="https://svg-test.invalid/control-image"/><image href="/c/${board.conversationId}/assets/svg-positive-pixel.png"/>`))
  const svgSecurity = { positive: `${preview.url}/c/${board.conversationId}/assets/svg-positive-control.svg` }
  if (interrupted) throw new Error('图片检查已取消。')
  const manifest = join(runtime, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ url: preview.url, profile: join(runtime, 'profile'), output, result: join(output, 'result.json'), imagesOnly: true, imageFiles: files, svgSecurity }))
  if (interrupted) throw new Error('图片检查已取消。')
  await new Promise((yes, no) => {
    child = spawn(executable, [join(root, 'tools/renderer-preview/electron.mjs'), manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
    closed = new Promise(resolve => child.once('close', resolve))
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000)
    child.once('error', no); child.once('close', code => { clearTimeout(timer); code === 0 ? yes() : no(new Error(`图片原生回归失败：${code}；${output}/result.json`)) })
  })
  console.log(`图片原生回归通过：${output}`)
} finally {
  for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, interrupt)
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await closed
  try { await preview?.close() } finally { await rm(runtime, { recursive: true, force: true }) }
}
