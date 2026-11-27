import '../test-sandbox.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { channel } from 'node:diagnostics_channel'
import { setTimeout as delay } from 'node:timers/promises'
import { startInteractionPreview } from './service.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const red = [
  ['native-clipboard', 'clipboard.readText'], ['native-print', 'webContents.print'], ['native-dialog', 'dialog.showErrorBox'], ['native-network', 'node.fetch'],
  ...['page', 'frame'].flatMap(scope => ['clipboard', 'print', 'dialog', 'network', 'download'].map(name => [`${scope}-${name}`, { clipboard: 'browser.clipboard.readText', print: 'window.print', dialog: 'window.alert', network: 'network', download: 'download-path' }[name]])),
]
export async function runCanvasExportSmoke({ port = Number(process.env.HICANVAS_EXPORT_PORT || 43392) } = {}) {
  const output = join(root, '.scratch/export-smoke'), executable = process.env.HICANVAS_TEST_ELECTRON
  if (!executable) throw new Error('先设置HICANVAS_TEST_ELECTRON，复用已安装的Electron。')
  await access(executable, constants.X_OK); await mkdir(output, { recursive: true })
  const run = await mkdtemp(join(output, 'run-'))
  let preview, child, closed
  const abort = new AbortController()
  const interrupt = () => { abort.abort(new Error('输出检查已停止。')); child?.kill('SIGKILL') }
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
  async function fingerprint() {
    const hash = createHash('sha256')
    const files = ['renderer/index.js', 'renderer/bookmark.js', 'renderer/frame-title-measure.js', 'content-channel/capture.js', 'engine/index.js', 'engine/interaction/export.js', ...['export.js', 'export-bounds.js', 'export-scene.js', 'export-shapes.js', 'export-text.js', 'export-media.js', 'export-assets.js', 'export-raster.js'].map(name => `renderer/${name}`), ...['export-fixture.js', 'export-ui.js', 'export-probe.js', 'export-check.mjs', 'export-smoke.mjs', 'main.js', 'service.mjs'].map(name => `tools/renderer-preview/${name}`)]
    for (const file of files) hash.update(file).update(await readFile(join(root, file)))
    return hash.digest('hex')
  }
  const source = await fingerprint(), results = []
  const serviceNetwork = [], serviceOrigins = new Set()
  // Observe this synthetic host process as well as Chromium. Production
  // content-host policy is unchanged; these are test evidence, not a proxy.
  const observe = ({ request }) => {
    try {
      const url = request.origin ? new URL(request.path, String(request.origin)) : new URL(request.path, `${request.protocol || 'http:'}//${request.getHeader('host')}`)
      serviceNetwork.push({ source: 'service', url: url.href, external: !!(url.username || url.password) || !serviceOrigins.has(url.origin) })
    } catch (error) { serviceNetwork.push({ source: 'service', external: true, error: String(error) }) }
  }
  const channels = ['http.client.request.start', 'undici:request:create'].map(name => channel(name))
  for (const value of channels) value.subscribe(observe)
  try {
    abort.signal.throwIfAborted()
    preview = await startInteractionPreview({ port, dataDir: join(run, 'data'), watch: false })
    // This process serves content directly from synthetic storage; it never
    // needs to fetch another local service or a content instance over HTTP.
    serviceOrigins.add(preview.url)
    for (const [mode, expected] of [...red, ['green'], ['smoke']]) {
      abort.signal.throwIfAborted()
      assert.equal(await fingerprint(), source, '守卫证明与回归之间源码发生变化。')
      const manifest = join(run, `${mode}.json`), result = join(run, `${mode}-result.json`)
      await writeFile(manifest, JSON.stringify({ url: preview.url, mode, fingerprint: source, output, result, profile: join(run, `profile-${mode}`) }))
      const code = await new Promise((yes, no) => {
        child = spawn(executable, [resolve(root, 'tools/renderer-preview/export-smoke.mjs'), manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
        closed = new Promise(resolve => child.once('close', resolve))
        let timedOut = false
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 160000)
        child.once('error', error => { clearTimeout(timer); no(error) })
        child.once('close', value => { clearTimeout(timer); timedOut ? no(new Error(`输出原生检查超时：${mode}`)) : yes(value) })
      })
      abort.signal.throwIfAborted()
      const report = JSON.parse(await readFile(result, 'utf8'))
      report.serviceNetwork = [...serviceNetwork]
      // Preserve intentional red and unexpected failures before assertions and
      // profile cleanup. A failed pixel check must retain its actual RGBA.
      const evidenceFile = join(output, `${mode}-${basename(run)}.json`)
      await writeFile(evidenceFile, JSON.stringify(report, null, 2))
      assert.equal(serviceNetwork.filter(row => row.external).length, 0, '合成本机服务发出了外部请求。')
      assert.equal(report.mode, mode); assert.equal(report.fingerprint, source)
      if (expected) {
        assert.notEqual(code, 0); assert.equal(report.ok, false); assert.deepEqual(report.violations, [expected])
        if (mode === 'page-network') assert.ok(report.network.some(row => row.external && row.source === 'board' && !row.allowed), '父页外连拒绝须保留真实来源。')
      }
      else { assert.equal(code, 0, report.error); assert.equal(report.ok, true); assert.deepEqual(report.violations, []) }
      results.push({ mode, code, expected: expected || 'success', pid: report.pid, evidence: evidenceFile })
    }
    assert.equal(await fingerprint(), source)
    await writeFile(join(output, 'result.json'), JSON.stringify({ ok: true, fingerprint: source, results, serviceNetwork }, null, 2))
    console.log(`画布输出：14红/1绿守卫与原生下载、SVG/PNG像素、媒体、DPR检查通过：${output}`)
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM'); if (!await Promise.race([closed.then(() => true), delay(1000).then(() => false)])) child.kill('SIGKILL')
      }
      await closed
    } finally {
      try { await preview?.close() } finally {
        for (const value of channels) value.unsubscribe(observe)
        try {
          await writeFile(join(output, `service-network-${basename(run)}.json`), JSON.stringify(serviceNetwork, null, 2))
          assert.equal(serviceNetwork.filter(row => row.external).length, 0, '合成本机服务发出了外部请求。')
        } finally { await rm(run, { recursive: true, force: true }) }
      }
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCanvasExportSmoke()
