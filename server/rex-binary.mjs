import { access, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// GUI 启动没有终端 PATH；只从本机环境及 REX 自己的安装目录发现程序。
// HTTP 接收器里的 binary 字段不能用作可执行文件路径。
export async function findRexBinary({ env = process.env, supportDir = join(homedir(), 'Library', 'Application Support') } = {}) {
  const candidates = env.REX_BIN_DIR ? [join(env.REX_BIN_DIR, 'rex')] : []
  for (const path of (env.PATH || '').split(':').filter(Boolean)) candidates.push(join(path, 'rex'))
  const installs = await readdir(supportDir).catch(() => [])
  for (const name of installs.filter(name => /^com\.superlogical\.rex(?:\.[\w-]+)?$/.test(name))) candidates.push(join(supportDir, name, 'RexServer', 'Versions', 'Current', 'Rex Server.app', 'Contents', 'MacOS', 'rex'))
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate } catch { /* 继续查找 */ }
  }
  throw new Error('找不到本机 REX，请先安装并打开 REX，或设置 REX_BIN_DIR。')
}
