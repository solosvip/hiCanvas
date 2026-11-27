import '../test-sandbox.mjs'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startRendererPreview } from '../renderer-preview.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url)), output = join(root, '.scratch/note-smoke')
const executable = process.env.HICANVAS_TEST_ELECTRON
if (!executable) throw new Error('先设置 HICANVAS_TEST_ELECTRON，复用已有 Electron。')
await access(executable, constants.X_OK); await mkdir(output, { recursive: true })
const run = await mkdtemp(join(output, 'run-'))
let preview
try {
  preview = await startRendererPreview({ port: Number(process.env.HICANVAS_NOTE_PORT || 43386), watch: false })
  const manifest = join(run, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ url: preview.url, profile: join(run, 'profile'), output, result: join(output, 'result.json'), notesOnly: true }))
  const code = await new Promise((yes, no) => {
    const child = spawn(executable, [resolve(root, 'tools/renderer-preview/electron.mjs'), manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
    const timer = setTimeout(() => { child.kill('SIGKILL'); no(new Error('便签离屏验证超时。')) }, 120000)
    child.once('error', error => { clearTimeout(timer); no(error) }); child.once('exit', code => { clearTimeout(timer); yes(code) })
  })
  if (code !== 0) throw new Error('便签离屏验证失败，见 .scratch/note-smoke/result.json。')
  console.log(await readFile(join(output, 'result.json'), 'utf8'))
} finally { try { await preview?.close() } finally { await rm(run, { recursive: true, force: true }) } }
