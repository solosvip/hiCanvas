import './test-sandbox.mjs'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runContentHostSmoke } from './content-host-smoke.mjs'
import { startRendererPreview } from './renderer-preview.mjs'
import { runCanvasExportSmoke } from './renderer-preview/export-check.mjs'
import { runFlattenSmoke } from './renderer-preview/flatten-check.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, '.scratch/renderer-smoke')
// Resolve an already installed runtime directly. The npm launcher may otherwise
// download Electron on first execution, which this verification must not do.
const electronDir = join(root, 'node_modules/electron')
const executable = process.env.HICANVAS_TEST_ELECTRON || join(electronDir, 'dist', (await readFile(join(electronDir, 'path.txt'), 'utf8')).trim())
await access(executable, constants.X_OK)
await mkdir(output, { recursive: true })
const runtime = await mkdtemp(join(output, 'runtime-'))
let preview, child, childClosed
try {
  await runContentHostSmoke()
  await runCanvasExportSmoke()
  await runFlattenSmoke()
  preview = await startRendererPreview({ geometryFixtures: true, watch: false })
  const manifest = join(runtime, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ url: preview.url, profile: join(runtime, 'profile'), output, result: join(output, 'result.json') }))
  const code = await new Promise((accept, reject) => {
    child = spawn(executable, [resolve(root, 'tools/renderer-preview/electron.mjs'), manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
    childClosed = new Promise(resolve => child.once('close', resolve))
    // Each merged gallery adds settled native captures (#139), and the full
    // geometry/color-response ABA checks add more (#104); a loaded machine pushed
    // the run past 120 s. Keep every assertion, allow the complete run to finish.
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 240000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); timedOut ? reject(new Error('离屏验证超过 240 秒。')) : accept(code) })
  })
  if (code !== 0) throw new Error(`离屏验证失败（${code}），详见 ${join(output, 'result.json')}。`)
  console.log(`结果、三档画板与两张图鉴截图：${output}`)
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await childClosed
  try { await preview?.close() } finally { await rm(runtime, { recursive: true, force: true }) }
}
