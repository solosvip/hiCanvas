#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requested = process.argv.slice(2)
if (requested.some(file => file.startsWith('-'))) throw new Error('测试入口只接受测试文件路径，不接受跳过或筛选选项。')
const files = [...new Set(requested.length ? requested.map(file => resolve(file)) :
  ['tools', 'server'].flatMap(dir => readdirSync(resolve(root, dir))
    .filter(file => file.endsWith('.test.mjs')).map(file => resolve(root, dir, file))))].sort()
if (!files.length) throw new Error('没有发现测试文件。')
const env = { ...process.env, HICANVAS_TEST_ENTRY_FILES: JSON.stringify(files) }
delete env.NODE_TEST_CONTEXT // 回归测试可以创建独立运行器，不能继承当前 worker 标记。
const child = spawn(process.execPath, [
  '--import', resolve(root, 'tools/test-sandbox.mjs'),
  '--import', resolve(root, 'tools/test-report-preload.mjs'),
  '--test', '--test-force-exit', '--test-timeout=15000',
  `--test-reporter=${resolve(root, 'tools/test-reporter.mjs')}`, ...files,
], { cwd: root, env, stdio: 'inherit' })
child.once('error', error => { console.error(error); process.exitCode = 1 })
child.once('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
