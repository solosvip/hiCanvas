import '../test-sandbox.mjs'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { startInteractionPreview } from './service.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url)), base = join(root, '.scratch/embeds-smoke')
const executable = process.env.HICANVAS_TEST_ELECTRON
if (!executable) throw new Error('先设置 HICANVAS_TEST_ELECTRON，复用现有 Electron。')
await access(executable, constants.X_OK); await mkdir(base, { recursive: true })
const output = await mkdtemp(join(base, 'run-')), result = join(output, 'result.json')
async function sourceFingerprint() {
  const hash = createHash('sha256')
  for (const path of ['model/http-url.js', 'model/embed-services.js', 'engine/embeds.js', 'engine/commands/embeds.js', 'engine/interaction/embeds.js', 'engine/interaction/index.js', 'renderer/embed-content.js', ...['main.js', 'clipboard.js', 'clipboard-external.js', 'clipboard-url.js', 'embeds-ui.js', 'embeds-smoke.mjs', 'embeds-check.mjs', 'electron.mjs'].map(name => `tools/renderer-preview/${name}`)]) hash.update(path).update(await readFile(join(root, path)))
  return hash.digest('hex')
}
const fingerprint = await sourceFingerprint(), stop = new AbortController()
let preview, child, childClosed, closing, report
const assertRunning = () => stop.signal.throwIfAborted()
async function cleanup() {
  if (!closing) closing = (async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      if (!await Promise.race([childClosed.then(() => true), delay(1000).then(() => false)])) child.kill('SIGKILL')
    }
    await childClosed
    try { await preview?.close() }
    finally { for (const name of ['data', 'profile']) await rm(join(output, name), { recursive: true, force: true }) }
  })()
  return closing
}
// A cancellation marks startup first. Cleanup then waits for this run's child
// before closing its service or removing files the child could still be using.
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  stop.abort(new Error(`网址嵌入检查收到 ${signal}，停止后续启动。`))
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
})
try {
  assertRunning()
  preview = await startInteractionPreview({ port: Number(process.env.HICANVAS_EMBED_PORT || 43396), dataDir: join(output, 'data'), watch: false })
  assertRunning()
  const manifest = join(output, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ url: preview.url, profile: join(output, 'profile'), output, result, fingerprint, embedsOnly: true }))
  assertRunning()
  let childPid
  const code = await new Promise((yes, no) => {
    child = spawn(executable, [resolve(root, 'tools/renderer-preview/electron.mjs'), manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
    childPid = child.pid; childClosed = new Promise(resolve => child.once('close', resolve))
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 120000)
    child.once('error', error => { clearTimeout(timer); no(error) })
    child.once('close', code => { clearTimeout(timer); timedOut ? no(new Error('网址嵌入原生检查超时。')) : yes(code) })
  })
  assertRunning()
  if (code !== 0) throw new Error(`网址嵌入原生检查失败，见 ${result}。`)
  report = JSON.parse(await readFile(result, 'utf8'))
  assert.equal(report.pid, childPid); assert.equal(report.fingerprint, fingerprint)
  assert.equal(await sourceFingerprint(), fingerprint, '原生检查期间源码发生变化。')
} finally { await cleanup() }
// Cleanup also awaits I/O. A cancellation received after child close must not
// print a successful receipt or leave this entry with a successful exit code.
assertRunning()
console.log(JSON.stringify(report))
