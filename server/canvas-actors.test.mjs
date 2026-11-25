import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createHiCanvasMcp } from '../mcp/server.mjs'
import { fixture } from './test-helpers.mjs'
import { createImageJobs } from './image-jobs.mjs'
import { createAgentRequests } from './agent-requests.mjs'

async function observe(t, base, id) {
  const controller = new AbortController()
  const stream = await fetch(`${base}/api/canvas-events?conversation=${id}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
  const reader = stream.body.getReader(), decoder = new TextDecoder(), pending = []
  let buffer = ''
  t.after(async () => { controller.abort(); await reader.cancel().catch(() => {}) })
  return async revision => {
    while (true) {
      while (pending.length) { const event = pending.shift(); if (event.revision === revision) return event }
      const { value, done } = await reader.read()
      assert.equal(done, false, '收到对应提交的广播之前，连接不能提前结束')
      buffer += decoder.decode(value, { stream: true })
      let end
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, end); buffer = buffer.slice(end + 2)
        const data = event.split('\n').find(line => line.startsWith('data: '))
        if (data) pending.push(JSON.parse(data.slice(6)))
      }
    }
  }
}

test('本机命令和媒体返回及广播携带请求头操作者，缺省为 http，旧界面固定 legacy-ui', async t => {
  const { workspace, api, base } = await fixture(t), { id } = await workspace.open()
  const notification = await observe(t, base, id)
  let current = await workspace.read(id)
  for (const [headers, actor] of [[{ 'x-hicanvas-actor': 'ui:synthetic' }, 'ui:synthetic'], [{}, 'http']]) {
    const saved = await api(`/api/canvas/operations?conversation=${id}`, 'POST', { expectedRevision: current.revision, operations: [{ type: 'create_shape', shapeType: 'geo' }] }, headers)
    assert.equal(saved.status, 200)
    assert.equal(saved.body.actor, actor)
    assert.equal(saved.body.results, undefined, 'HTTP 仍沿用原回执字段，完整命令回执由工作区提供给宿主')
    assert.equal((await notification(saved.body.revision)).actor, actor)
    current = saved.body
  }
  const html = await api(`/api/canvas/html?conversation=${id}`, 'POST', { expectedRevision: current.revision, htmlContent: '<html>合成稿</html>' }, { 'x-hicanvas-actor': 'ui:html' })
  assert.equal(html.status, 200)
  assert.equal(html.body.actor, 'ui:html')
  assert.equal(html.body.changes, undefined)
  assert.equal(html.body.results, undefined)
  assert.equal((await notification(html.body.revision)).actor, 'ui:html')
  const edited = await api(`/api/html-draft?conversation=${id}`, 'PUT', { expectedRevision: html.body.revision, draftShapeId: html.body.shapeId, htmlContent: '<html>修改稿</html>' }, { 'x-hicanvas-actor': 'ui:html-editor' })
  assert.equal(edited.status, 200)
  assert.equal(edited.body.actor, 'ui:html-editor')
  assert.equal((await notification(edited.body.revision)).actor, 'ui:html-editor')
  current = await workspace.read(id)
  const legacy = await api(`/api/canvas?conversation=${id}`, 'PUT', { expectedRevision: current.revision, snapshot: current.snapshot }, { 'x-hicanvas-actor': 'must-not-override-legacy' })
  assert.equal(legacy.status, 200)
  assert.equal(legacy.body.actor, 'legacy-ui')
  assert.equal((await notification(legacy.body.revision)).actor, 'legacy-ui')
})

test('隔离 MCP 连接的命令与媒体写入共享进程会话操作者，回执和广播一致', async t => {
  const { workspace, base } = await fixture(t), { id } = await workspace.open()
  const notification = await observe(t, base, id)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createHiCanvasMcp({ baseUrl: base, open: async () => {} })
  const client = new Client({ name: 'synthetic-actor-test', version: '1' })
  await server.connect(serverTransport); await client.connect(clientTransport)
  t.after(async () => { await client.close(); await server.close() })
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args })
    assert.ok(!result.isError, JSON.stringify(result))
    return result.structuredContent
  }
  const current = await workspace.read(id)
  const saved = await call('apply_canvas_operations', { conversationId: id, expectedRevision: current.revision, operations: [{ type: 'create_shape', shapeType: 'geo' }] })
  assert.match(saved.actor, /^mcp:[a-f0-9-]{36}$/)
  assert.equal((await notification(saved.revision)).actor, saved.actor)
  const html = await call('insert_cowart_html_draft', { conversationId: id, expectedRevision: saved.revision, htmlContent: '<html>合成 MCP 稿</html>' })
  assert.equal(html.actor, saved.actor)
  assert.equal((await notification(html.revision)).actor, saved.actor)
})

test('批量生图的预留、状态和图片写回统一使用 image-jobs，调用和广播均可追溯', async t => {
  const { workspace, base } = await fixture(t), { id } = await workspace.open()
  const notification = await observe(t, base, id)
  const current = await workspace.read(id)
  const jobs = createImageJobs(workspace, { get: async () => ({ id: 'synthetic' }) }, { generate: async () => [{ bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhQJ/wR6cvQAAAABJRU5ErkJggg==', 'base64'), extension: 'png' }] })
  t.after(() => jobs.waitForIdle())
  const saved = await jobs.submit(id, { expectedRevision: current.revision, requests: [{ prompt: '仅用合成图片' }] })
  assert.equal(saved.actor, 'image-jobs')
  assert.equal((await notification(saved.revision)).actor, 'image-jobs')
  await jobs.waitForIdle()
  const final = await workspace.read(id)
  assert.equal(final.actor, 'image-jobs')
  assert.equal((await notification(final.revision)).actor, 'image-jobs')
  assert.equal((await jobs.get(id, saved.jobId)).items[0].status, 'succeeded')
})

test('AI 请求的等待、领取和完成标记统一使用 agent-requests，返回与广播一致', async t => {
  const { workspace, base } = await fixture(t), { id } = await workspace.open()
  const initial = await workspace.read(id)
  await workspace.submitCommands(id, initial.revision, 'setup', () => [{ type: 'create_shape', id: 'shape:target', shapeType: 'frame' }])
  const notification = await observe(t, base, id)
  const requests = createAgentRequests(workspace, { deliver: async () => ({ status: 'waiting' }) })
  const submitted = await requests.submit(id, { prompt: '合成请求', context: { targetShapeId: 'shape:target' } })
  const claimed = (await requests.list(id, { claimBy: 'synthetic-agent' }))[0]
  assert.equal(submitted.actor, 'agent-requests')
  assert.equal(claimed.actor, 'agent-requests')
  assert.equal((await notification((await workspace.read(id)).revision)).actor, 'agent-requests')
  const finished = await requests.complete(id, submitted.id, { status: 'completed', claimBy: 'synthetic-agent' })
  assert.equal(finished.actor, 'agent-requests')
  assert.equal((await notification((await workspace.read(id)).revision)).actor, 'agent-requests')
})
