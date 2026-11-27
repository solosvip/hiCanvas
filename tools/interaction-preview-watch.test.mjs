import './test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { startInteractionPreview } from './renderer-preview/service.mjs'

async function connect(url) {
  const socket = new WebSocket(url.replace(/^http/, 'ws'), 'vite-hmr'), messages = [], errors = []
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('预览热更新连接超时。')), 5000)
      socket.addEventListener('message', event => {
        try {
          const message = JSON.parse(event.data); messages.push(message)
          if (message.type === 'connected') { clearTimeout(timer); resolve() }
        } catch (error) { errors.push(error.message); clearTimeout(timer); reject(error) }
      })
      socket.addEventListener('error', () => { errors.push('连接失败'); clearTimeout(timer); reject(new Error('预览热更新连接失败。')) })
      socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('预览热更新连接提前关闭。')) }, { once: true })
    })
    return { socket, messages, errors, close: () => socket.close() }
  } catch (error) { socket.close(); throw error }
}

// Use a real Vite connection and a positive control: a disabled watcher must
// not turn an unrelated scratch HTML write into a page reload during a check.
test('交互预览：人工默认响应文件改动，自动检查关闭监听后不再重载', { timeout: 60000 }, async () => {
  const scratch = fileURLToPath(new URL('../.scratch/', import.meta.url))
  const dir = await mkdtemp(join(scratch, 'interaction-watch-')), page = join(dir, 'probe.html')
  let serial = 0
  const writeUntilReload = async (channel, duration) => {
    for (const end = Date.now() + duration; Date.now() < end;) {
      await writeFile(page, `<!doctype html><p>${++serial}</p>`)
      await delay(200)
      if (channel.messages.some(message => message.type === 'full-reload')) return true
    }
    return false
  }
  try {
    await writeFile(page, '<!doctype html><p>control</p>')
    const manual = await startInteractionPreview({ dataDir: join(dir, 'manual') })
    let channel, controlDuration
    try {
      channel = await connect(manual.url)
      const started = Date.now()
      assert.equal(await writeUntilReload(channel, 15000), true, '默认预览未收到文件变更，本次对照无效。')
      controlDuration = Date.now() - started
      assert.ok(manual.getWatchedPaths().length > 0, '默认人工预览没有实际监听文件。')
    } finally { channel?.close(); await manual.close() }
    const automated = await startInteractionPreview({ dataDir: join(dir, 'automated'), watch: false })
    channel = undefined
    try {
      channel = await connect(automated.url)
      assert.deepEqual(automated.getWatchedPaths(), [], '自动检查仍存在文件监听。')
      assert.equal(await writeUntilReload(channel, Math.max(3000, 2 * controlDuration)), false, '自动检查仍因写入 scratch HTML 而重载。')
      assert.deepEqual(automated.getWatchedPaths(), [], '写入文件后自动检查重新开始监听。')
      assert.deepEqual(channel.messages.map(message => message.type), ['connected'], '自动检查推送了重载、更新或其他变更事件。')
      assert.deepEqual(channel.errors, [])
      assert.equal(channel.socket.readyState, WebSocket.OPEN, '通道提前断开，本次无事件结论无效。')
    } finally { channel?.close(); await automated.close() }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('原生自动检查和性能测量入口显式关闭预览文件监听', async () => {
  // Derive the entries instead of listing them: a new native check (as #128's
  // snapping-check once was) is covered the moment it starts a preview. Only the
  // two hosts' own command lines are manual previews and keep watching.
  const tools = fileURLToPath(new URL('.', import.meta.url)), manual = ['renderer-preview.mjs', 'renderer-preview/service.mjs']
  const files = (await readdir(tools, { recursive: true })).filter(file => file.endsWith('.mjs') && !file.endsWith('.test.mjs') && !manual.includes(file))
  const entries = []
  for (const file of files) if (/\bstart(?:Interaction|Renderer)Preview\s*\(/.test(await readFile(join(tools, file), 'utf8'))) entries.push(relative(tools, join(tools, file)))
  for (const known of ['renderer-smoke.mjs', 'perf-baseline.mjs', 'renderer-preview/snapping-check.mjs', 'renderer-preview/verify.mjs']) assert.ok(entries.includes(known), `没有找到 ${known}，入口扫描失效。`)
  for (const entry of entries) {
    const source = await readFile(join(tools, entry), 'utf8')
    const calls = [...source.matchAll(/\bstart(?:Interaction|Renderer)Preview\s*\(\s*\{([\s\S]*?)\}\s*\)/g)]
    assert.equal(calls.length, 1, `${entry} 的预览调用变化，请重新核对隔离配置。`)
    assert.match(calls[0][1], /\bwatch\s*:\s*false\b/, `${entry} 没有关闭自动检查的文件监听。`)
  }
})
