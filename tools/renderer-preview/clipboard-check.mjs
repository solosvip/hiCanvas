import '../test-sandbox.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { startInteractionPreview } from './service.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url)), output = join(root, '.scratch/clipboard-smoke')
const executable = process.env.HICANVAS_TEST_ELECTRON
if (!executable) throw new Error('先设置HICANVAS_TEST_ELECTRON，复用已安装的Electron。')
await access(executable, constants.X_OK); await mkdir(output, { recursive: true })
const run = await mkdtemp(join(output, 'run-'))
async function sourceFingerprint() {
  const hash = createHash('sha256')
  for (const path of ['engine/index.js', 'engine/interaction/index.js', 'engine/interaction/clipboard.js', 'engine/clipboard/external-content.js', 'engine/clipboard/placement.js', 'tools/renderer-preview/main.js', ...['clipboard.js', 'clipboard-check.mjs', 'clipboard-smoke.mjs', 'clipboard-fixture.js', 'clipboard-external.js', 'clipboard-html.js', 'clipboard-excalidraw.js', 'external-clipboard-probe.js'].map(name => `tools/renderer-preview/${name}`)]) hash.update(path).update(await readFile(join(root, path)))
  return hash.digest('hex')
}
const fingerprint = await sourceFingerprint()
let preview, child, childClosed, closing
const stop = new AbortController(), assertRunning = () => stop.signal.throwIfAborted()
async function cleanup() {
  if (!closing) closing = (async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      if (!await Promise.race([childClosed.then(() => true), delay(1000).then(() => false)])) child.kill('SIGKILL')
    }
    await childClosed
    try { await preview?.close() } finally { await rm(run, { recursive: true, force: true }) }
  })()
  return closing
}
// Do not clean up concurrently with startup: an awaited write could otherwise
// finish and spawn a new child after cleanup had already checked the old one.
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  stop.abort(new Error(`剪贴板检查收到 ${signal}，停止启动后续进程。`))
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
})
try {
  assertRunning()
  const dataDir = join(run, 'data')
  preview = await startInteractionPreview({ port: Number(process.env.HICANVAS_CLIPBOARD_PORT || 43396), dataDir, watch: false })
  assertRunning()
  const { createConversations } = await import('../../server/conversations.mjs')
  const workspace = createConversations(join(dataDir, 'canvas'))
  const other = await workspace.open({ createNew: true, title: '未由预览建立的合成画板' }), before = await workspace.read(other.id)
  const directory = join(dataDir, 'canvas', 'conversations'), names = await readdir(directory)
  const denied = []
  for (const id of [other.id, '11111111-1111-4111-8111-111111111111']) for (const action of ['copy', 'paste']) {
    const response = await fetch(`${preview.url}/api/canvas/clipboard/${action}?conversation=${id}`, { method: 'POST', signal: stop.signal, headers: { 'x-hicanvas-client': '1', 'content-type': 'application/json', 'x-hicanvas-actor': 'smoke' }, body: JSON.stringify({ expectedRevision: before.revision, ids: [], commands: [] }) })
    assert.equal(response.status, 404)
    denied.push({ id, action, status: response.status })
  }
  assert.deepEqual(await workspace.read(other.id), before)
  assert.deepEqual(await readdir(directory), names)
  await writeFile(join(output, 'host-denials.json'), JSON.stringify({ denied, unchanged: true }, null, 2))
  for (const mode of ['main-red', 'browser-red', 'frame-red', 'smoke']) {
    assertRunning()
    assert.equal(await sourceFingerprint(), fingerprint, '平台证明和回归之间源码发生了变化。')
    const manifest = join(run, `${mode}.json`), result = join(run, `${mode}-result.json`)
    await writeFile(manifest, JSON.stringify({ url: preview.url, profile: join(run, mode), output, result, mode, fingerprint }))
    assertRunning()
    let childPid
    const code = await new Promise((yes, no) => {
      child = spawn(executable, [resolve(root, 'tools/renderer-preview/clipboard-smoke.mjs'), manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
      childPid = child.pid
      childClosed = new Promise(resolve => child.once('close', resolve))
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 120000)
      child.once('error', error => { clearTimeout(timer); no(error) })
      child.once('close', value => { clearTimeout(timer); timedOut ? no(new Error('剪贴板原生验证超时。')) : yes(value) })
    })
    assertRunning()
    const report = JSON.parse(await readFile(result, 'utf8'))
    await writeFile(join(output, `${mode}.json`), JSON.stringify(report, null, 2))
    assert.equal(report.pid, childPid); assert.equal(report.mode, mode)
    assert.equal(report.fingerprint, fingerprint)
    if (mode === 'smoke') { assert.equal(code, 0); assert.equal(report.ok, true); assert.equal(report.violations.length, 0) }
    else {
      assert.notEqual(code, 0); assert.equal(report.ok, false)
      assert.deepEqual(report.violations, [{ 'main-red': 'electron.clipboard.readText', 'browser-red': 'browser.clipboard', 'frame-red': 'browser.execCommand' }[mode]])
    }
  }
  assert.equal(await sourceFingerprint(), fingerprint, '验证结束时源码指纹变化。')
  assertRunning()
  console.log('剪贴板：三红一绿边界证明、宿主拒绝守卫及合成事件原生回归通过。')
} finally { await cleanup() }
