import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHiCanvasService } from './local-service.mjs'
import { workspaceIdentity } from '../mcp/connection.mjs'

test('独立服务同时提供构建资源和完整画板接口，保持本机边界', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hicanvas-static-'))
  const distDir = join(root, 'dist')
  const canvasDir = join(root, 'canvas')
  await mkdir(distDir)
  await writeFile(join(distDir, 'index.html'), '<title>画板测试</title>')
  await writeFile(join(distDir, 'app.js'), 'const canvas = true')
  await writeFile(join(root, 'secret.txt'), 'private')
  const server = createHiCanvasService({ distDir, canvasDir, settingsDir: join(root, 'settings') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${server.address().port}`
  const page = await fetch(base + '/?conversation=test')
  assert.equal(page.status, 200)
  assert.equal(await page.text(), '<title>画板测试</title>')
  const script = await fetch(base + '/app.js')
  assert.match(script.headers.get('content-type'), /javascript/)
  assert.equal(await script.text(), 'const canvas = true')
  assert.equal((await fetch(base + '/app.js', { method: 'HEAD' })).headers.get('content-length'), '19')
  const health = await (await fetch(base + '/api/health')).json()
  assert.equal(health.workspace, workspaceIdentity(canvasDir))
  const opened = await fetch(base + '/api/conversations/open', { method: 'POST', headers: { 'x-hicanvas-client': '1', 'content-type': 'application/json' }, body: JSON.stringify({ title: '独立应用' }) })
  assert.equal(opened.status, 200)
  const { conversation } = await opened.json()
  const canvas = await (await fetch(base + '/api/canvas?conversation=' + conversation.id, { headers: { 'x-hicanvas-client': '1' } })).json()
  assert.ok(canvas.revision)
  for (const path of ['/missing.js', '/%2e%2e%2fsecret.txt', '/.git/config']) assert.equal((await fetch(base + path, { headers: { 'x-hicanvas-client': '1' } })).status, 404, path)
  assert.notEqual((await fetch(base + '/api/missing', { headers: { 'x-hicanvas-client': '1' } })).status, 200)
  assert.equal((await fetch(base, { headers: { origin: 'https://example.com' } })).status, 403)
})
