import '../test-sandbox.mjs'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { startInteractionPreview } from './service.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url)), base = join(root, '.scratch/record-conflicts-smoke')
const executable = process.env.HICANVAS_TEST_ELECTRON
if (!executable) throw new Error('先设置 HICANVAS_TEST_ELECTRON，复用现有 Electron。')
await access(executable, constants.X_OK); await mkdir(base, { recursive: true })
const output = await mkdtemp(join(base, 'run-')), result = join(output, 'result.json')
async function sourceFingerprint() {
  const hash = createHash('sha256')
  const files = ['engine/record-basis.js', 'engine/record-dependencies.js', 'engine/runtime/index.js', 'engine/index.js',
    'engine/interaction/embeds.js', 'engine/interaction/image-alt.js', 'engine/interaction/shape-links.js', 'server/conversations.mjs', 'server/routes.mjs',
    ...['record-conflicts-check.mjs', 'record-conflicts-smoke.mjs', 'native-suites.mjs', 'electron.mjs', 'shape-links-smoke.mjs', 'embeds-smoke.mjs',
      'main.js', 'input.js', 'image-ui.js', 'shape-links-ui.js', 'embeds-ui.js', 'image-fixtures.js', 'external-samples.js', 'transport.js', 'service.mjs'].map(name => `tools/renderer-preview/${name}`)]
  for (const file of files) hash.update(file).update(await readFile(join(root, file)))
  return hash.digest('hex')
}
const fingerprint = await sourceFingerprint(), stop = new AbortController()
let preview, child, childClosed, closing, report
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
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  stop.abort(new Error(`记录冲突检查收到 ${signal}，停止后续启动。`))
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
})
try {
  stop.signal.throwIfAborted()
  preview = await startInteractionPreview({ port: Number(process.env.HICANVAS_RECORD_CONFLICTS_PORT || 43390), dataDir: join(output, 'data'), watch: false })
  stop.signal.throwIfAborted()
  const manifest = join(output, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ url: preview.url, profile: join(output, 'profile'), output, result, fingerprint, recordConflictsOnly: true }))
  let childPid
  const code = await new Promise((yes, no) => {
    stop.signal.throwIfAborted()
    child = spawn(executable, [join(root, 'tools/renderer-preview/electron.mjs'), manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
    childPid = child.pid; childClosed = new Promise(resolve => child.once('close', resolve))
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 180000)
    child.once('error', error => { clearTimeout(timer); no(error) })
    child.once('close', code => { clearTimeout(timer); timedOut ? no(new Error('记录冲突原生检查超时。')) : yes(code) })
  })
  stop.signal.throwIfAborted()
  report = JSON.parse(await readFile(result, 'utf8'))
  assert.equal(code, 0, `记录冲突专项失败，见 ${result}：${report.error || ''}`)
  assert.equal(report.pid, childPid); assert.equal(report.fingerprint, fingerprint)
  assert.equal(await sourceFingerprint(), fingerprint, '原生检查期间源码发生变化。')
  assert.deepEqual(report.errors, []); assert.deepEqual(report.blocked, [])
  assert.equal(report.samples.length, 1)
  assert.equal(report.samples[0].recordConflicts.samples.length, 6)
  assert.deepEqual(report.samples[0].recordConflicts.native, [])
} finally { await cleanup() }
stop.signal.throwIfAborted()
console.log(JSON.stringify({ output, ...report }))
