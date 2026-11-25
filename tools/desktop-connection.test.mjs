import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConnection, localBaseUrl, canvasDeepLink, parseDeepLink, workspaceIdentity } from '../mcp/connection.mjs'
import { allowedNavigation, externalLink, validateCanvasLink } from '../desktop/navigation.mjs'

test('桌面与 MCP 共享配置；显式资料目录覆盖保存的目录', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hicanvas-desktop-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'connection.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:43219', projectDir: '/saved', canvasDir: '/saved/canvas', settingsDir: '/saved/settings' }))
  const env = { HICANVAS_DESKTOP_CONFIG_DIR: dir }
  assert.deepEqual(loadConnection(env), { baseUrl: 'http://127.0.0.1:43219', projectDir: '/saved', canvasDir: '/saved/canvas', settingsDir: '/saved/settings' })
  assert.deepEqual(loadConnection({ ...env, HICANVAS_PROJECT_DIR: '/isolated', HICANVAS_PORT: '43228' }), { baseUrl: 'http://127.0.0.1:43228', projectDir: '/isolated', canvasDir: '/isolated/canvas', settingsDir: '/isolated/settings' })
})
test('深链保留对话，只接受本机画板和明确资料标识', () => {
  const workspace = workspaceIdentity('/test/canvas')
  const url = 'http://127.0.0.1:43218/?conversation=abc-123'
  assert.deepEqual(parseDeepLink(canvasDeepLink(url, workspace)), { url, baseUrl: 'http://127.0.0.1:43218', workspace })
  for (const bad of ['https://127.0.0.1:43218', 'http://example.com', 'file:///tmp', 'http://user@localhost:3', 'http://localhost:3/?a=1']) assert.throws(() => localBaseUrl(bad))
  assert.throws(() => canvasDeepLink('http://localhost:43218/api/image-models', workspace))
  assert.throws(() => parseDeepLink('hicanvas://open?url=http://example.com/&workspace=' + workspace))
  assert.throws(() => parseDeepLink('hicanvas://open?url=http://localhost:43218/'))
  assert.equal(allowedNavigation(url, 'http://127.0.0.1:43218'), true)
  assert.equal(allowedNavigation('http://127.0.0.1:43218/api/image-models', 'http://127.0.0.1:43218'), false)
  assert.equal(allowedNavigation('https://example.com', 'http://127.0.0.1:43218'), false)
  assert.equal(externalLink('file:///etc/passwd'), false)
  assert.equal(externalLink('javascript:alert(1)'), false)
})
test('深链拒绝其他资料目录的已运行服务', async t => {
  const { fixture } = await import('../server/test-helpers.mjs')
  const { base, workspace } = await fixture(t)
  const identity = workspaceIdentity(workspace.root)
  const link = { url: base + '/?conversation=test', baseUrl: base, workspace: identity }
  assert.equal(await validateCanvasLink(link), link.url)
  await assert.rejects(validateCanvasLink({ ...link, workspace: '0'.repeat(64) }), /不匹配/)
})

test('深链切换和关闭先完成保存，保存失败保持原窗口', async () => {
  const { navigateCanvas, saveBeforeLeaving } = await import('../desktop/window-navigation.mjs')
  const steps = []
  const contents = { getURL: () => 'http://127.0.0.1:43218/?conversation=old', executeJavaScript: async () => { steps.push('save') }, loadURL: async url => { steps.push(url) } }
  await navigateCanvas(contents, 'http://127.0.0.1:43218/?conversation=new')
  assert.deepEqual(steps, ['save', 'http://127.0.0.1:43218/?conversation=new'])
  steps.length = 0
  contents.executeJavaScript = async () => { throw new Error('保存冲突') }
  await assert.rejects(navigateCanvas(contents, 'http://127.0.0.1:43218/?conversation=new'), /保存冲突/)
  await assert.rejects(saveBeforeLeaving(contents), /保存冲突/)
  assert.deepEqual(steps, [])
})
test('GUI 服务没有终端环境时，仍可发现本机 REX，不接收 HTTP 指定的程序', async t => {
  const { findRexBinary } = await import('../server/rex-binary.mjs')
  const { mkdir, chmod } = await import('node:fs/promises')
  const dir = await mkdtemp(join(tmpdir(), 'hicanvas-rex-binary-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const parent = join(dir, 'com.superlogical.rex.zh-hans/RexServer/Versions/Current/Rex Server.app/Contents/MacOS')
  await mkdir(parent, { recursive: true })
  const binary = join(parent, 'rex')
  await writeFile(binary, '#!/bin/sh\nexit 0\n'); await chmod(binary, 0o755)
  assert.equal(await findRexBinary({ env: { PATH: '/usr/bin:/bin' }, supportDir: dir }), binary)
  await assert.rejects(findRexBinary({ env: { PATH: '/usr/bin:/bin' }, supportDir: join(dir, 'missing') }), /找不到/)
})
test('画板相同、模型设置目录不同时拒绝复用后台', async t => {
  const { createHiCanvasService } = await import('../server/local-service.mjs')
  const { ensureService } = await import('../mcp/startup.mjs')
  const dir = await mkdtemp(join(tmpdir(), 'hicanvas-settings-'))
  const server = createHiCanvasService({ distDir: dir, canvasDir: join(dir, 'canvas'), settingsDir: join(dir, 'settings-a') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${server.address().port}`
  await assert.rejects(ensureService(base, { canvasDir: join(dir, 'canvas'), settingsDir: join(dir, 'settings-b') }), /其他模型设置目录/)
  await ensureService(base, { canvasDir: join(dir, 'canvas'), settingsDir: join(dir, 'settings-a') })
})

test('尚未挂载编辑器的加载/错误页面也可关闭；已挂载时等待保存', async () => {
  const { saveBeforeLeaving } = await import('../desktop/window-navigation.mjs')
  const { runInNewContext } = await import('node:vm')
  let window = {}
  const contents = { getURL: () => 'http://127.0.0.1:43218/', executeJavaScript: code => runInNewContext(code, { window }) }
  await saveBeforeLeaving(contents)
  let saved = false
  window.hiCanvasPrepareNavigation = async () => { saved = true }
  await saveBeforeLeaving(contents)
  assert.equal(saved, true)
  window.hiCanvasPrepareNavigation = async () => { throw new Error('未保存') }
  await assert.rejects(saveBeforeLeaving(contents), /未保存/)
})
