import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { withFileLock } from '../server/file-lock.mjs'
import { loadConnection, connectionEnv, localBaseUrl, workspaceIdentity, canvasDeepLink } from './connection.mjs'
const exec = promisify(execFile)

export async function openBrowser(url) {
  if (process.platform === 'darwin') {
    const app = resolve(process.env.HICANVAS_DESKTOP_APP || '/Applications/hiCanvas.app')
    const connection = loadConnection()
    if (existsSync(app)) await exec('open', ['-g', '-a', app, canvasDeepLink(url, workspaceIdentity(connection.canvasDir))])
    else await exec('open', ['-g', url])
  }
  else if (process.platform === 'win32') await exec('rundll32', ['url.dll,FileProtocolHandler', url])
  else await exec('xdg-open', [url])
}
export async function ensureService(baseUrl, options = {}) {
  const base = new URL(localBaseUrl(baseUrl))
  const connection = { ...loadConnection(), ...options, baseUrl: base.origin }
  const root = connection.canvasDir
  const identity = workspaceIdentity(root)
  async function running() {
    let response
    try { response = await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(1000) }) }
    catch { return false }
    let health
    try { health = await response.json() } catch { throw new Error('端口已被旧版画板或其他程序占用；请先停止旧服务，再重新连接 MCP。') }
    if (health.name !== 'hiCanvas' || health.protocol !== 2 || health.workspace !== identity) throw new Error('端口对应其他服务或资料目录，未连接也未停止该服务。请核对 HICANVAS_URL 和资料目录。')
    if (health.canvasMode !== 'single') throw new Error('旧版画板服务仍在运行。请先保存作品并停止旧服务，再重新打开 hiCanvas 或连接 MCP。')
    if (health.settingsWorkspace && health.settingsWorkspace !== workspaceIdentity(connection.settingsDir)) throw new Error('服务使用其他模型设置目录，请核对 HICANVAS_SETTINGS_DIR。')
    return true
  }
  if (await running()) return
  const appRoot = options.appRoot || process.env.HICANVAS_APP_ROOT || fileURLToPath(new URL('../', import.meta.url))
  if (!existsSync(join(appRoot, 'dist', 'index.html'))) throw new Error('hiCanvas 尚未构建，请先在项目目录运行 npm run build。')
  await withFileLock(join(root, 'conversations', 'service-start.lock'), async () => {
    if (await running()) return
    const entry = existsSync(join(appRoot, 'runtime', 'service.mjs')) ? join(appRoot, 'runtime', 'service.mjs') : join(appRoot, 'bin', 'hicanvas-service.mjs')
    const child = spawn(process.execPath, [entry], { cwd: appRoot.endsWith('.asar') ? dirname(appRoot) : appRoot, env: { ...process.env, ...connectionEnv(connection), HICANVAS_APP_ROOT: appRoot, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }, detached: true, stdio: 'ignore' })
    let failed = null
    child.on('error', error => { failed = error })
    child.on('exit', code => { failed = new Error(`服务启动退出：${code}`) })
    child.unref()
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if (await running()) return
      if (failed) throw failed
      await delay(100)
    }
    throw new Error('本机画板启动超时，请运行 npm start 查看原因。')
  })
}
