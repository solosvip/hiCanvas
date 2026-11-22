import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { workspaceIdentity } from '../mcp/connection.mjs'

const app = resolve(process.argv[2] || 'build/desktop/hiCanvas-darwin-arm64/hiCanvas.app')
const root = await mkdtemp(join(tmpdir(), 'hicanvas-app-smoke-'))
const projectDir = join(root, 'project')
const canvasDir = join(projectDir, 'canvas')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const baseUrl = `http://127.0.0.1:${port}`
let client
let calls = 0
let release
const barrier = new Promise(resolve => { release = resolve })
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const provider = createServer(async (req, res) => {
  calls++
  for await (const _ of req) { /* 只接收合成请求 */ }
  await barrier
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ data: [{ b64_json: png }] }))
})
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
await writeFile(join(root, 'connection.json'), JSON.stringify({ baseUrl, projectDir, canvasDir, settingsDir: join(projectDir, 'settings') }))
const env = { ...process.env, HICANVAS_DESKTOP_CONFIG_DIR: root }
for (const name of ['HICANVAS_URL', 'HICANVAS_PROJECT_DIR', 'HICANVAS_CANVAS_DIR', 'HICANVAS_SETTINGS_DIR', 'HICANVAS_PORT', 'HICANVAS_APP_ROOT', 'ELECTRON_RUN_AS_NODE']) delete env[name]
async function connect() {
  client = new Client({ name: 'packaged-app-smoke', version: '1' })
  await client.connect(new StdioClientTransport({ command: join(app, 'Contents/Resources/hicanvas-mcp'), env, stderr: 'pipe' }))
}
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  assert.ok(!result.isError, JSON.stringify(result))
  return result.structuredContent
}
async function api(path, method = 'GET', body) {
  const response = await fetch(baseUrl + path, { method, headers: { 'x-hicanvas-client': '1', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  assert.ok(response.ok, await response.clone().text())
  return response.json()
}
try {
  await connect() // 服务必须从签名 .app 内的 app.asar 冷启动，不能借用源码或全局 Node。
  assert.equal((await client.listTools()).tools.length, 16)
  assert.equal((await api('/api/health')).workspace, workspaceIdentity(canvasDir))
  const page = await fetch(baseUrl)
  const html = await page.text()
  assert.match(html, /app-assets/)
  const resource = html.match(/src="([^"]+\.js)"/)[1]
  assert.equal((await fetch(baseUrl + resource)).status, 200)
  const opened = await call('open_conversation', { bindingKey: 'packaged-test', title: '打包验证' })
  const id = opened.conversationId
  let canvas = await call('get_canvas', { conversationId: id })
  const pageId = Object.values(canvas.snapshot.store).find(r => r.typeName === 'page').id
  await call('apply_canvas_operations', { conversationId: id, expectedRevision: canvas.revision, operations: [{ type: 'create_shape', id: 'shape:desktop', shapeType: 'text', text: '应用内保存', x: 20, y: 30 }] })
  const model = await api('/api/image-models', 'POST', { name: '本机模拟', protocol: 'openai-images', baseUrl: `http://127.0.0.1:${provider.address().port}`, model: 'synthetic', apiKey: '' })
  canvas = await call('get_canvas', { conversationId: id })
  const job = await call('submit_image_batch', { conversationId: id, expectedRevision: canvas.revision, pageId, modelId: model.activeModelId, requests: Array.from({ length: 4 }, (_, i) => ({ prompt: `合成图 ${i}` })) })
  canvas = await call('get_canvas', { conversationId: id })
  assert.equal(Object.values(canvas.snapshot.store).filter(r => r.meta?.cowartAiImageHolder).length, 4)
  await client.close() // AI 离线后服务仍应完成任务。
  release()
  let completed
  for (let i = 0; i < 100; i++) {
    completed = await api(`/api/images/jobs/${job.jobId}?conversation=${id}`)
    if (completed.finished) break
    await delay(50)
  }
  assert.ok(completed.finished)
  assert.ok(completed.items.every(item => item.status === 'succeeded'))
  assert.equal(calls, 4)
  await connect()
  assert.equal((await call('open_conversation', { bindingKey: 'packaged-test' })).conversationId, id)
  canvas = await call('get_canvas', { conversationId: id })
  assert.ok(canvas.snapshot.store['shape:desktop'])
  const images = Object.values(canvas.snapshot.store).filter(r => r.typeName === 'shape' && r.type === 'image')
  assert.equal(images.length, 4)
  assert.equal(new Set(images.map(r => r.x)).size, 2)
  assert.equal(new Set(images.map(r => r.y)).size, 2)
  await call('insert_cowart_html_draft', { conversationId: id, expectedRevision: canvas.revision, pageId, htmlContent: '<!doctype html><html><body><h1>打包 HTML</h1></body></html>', displayWidth: 600, displayHeight: 400 })
  canvas = await call('get_canvas', { conversationId: id })
  assert.ok(Object.values(canvas.snapshot.store).some(r => r.meta?.cowartHtmlDraft))
  const saved = JSON.parse(await readFile(join(canvasDir, 'conversations', id, 'state.json'), 'utf8'))
  assert.ok(JSON.stringify(saved).includes('shape:desktop'))
  console.log('通过：应用内运行环境冷启服务、16 个 MCP 工具、资源加载、对话保存与重连、4 张占位/2×2 排版、AI 离线继续生成、HTML 写回；真实模型调用 0 次。')
} finally {
  release()
  await client?.close()
  provider.closeAllConnections()
  await new Promise(resolve => provider.close(resolve))
  // 只停止本次唯一端口且健康标识相同、来自目标应用的自有服务。
  try {
    const health = await (await fetch(baseUrl + '/api/health', { signal: AbortSignal.timeout(1000) })).json()
    if (health.workspace === workspaceIdentity(canvasDir)) {
      const pid = execFileSync('/usr/sbin/lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim()
      const command = execFileSync('/bin/ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' }).trim()
      if (command.startsWith(join(app, 'Contents/MacOS/hiCanvas') + ' ')) process.kill(Number(pid), 'SIGTERM')
    }
  } catch { /* 启动失败时服务可能不存在 */ }
  await delay(200)
  await rm(root, { recursive: true, force: true })
}
