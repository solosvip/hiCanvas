import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { withFileLock } from './file-lock.mjs'

test('持锁进程异常退出后可恢复，多个等待者不会同时进入保存区', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hicanvas-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'save.lock')
  const script = `import { withFileLock } from ${JSON.stringify(new URL('./file-lock.mjs', import.meta.url).href)}; await withFileLock(process.env.TEST_LOCK, async () => { process.send('locked'); await new Promise(() => { setInterval(() => {}, 1000) }) })`
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TEST_LOCK: path }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  await once(child, 'message')
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited
  let active = 0, maxActive = 0, completed = 0
  await Promise.all(Array.from({ length: 12 }, () => withFileLock(path, async () => {
    maxActive = Math.max(maxActive, ++active)
    await delay(5)
    completed++; active--
  })))
  assert.equal(maxActive, 1)
  assert.equal(completed, 12)
})
