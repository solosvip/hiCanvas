import '../test-sandbox.mjs'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startInteractionPreview } from './service.mjs'
import { base64 as mp4 } from './video-data-grid-mp4.js'
import { base64 as webm } from './video-data-grid-webm.js'
import { base64 as portrait } from './video-data-portrait-mp4.js'

const root = fileURLToPath(new URL('../../', import.meta.url)), output = resolve(root, '.scratch/video-check')
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('用法：node tools/renderer-preview/video-check.mjs --port 43397')
const port = args.length ? Number(args[1]) : 0
await mkdir(output, { recursive: true })
const runtime = await mkdtemp(join(output, 'runtime-'))
const executable = process.env.HICANVAS_TEST_ELECTRON || join(root, 'node_modules/electron/dist', (await readFile(join(root, 'node_modules/electron/path.txt'), 'utf8')).trim())
await access(executable)
let preview, child, closed
try {
  const files = {}
  for (const [key, bytes, ext] of [['mp4', Buffer.from(mp4, 'base64'), 'mp4'], ['webm', Buffer.from(webm, 'base64'), 'webm'], ['portrait', Buffer.from(portrait, 'base64'), 'mp4'], ['bad', Buffer.from('broken video'), 'mp4']]) {
    files[key] = join(runtime, `${key}.${ext}`); await writeFile(files[key], bytes)
  }
  // A QuickTime-branded ISO media fixture with the same locally encoded frames.
  const mov = Buffer.from(mp4, 'base64'); mov.write('qt  ', 8, 'ascii')
  files.mov = join(runtime, 'grid.mov'); await writeFile(files.mov, mov)
  if (process.env.HICANVAS_VIDEO_SEEK_LARGE) {
    const { scratchPath } = await import('../perf/config.mjs')
    files.large = await scratchPath(process.env.HICANVAS_VIDEO_SEEK_LARGE)
  }
  preview = await startInteractionPreview({ port, dataDir: join(runtime, 'data'), watch: false })
  const manifest = join(runtime, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ url: preview.url, profile: join(runtime, 'profile'), output, result: join(output, 'result.json'), videosOnly: true, videoFiles: files }))
  await new Promise((yes, no) => {
    child = spawn(executable, [join(root, 'tools/renderer-preview/electron.mjs'), manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
    closed = new Promise(resolve => child.once('close', resolve))
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000)
    child.once('error', no); child.once('close', code => { clearTimeout(timer); code === 0 ? yes() : no(new Error(`视频原生回归失败：${code}；${output}/result.json`)) })
  })
  console.log(`视频原生回归通过：${output}`)
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await closed
  try { await preview?.close() } finally { await rm(runtime, { recursive: true, force: true }) }
}
