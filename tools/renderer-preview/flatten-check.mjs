import '../test-sandbox.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { channel } from 'node:diagnostics_channel'
import { setTimeout as delay } from 'node:timers/promises'
import { startInteractionPreview } from './service.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
export async function runFlattenSmoke({ port = Number(process.env.HICANVAS_FLATTEN_PORT || 43392) } = {}) {
  const output = join(root, '.scratch/flatten-smoke'), executable = process.env.HICANVAS_TEST_ELECTRON
  if (!executable) throw new Error('先设置HICANVAS_TEST_ELECTRON，复用已安装的Electron。')
  await access(executable, constants.X_OK); await mkdir(output, { recursive: true })
  const run = await mkdtemp(join(output, 'run-')), network = [], origins = new Set()
  let preview, child, closed
  const controller = new AbortController(), interrupt = () => { controller.abort(new Error('扁平化原生检查已停止。')); child?.kill('SIGKILL') }
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
  async function fingerprint() {
    const hash = createHash('sha256')
    async function visit(directory) {
      for (const entry of (await readdir(join(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = `${directory}/${entry.name}`
        if (entry.isDirectory()) await visit(path)
        else if (/\.(?:js|mjs|css|json)$/.test(path)) hash.update(path).update(await readFile(join(root, path)))
      }
    }
    for (const directory of ['engine', 'renderer', 'model', 'server', 'content-channel', 'tools/renderer-preview']) await visit(directory)
    return hash.digest('hex')
  }
  const source = await fingerprint()
  const observe = ({ request }) => {
    try { const url = request.origin ? new URL(request.path, String(request.origin)) : new URL(request.path, `${request.protocol || 'http:'}//${request.getHeader('host')}`); network.push({ url: url.href, external: !origins.has(url.origin) }) }
    catch (error) { network.push({ external: true, error: String(error) }) }
  }
  const channels = ['http.client.request.start', 'undici:request:create'].map(name => channel(name)); for (const value of channels) value.subscribe(observe)
  try {
    controller.signal.throwIfAborted()
    preview = await startInteractionPreview({ port, dataDir: join(run, 'data'), watch: false }); controller.signal.throwIfAborted(); origins.add(preview.url)
    const health = await (await fetch(preview.url + '/api/health')).json(), contentPort = health.contentHost?.port
    if (contentPort) origins.add(`http://127.0.0.1:${contentPort}`)
    controller.signal.throwIfAborted()
    const manifest = join(run, 'manifest.json'), result = join(output, 'result.json')
    await writeFile(manifest, JSON.stringify({ url: preview.url, flattenOnly: true, contentPort, output, result, profile: join(run, 'profile'), sourceHash: source }))
    assert.equal(await fingerprint(), source)
    controller.signal.throwIfAborted()
    const code = await new Promise((yes, no) => {
      controller.signal.throwIfAborted()
      child = spawn(executable, [join(root, 'tools/renderer-preview/electron.mjs'), '--host-resolver-rules=MAP *.localhost 127.0.0.1, MAP localhost 127.0.0.1', manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
      closed = new Promise(resolve => child.once('close', resolve))
      const timer = setTimeout(() => { child.kill('SIGKILL'); no(new Error('扁平化原生检查超过240秒。')) }, 240000)
      child.once('error', error => { clearTimeout(timer); no(error) }); child.once('close', value => { clearTimeout(timer); yes(value) })
    })
    assert.equal(code, 0, `扁平化专项失败，详见${result}`)
    const report = JSON.parse(await readFile(result, 'utf8'))
    assert.equal(report.sourceHash, source); assert.deepEqual(report.errors, []); assert.deepEqual(report.blocked, [])
    assert.equal(report.samples[0].flatten.proof.length, 17)
    assert.ok(report.samples[0].flatten.samples.length >= 5)
    assert.equal(network.filter(row => row.external).length, 0, '合成服务出现外部请求。')
    assert.equal(await fingerprint(), source)
    await writeFile(join(output, 'service-network.json'), JSON.stringify(network, null, 2))
    console.log(`扁平化：17红/绿守卫、原生选择/Shift+F、上传替换/撤销/重做及实际像素通过：${output}`)
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    try { if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); if (!await Promise.race([closed.then(() => true), delay(1000).then(() => false)])) child.kill('SIGKILL') }; await closed }
    finally { try { await preview?.close() } finally { for (const value of channels) value.unsubscribe(observe); await writeFile(join(output, 'service-network.json'), JSON.stringify(network, null, 2)); await rm(run, { recursive: true, force: true }) } }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runFlattenSmoke()
