import '../test-sandbox.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { startInteractionPreview } from './service.mjs'

// Filesystem and process creation are external boundaries. Keep cancellation
// adjacent to launch so no awaited preparation can reopen a cancelled run.
export async function launchSlidesBrowser({ manifest, data, signal, writeManifest = writeFile, launch }) {
  signal.throwIfAborted()
  await writeManifest(manifest, data)
  signal.throwIfAborted()
  return launch()
}

async function run() {
  const root = fileURLToPath(new URL('../../', import.meta.url)), output = join(root, '.scratch/slides-native')
  const executable = process.env.HICANVAS_TEST_ELECTRON, port = Number(process.env.HICANVAS_SLIDES_PORT)
  if (!executable) throw new Error('先指定已有 HICANVAS_TEST_ELECTRON。')
  if (!Number.isInteger(port) || port < 43300 || port > 65535 || port === 43398) throw new Error('先登记白板并指定专用 HICANVAS_SLIDES_PORT，避开43398。')
  await access(executable, constants.X_OK)
  await mkdir(output, { recursive: true })
  const run = await mkdtemp(join(output, 'run-')), result = join(run, 'result.json')
  const paths = ['engine/slides-layout.js', 'engine/slides-consistency.js', 'engine/execute.js', 'engine/index.js', 'engine/clipboard/placement.js', 'engine/interaction/frame-interaction.js', 'engine/media-placement.js', 'server/routes.mjs', ...['slides-check.mjs', 'slides-smoke.mjs', 'slides-fixture.js', 'main.js', 'service.mjs', 'electron.mjs', 'transport.js'].map(name => `tools/renderer-preview/${name}`)]
  async function fingerprint() { const hash = createHash('sha256'); for (const path of paths) hash.update(path).update(await readFile(join(root, path))); return hash.digest('hex') }
  const sourceHash = await fingerprint()
  let preview, child, closed, interrupted = false
  const cancellation = new AbortController()
  function kill() { if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } } }
  const interrupt = () => { interrupted = true; cancellation.abort(new Error('Slides 原生检查已中断。')); kill() }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, interrupt)
  try {
    preview = await startInteractionPreview({ port, dataDir: join(run, 'data'), watch: false })
    if (interrupted) throw new Error('Slides 原生检查已中断。')
    const manifest = join(run, 'manifest.json')
    const code = await launchSlidesBrowser({ manifest, data: JSON.stringify({ url: preview.url, profile: join(run, 'profile'), output, result, slidesOnly: true, sourceHash }), signal: cancellation.signal, launch: () => new Promise((resolve, reject) => {
      child = spawn(executable, [join(root, 'tools/renderer-preview/electron.mjs'), manifest], { cwd: root, detached: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
      closed = new Promise(resolve => child.once('close', resolve))
      let timeout = false
      const timer = setTimeout(() => { timeout = true; kill() }, 180000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', code => { clearTimeout(timer); timeout ? reject(new Error('Slides 原生检查超时。')) : resolve(code) })
    }) })
    const report = JSON.parse(await readFile(result, 'utf8'))
    await writeFile(join(output, 'result.json'), JSON.stringify({ exitCode: code, ...report }, null, 2))
    assert.equal(code, 0, 'Slides 原生失败，见 .scratch/slides-native/result.json')
    assert.equal(report.sourceHash, sourceHash)
    assert.deepEqual(report.errors, [])
    assert.deepEqual(report.blocked, [])
    assert.equal(await fingerprint(), sourceHash, '原生检查期间源码发生变化。')
    if (interrupted) throw new Error('Slides 原生检查已中断。')
    console.log('Slides 原生拖入/出/跨套/排序/增删/整套复制/锁/父链、保存重载与历史通过：' + output)
  } finally {
    kill(); await closed
    try { await preview?.close() } finally {
      await rm(run, { recursive: true, force: true })
      for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupt)
      if (interrupted) process.exitCode = 130
    }
  }

}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run()
