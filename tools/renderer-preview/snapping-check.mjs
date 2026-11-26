import '../test-sandbox.mjs'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startRendererPreview } from '../renderer-preview.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url)), output = join(root, '.scratch/snapping-smoke')
const executable = process.env.HICANVAS_TEST_ELECTRON
if (!executable) throw new Error('先设置 HICANVAS_TEST_ELECTRON，复用已有 Electron。')
await access(executable, constants.X_OK); await mkdir(output, { recursive: true })
const run = await mkdtemp(join(output, 'run-'))
let preview, child, childClosed
try {
  preview = await startRendererPreview({ port: Number(process.env.HICANVAS_SNAPPING_PORT || 43386) })
  const manifest = join(run, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ url: preview.url, profile: join(run, 'profile'), output, result: join(output, 'result.json'), snappingOnly: true }))
  const code = await new Promise((yes, no) => {
    child = spawn(executable, [resolve(root, 'tools/renderer-preview/electron.mjs'), manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
    childClosed = new Promise(resolve => child.once('close', resolve))
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 120000)
    child.once('error', error => { clearTimeout(timer); no(error) })
    child.once('close', code => { clearTimeout(timer); timedOut ? no(new Error('吸附离屏验证超时。')) : yes(code) })
  })
  if (code !== 0) throw new Error('吸附离屏验证失败，见 .scratch/snapping-smoke/result.json。')
  console.log(await readFile(join(output, 'result.json'), 'utf8'))
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await childClosed
  try { await preview?.close() } finally { await rm(run, { recursive: true, force: true }) }
}
