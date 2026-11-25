import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { withFileLock } from '../server/file-lock.mjs'
const exec = promisify(execFile)

export async function openBrowser(url) {
  if (process.platform === 'darwin') await exec('open', ['-g', url])
  else if (process.platform === 'win32') await exec('rundll32', ['url.dll,FileProtocolHandler', url])
  else await exec('xdg-open', [url])
}
export async function ensureService(baseUrl) {
  const base = new URL(baseUrl)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.pathname !== '/') throw new Error('仅支持本机 hiCanvas 服务地址。')
  const project = process.env.HICANVAS_PROJECT_DIR || join(homedir(), 'Documents', 'hiCanvas')
  const root = resolve(process.env.HICANVAS_CANVAS_DIR || join(project, 'canvas'))
  const identity = createHash('sha256').update(root).digest('hex')
  async function running() {
    let response
    try { response = await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(1000) }) }
    catch { return false }
    let health
    try { health = await response.json() } catch { throw new Error('端口已被旧版画板或其他程序占用；请先停止旧服务，再重新连接 MCP。') }
    if (health.name !== 'hiCanvas' || health.protocol !== 2 || health.workspace !== identity) throw new Error('端口对应其他服务或资料目录，未连接也未停止该服务。请核对 HICANVAS_URL 和资料目录。')
    return true
  }
  if (await running()) return
  const appRoot = fileURLToPath(new URL('../', import.meta.url))
  if (!existsSync(join(appRoot, 'dist', 'index.html'))) throw new Error('hiCanvas 尚未构建，请先在项目目录运行 npm run build。')
  await withFileLock(join(root, 'conversations', 'service-start.lock'), async () => {
    if (await running()) return
    const child = spawn(process.execPath, [join(appRoot, 'bin', 'hicanvas-service.mjs')], { cwd: appRoot, env: { ...process.env, HICANVAS_PORT: base.port || '80' }, detached: true, stdio: 'ignore' })
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
