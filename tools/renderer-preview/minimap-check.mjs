import '../test-sandbox.mjs'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, join } from 'node:path'
import { startRendererPreview } from '../renderer-preview.mjs'

// Own #98 entry, never changes tools/perf shared files. Runtime must be already
// installed; all service/storage/profile paths are isolated by test-sandbox.
const root = resolve(import.meta.dirname, '../..'), output = join(root, '.scratch/minimap-check')
const executable = process.env.HICANVAS_TEST_ELECTRON
if (!executable) throw new Error('请用 HICANVAS_TEST_ELECTRON 指向本机已有 Electron。')
await access(executable, constants.X_OK); await mkdir(output, { recursive: true })
const profile = await mkdtemp(join(output, 'runtime-'))
let preview
try {
  preview = await startRendererPreview({ port: Number(process.env.HICANVAS_MINIMAP_PORT || 43396) })
  await (await fetch(`${preview.url}/__renderer_fixture?count=5000`)).json()
  const manifest = join(profile, 'manifest.json'), result = join(output, process.argv.includes('--performance') ? 'performance.json' : 'smoke.json')
  await writeFile(manifest, JSON.stringify({ url: preview.url, profile: join(profile, 'profile'), output, result, performance: process.argv.includes('--performance') }))
  const code = await new Promise((yes, no) => {
    const child = spawn(executable, [join(root, 'tools/renderer-preview/minimap-electron.mjs'), manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
    const timer = setTimeout(() => { child.kill('SIGKILL'); no(new Error('小地图验证超时')) }, 180000)
    child.once('error', error => { clearTimeout(timer); no(error) }); child.once('exit', code => { clearTimeout(timer); yes(code) })
  })
  if (code !== 0) throw new Error(`小地图验证失败：${await readFile(result, 'utf8')}`)
  console.log(`小地图结果：${result}`)
} finally { await preview?.close(); await rm(profile, { recursive: true, force: true }) }
