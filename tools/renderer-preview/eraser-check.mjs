import '../test-sandbox.mjs'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startInteractionPreview } from './service.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url)), output = join(root, '.scratch/eraser-smoke')
const executable = process.env.HICANVAS_TEST_ELECTRON
if (!executable) throw new Error('先设置 HICANVAS_TEST_ELECTRON，复用已安装的 Electron，不下载运行时。')
await access(executable, constants.X_OK); await mkdir(output, { recursive: true })
const run = await mkdtemp(join(output, 'run-'))
let preview
try {
  preview = await startInteractionPreview({ port: Number(process.env.HICANVAS_ERASER_PORT || 43390), dataDir: join(run, 'data'), watch: false })
  const manifest = join(run, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ url: preview.url, profile: join(run, 'profile'), output, result: join(output, 'result.json'), erasersOnly: true, eraserColorOnly: process.env.HICANVAS_ERASER_COLOR_ONLY === '1' }))
  const code = await new Promise((yes, no) => {
    const child = spawn(executable, [resolve(root, 'tools/renderer-preview/electron.mjs'), manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
    const timer = setTimeout(() => { child.kill('SIGKILL'); no(new Error('橡皮擦离屏验证超时。')) }, 120000)
    child.once('error', error => { clearTimeout(timer); no(error) }); child.once('exit', code => { clearTimeout(timer); yes(code) })
  })
  if (code !== 0) throw new Error('橡皮擦离屏验证失败，见 .scratch/eraser-smoke/result.json。')
  console.log(await readFile(join(output, 'result.json'), 'utf8'))
} finally { try { await preview?.close() } finally { await rm(run, { recursive: true, force: true }) } }
