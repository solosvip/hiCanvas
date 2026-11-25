// 必须是测试的第一条导入：ES 静态导入先于文件正文执行，正文里改环境已太晚。
// 先隔离主目录和资料路径，避免业务模块缓存真实默认路径后被测试读取或删除。
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const initialized = Symbol.for('hicanvas.test-sandbox')
if (!globalThis[initialized]) {
  const root = mkdtempSync(join(tmpdir(), 'hicanvas-test-'))
  process.once('exit', () => rmSync(root, { recursive: true, force: true }))
  const home = join(root, 'home')
  mkdirSync(home)
  process.env.HOME = home
  // 真实 MCP 会话可能带着用户服务地址；测试只允许显式传入模拟服务地址。
  delete process.env.HICANVAS_URL
  delete process.env.HICANVAS_PORT
  const directories = {
    PROJECT_DIR: join(root, 'project'),
    CANVAS_DIR: join(root, 'project', 'canvas'),
    SETTINGS_DIR: join(root, 'project', 'settings'),
    DESKTOP_CONFIG_DIR: join(root, 'desktop-config'),
  }
  const names = new Set(Object.keys(process.env).filter(name => /^(?:HICANVAS|COWART)_.+_DIR$/.test(name)))
  for (const prefix of ['HICANVAS', 'COWART']) for (const suffix of Object.keys(directories)) names.add(`${prefix}_${suffix}`)
  for (const name of names) {
    const suffix = name.replace(/^(?:HICANVAS|COWART)_/, '')
    process.env[name] = directories[suffix] || join(root, 'directories', name)
  }
  globalThis[initialized] = root
}
