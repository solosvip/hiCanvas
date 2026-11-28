import '../test-sandbox.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, realpath, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startInteractionPreview } from './service.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url)), base = join(root, '.scratch/clip-guard-evidence')
const executable = process.env.HICANVAS_TEST_ELECTRON, baselinePath = process.env.HICANVAS_CLIP_BASELINE
if (!executable) throw new Error('先设置 HICANVAS_TEST_ELECTRON，复用已有 Electron。')
if (!baselinePath) throw new Error('先设置 HICANVAS_CLIP_BASELINE，指向修复前保存的第一方 clip-pixel-mask.js。')
const baselineFile = await realpath(resolve(root, baselinePath))
if (!baselineFile.startsWith(`${await realpath(base)}/`)) throw new Error('旧版副本只允许来自本工作区 .scratch/clip-guard-evidence/。')
await access(executable, constants.X_OK)
const baseline = await readFile(baselineFile, 'utf8'), hash = value => createHash('sha256').update(value).digest('hex')
const baselineHash = hash(baseline)
// First-party source at 880af4c, preserved before this fix. Pin the known red
// fixture so a replaced baseline cannot silently become a second green run.
assert.equal(baselineHash, '6507f1f6628b9e8c0d83bca1f707dfd45b5d6d7323b7f8840b19d4ed05efb3de', '旧版副本与施工前指纹不符。')
const sources = ['service.mjs', 'clip-visibility-check.mjs', 'clip-visibility-electron.mjs', 'clip-pixel-mask.js', 'clip-pixel-guard.mjs', 'clip-pixel-comparison.mjs', 'clip-pixel-regions.mjs', 'opaque-edge-probe.mjs', 'opaque-edge-candidates.js', 'opaque-edge-rules.mjs', 'embeds-smoke.mjs']
async function fingerprint() {
  const digest = createHash('sha256')
  for (const name of sources) digest.update(name).update(await readFile(join(root, 'tools/renderer-preview', name)))
  return digest.digest('hex')
}
await mkdir(base, { recursive: true })
const output = await mkdtemp(join(base, 'native-')), result = join(output, 'result.json'), sourceHash = await fingerprint()
const stop = new AbortController(), handlers = new Map()
let preview, child, closed, timedOut = false, report
const kill = signal => {
  if (!child?.pid) return
  try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  const handler = () => { stop.abort(new Error(`裁剪可见性检查收到 ${signal}。`)); kill('SIGKILL') }
  handlers.set(signal, handler); process.once(signal, handler)
}
try {
  stop.signal.throwIfAborted()
  preview = await startInteractionPreview({ port: Number(process.env.HICANVAS_CLIP_PORT || 43397), dataDir: join(output, 'data'), watch: false })
  stop.signal.throwIfAborted()
  const manifest = join(output, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ url: preview.url, profile: join(output, 'profile'), output, result, sourceHash, baselineHash, baseline }))
  // Cancellation may arrive while either startup or manifest I/O is awaited.
  stop.signal.throwIfAborted()
  child = spawn(executable, [join(root, 'tools/renderer-preview/clip-visibility-electron.mjs'), manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit', detached: true })
  closed = new Promise(resolve => child.once('close', resolve))
  const timer = setTimeout(() => { timedOut = true; kill('SIGKILL') }, 180000)
  let code
  try {
    code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
  } finally { clearTimeout(timer) }
  stop.signal.throwIfAborted()
  if (timedOut) throw new Error(`裁剪可见性检查超时，证据：${output}`)
  assert.equal(code, 0, `裁剪可见性原生检查失败，见 ${result}`)
  report = JSON.parse(await readFile(result, 'utf8'))
  assert.equal(report.pid, child.pid); assert.equal(report.sourceHash, sourceHash); assert.equal(report.baselineHash, baselineHash)
  assert.equal(await fingerprint(), sourceHash, '检查期间源码发生变化。')
} finally {
  kill('SIGKILL'); await closed
  try { await preview?.close() } finally {
    // Keep evidence/manifest; remove only this run's disposable synthetic data.
    for (const name of ['data', 'profile']) await rm(join(output, name), { recursive: true, force: true })
    for (const [signal, handler] of handlers) process.off(signal, handler)
  }
}
stop.signal.throwIfAborted()
console.log(JSON.stringify(report))
