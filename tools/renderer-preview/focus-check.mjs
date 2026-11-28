import '../test-sandbox.mjs'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { startInteractionPreview } from './service.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = join(root, '.scratch/focus-smoke'), executable = process.env.HICANVAS_TEST_ELECTRON
if (!executable) throw new Error('先设置 HICANVAS_TEST_ELECTRON，复用已有 Electron。')
await access(executable, constants.X_OK); await mkdir(output, { recursive: true })
const run = await mkdtemp(join(output, 'run-')), resultFile = join(run, 'result.json')
await mkdir(join(run, 'profile'), { recursive: true })
const files = ['engine/interaction/keyboard-input.js', 'engine/interaction/index.js', 'engine/interaction/shortcuts.js', 'tools/renderer-preview/input.js', 'tools/renderer-preview/main.js', 'tools/renderer-preview/electron.mjs', 'tools/renderer-preview/native-suites.mjs', 'tools/renderer-preview/native-suite-runner.mjs', 'tools/renderer-preview/focus-fixture.js', 'tools/renderer-preview/focus-smoke.mjs', 'tools/renderer-preview/focus-check.mjs', 'tools/renderer-preview/keyboard-smoke.mjs', 'tools/renderer-preview/minimap-smoke.mjs']
const hash = createHash('sha256'), identities = {}
for (const file of files) { const bytes = await readFile(join(root, file)); identities[file] = createHash('sha256').update(bytes).digest('hex'); hash.update(file); hash.update(bytes) }
const sourceHash = hash.digest('hex')
// This bootstrap installs quiet fatal handlers before any application imports.
// A syntax/import failure must not fall back to Electron's native error dialog.
const bootstrap = join(run, 'boot.cjs')
await writeFile(bootstrap, `const fs=require('node:fs');let electron;let failed=false;
const fatal=error=>{if(failed)return;failed=true;const detail=String(error?.stack||error);try{fs.writeFileSync(${JSON.stringify(join(run, 'fatal.json'))},JSON.stringify({error:detail}))}catch{};process.stderr.write(detail+'\\n');if(electron)electron.app.exit(1);else process.exit(1)};
process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
electron=require('electron');const blocked=[];
const saveEffects=()=>fs.writeFileSync(${JSON.stringify(join(run, 'native-side-effects.json'))},JSON.stringify({blocked}));saveEffects();
const deny=(object,name)=>{if(typeof object?.[name]==='function')object[name]=()=>{blocked.push(name);saveEffects();throw new Error('Native side effect blocked: '+name)}};
for(const name of ['showErrorBox','showMessageBox','showMessageBoxSync','showOpenDialog','showOpenDialogSync','showSaveDialog','showSaveDialogSync','showCertificateTrustDialog'])deny(electron.dialog,name);
for(const name of Object.keys(electron.clipboard))deny(electron.clipboard,name);
for(const name of ['openExternal','openPath','showItemInFolder','trashItem'])deny(electron.shell,name);
for(const name of ['show','showInactive','print','printToPDF'])deny(electron.BrowserWindow.prototype,name);
electron.app.on('web-contents-created',(_event,contents)=>{for(const name of ['print','printToPDF'])deny(contents,name);contents.setWindowOpenHandler(()=>({action:'deny'}));contents.session.on('will-download',event=>event.preventDefault())});
process.on('exit',()=>{try{fs.writeFileSync(${JSON.stringify(join(run, 'native-side-effects.json'))},JSON.stringify({blocked}))}catch{}});
import(${JSON.stringify(new URL('./electron.mjs', import.meta.url).href)}).catch(fatal);
`)
let preview, child, completion, timeout, hardStop, expired = false, interrupted = null, failure = null
function stop(signal) {
  interrupted = signal
  if (child?.pid && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); hardStop ||= setTimeout(() => child.kill('SIGKILL'), 2000) }
}
const onInt = () => stop('SIGINT'), onTerm = () => stop('SIGTERM')
process.on('SIGINT', onInt); process.on('SIGTERM', onTerm)
try {
  preview = await startInteractionPreview({ port: Number(process.env.HICANVAS_FOCUS_PORT || 43390), dataDir: join(run, 'data'), watch: false })
  if (interrupted) throw new Error(`收到${interrupted}，停止启动。`)
  const manifest = join(run, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ url: preview.url, profile: join(run, 'profile'), output: run, result: resultFile, focusOnly: true, sourceHash, identities }, null, 2))
  if (interrupted) throw new Error(`收到${interrupted}，取消启动原生子进程。`)
  completion = new Promise((yes, no) => {
    child = spawn(executable, [bootstrap, manifest], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit' })
    child.once('error', no); child.once('exit', (code, signal) => yes({ code, signal }))
    timeout = setTimeout(() => { expired = true; stop('timeout') }, 600000)
  })
  const exit = await completion
  if (expired || interrupted || exit.code !== 0) throw new Error(`焦点原生检查失败、中断或超时：${JSON.stringify(exit)}；证据 ${run}`)
  const result = JSON.parse(await readFile(resultFile, 'utf8'))
  if (result.sourceHash !== sourceHash || !result.samples?.[0]?.focus?.assertions || !result.samples[0].focus.keyboard?.nativeImeEvents || !result.samples[0].focus.minimap?.documentUnchanged) throw new Error('焦点报告缺少当前源码身份、原样键盘或小地图断言。')
  const effects = JSON.parse(await readFile(join(run, 'native-side-effects.json'), 'utf8'))
  if (effects.blocked.length) throw new Error(`检查中出现了原生副作用：${effects.blocked.join(', ')}`)
  console.log(JSON.stringify({ run, ...result }, null, 2))
} catch (error) {
  failure = error
  console.error(error)
  throw error
} finally {
  clearTimeout(timeout); clearTimeout(hardStop)
  // Do not release the isolated service or remove its profile while a child
  // still owns them, including after startup errors, signals and timeouts.
  const cleanupErrors = []
  try {
    try { if (child?.pid && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await completion.catch(() => {}) } } catch (error) { cleanupErrors.push(error) }
    try { await preview?.close() } catch (error) { cleanupErrors.push(error) }
    for (const directory of ['profile', 'data']) {
      try { await rm(join(run, directory), { recursive: true, force: true }) } catch (error) { cleanupErrors.push(error) }
    }
  } finally {
    process.off('SIGINT', onInt); process.off('SIGTERM', onTerm)
  }
  if (cleanupErrors.length) {
    const error = new AggregateError(cleanupErrors, '焦点检查资源清理失败。')
    if (!failure) throw error
    console.error('清理失败，保留原检查错误：', error)
  }
}
