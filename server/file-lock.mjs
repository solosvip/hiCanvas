import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'

export function httpError(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra })
}

// SQLite 的进程锁由系统在崩溃时释放；不靠删除 PID 文件接管锁。
// 画板数据仍用原子 JSON 保存，数据库只承载互斥锁。
export async function withFileLock(path, operation) {
  await mkdir(dirname(path), { recursive: true })
  const database = new DatabaseSync(`${path}.sqlite`)
  const deadline = Date.now() + 10000
  try {
    database.exec('PRAGMA busy_timeout = 0')
    while (true) {
      try { database.exec('BEGIN IMMEDIATE'); break } catch (error) {
        if (error.errcode !== 5 && error.errcode !== 6) throw error
        if (Date.now() >= deadline) throw httpError('该对话正在保存，请稍后重试。', 503)
        await delay(25)
      }
    }
    return await operation()
  } finally { database.close() }
}
