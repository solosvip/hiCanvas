import '../test-sandbox.mjs'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { startInteractionPreview } from './service.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url)), output = join(root, '.scratch/laser-smoke')
const executable = process.env.HICANVAS_TEST_ELECTRON
if (!executable) throw new Error('先设置 HICANVAS_TEST_ELECTRON，复用已安装的 Electron，不下载运行时。')
await access(executable, constants.X_OK); await mkdir(output, { recursive: true })
const files = ['engine/interaction/laser.js', 'engine/interaction/pointer-trail.js', 'engine/interaction/eraser.js', 'engine/interaction/index.js', 'engine/interaction/shortcuts.js', 'renderer/laser-overlay.js', 'renderer/trail-overlay.js', 'renderer/eraser-overlay.js', 'renderer/overlays.js', 'src/styles/tokens.css', 'tools/renderer-preview/main.js', 'tools/renderer-preview/electron.mjs', 'tools/renderer-preview/laser-fixture.js', 'tools/renderer-preview/laser-smoke.mjs', 'tools/renderer-preview/laser-check.mjs']
const hash = createHash('sha256')
for (const file of files) { hash.update(file); hash.update(await readFile(join(root, file))) }
const sourceHash = hash.digest('hex'), run = await mkdtemp(join(output, 'run-'))
let preview, child, completion, timeout, hardStop, expired = false, interrupted = null
const interrupt = signal => {
  interrupted = signal
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM'); hardStop ||= setTimeout(() => child.kill('SIGKILL'), 2000)
  }
}
const onInt = () => interrupt('SIGINT'), onTerm = () => interrupt('SIGTERM')
process.on('SIGINT', onInt); process.on('SIGTERM', onTerm)
try {
  preview = await startInteractionPreview({ port: Number(process.env.HICANVAS_LASER_PORT || 43390), dataDir: join(run, 'data'), watch: false })
  if (interrupted) throw new Error(`原生检查收到${interrupted}，停止启动。`)
  const manifest = join(run, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ url: preview.url, profile: join(run, 'profile'), output, result: join(output, 'result.json'), lasersOnly: true, sourceHash }))
  completion = new Promise((yes, no) => {
    child = spawn(executable, [resolve(root, 'tools/renderer-preview/electron.mjs'), manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
    child.once('error', no); child.once('exit', yes)
    timeout = setTimeout(() => { expired = true; child.kill('SIGTERM'); hardStop = setTimeout(() => child.kill('SIGKILL'), 2000) }, 180000)
  })
  const code = await completion
  if (expired || interrupted || code !== 0) throw new Error('激光笔离屏验证失败、中断或超时，见 .scratch/laser-smoke/result.json。')
  const result = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'))
  if (result.sourceHash !== sourceHash || !result.samples?.[0]?.laser?.assertions) throw new Error('原生报告缺少当前源码身份或有效断言。')
  console.log(JSON.stringify(result, null, 2))
} finally {
  clearTimeout(timeout); clearTimeout(hardStop)
  // Wait for our Electron to exit before removing its profile or stopping the
  // isolated host. A timeout must not leave a child using a released port.
  if (child?.pid && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await completion.catch(() => {}) }
  try { await preview?.close() } finally {
    try { await rm(run, { recursive: true, force: true }) } finally { process.off('SIGINT', onInt); process.off('SIGTERM', onTerm) }
  }
}
