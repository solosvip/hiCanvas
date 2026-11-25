import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from 'node:http'
import { createHiCanvasMcp } from '../mcp/server.mjs'
import { fixture } from './test-helpers.mjs'

async function connect(t, baseUrl, bindingKey) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createHiCanvasMcp({ baseUrl, bindingKey, open: async () => {} })
  const client = new Client({ name: 'synthetic-rex-agent', version: '1' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  t.after(async () => { await client.close(); await server.close() })
  async function call(name, args = {}) { return client.callTool({ name, arguments: args }) }
  return { client, call }
}

test('同一 MCP 连接并发首次打开时只创建一个对话，各请求返回自己的绑定', async t => {
  const { base } = await fixture(t)
  const { call } = await connect(t, base)
  const opened = await Promise.all(Array.from({ length: 5 }, () => call('open_conversation')))
  assert.equal(new Set(opened.map(r => r.structuredContent.conversationId)).size, 1)
  const separate = await Promise.all(['chat-one', 'chat-two'].map(bindingKey => call('open_conversation', { bindingKey })))
  assert.notEqual(separate[0].structuredContent.conversationId, separate[1].structuredContent.conversationId)
  for (const r of separate) assert.equal(r.structuredContent.conversation.id, r.structuredContent.conversationId)
})

test('两个独立 MCP 客户端创建各自对话；批量读写、重连绑定和重复打开均不串板', async t => {
  const { base } = await fixture(t)
  const a = await connect(t, base, 'rex-chat-a')
  const b = await connect(t, base, 'rex-chat-b')
  const tools = await a.client.listTools()
  assert.ok(tools.tools.some(tool => tool.name === 'generate_image'))
  const first = (await a.call('open_conversation', { title: '海报 A' })).structuredContent
  const other = (await b.call('open_conversation', { title: '原型 B' })).structuredContent
  assert.notEqual(first.conversationId, other.conversationId)
  const operations = [{ type: 'create_shape', id: 'shape:poster', shapeType: 'geo', x: 30, y: 40, text: '海报标题' }, { type: 'create_shape', id: 'shape:caption', shapeType: 'text', x: 50, y: 180, text: '中文说明' }]
  const saved = await a.call('apply_canvas_operations', { conversationId: first.conversationId, expectedRevision: first.revision, operations })
  assert.equal(saved.isError, undefined)
  const read = (await a.call('get_canvas', { conversationId: first.conversationId })).structuredContent
  assert.equal(read.snapshot.store['shape:poster'].x, 30)
  assert.equal((await b.call('get_canvas', { conversationId: other.conversationId })).structuredContent.snapshot.store['shape:poster'], undefined)
  assert.equal((await a.call('open_conversation')).structuredContent.conversationId, first.conversationId)
  const restarted = await connect(t, base, 'rex-chat-a')
  assert.equal((await restarted.call('open_conversation')).structuredContent.conversationId, first.conversationId)
  const conflict = await b.call('apply_canvas_operations', { conversationId: first.conversationId, expectedRevision: first.revision, operations })
  assert.equal(conflict.isError, true)
  assert.match(conflict.content[0].text, /revision-conflict/)
  assert.equal((await a.call('open_conversation', { createNew: true })).structuredContent.conversationId === first.conversationId, false)
})

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
async function provider(t, handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}`
}

async function waitJob(call, id, jobId) {
  for (let i = 0; i < 200; i++) {
    const result = (await call('get_generation_job', { conversationId: id, jobId })).structuredContent
    if (result.finished) { await new Promise(resolve => setTimeout(resolve, 30)); return result }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('任务没有完成')
}

test('MCP 复用用户配置生图、插入图片、看图并参考改图；模型密钥不进入 MCP 输出', async t => {
  const { api, base } = await fixture(t)
  let calls = 0
  const url = await provider(t, async (req, res) => {
    calls++
    for await (const _ of req) { /* 吃完模拟请求。 */ }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: [{ b64_json: png }] }))
  })
  const model = (await api('/api/image-models', 'POST', { name: '我的生图', protocol: 'openai-images', baseUrl: url, model: 'custom-image', apiKey: 'synthetic-secret' })).body
  const { call } = await connect(t, base)
  const opened = (await call('open_conversation')).structuredContent
  const id = opened.conversationId
  const canvas = (await call('get_canvas', { conversationId: id })).structuredContent
  const pageId = Object.values(canvas.snapshot.store).find(r => r.typeName === 'page').id
  assert.ok(!JSON.stringify(await call('list_image_models')).includes('synthetic-secret'))
  const result = (await call('generate_image', { conversationId: id, expectedRevision: canvas.revision, modelId: model.activeModelId, prompt: '蓝色海报' })).structuredContent
  assert.ok(result.jobId)
  const completed = await waitJob(call, id, result.jobId)
  assert.equal(completed.items[0].status, 'succeeded')
  assert.equal(calls, 1)
  const src = completed.items[0].images[0].src
  const image = await call('read_image', { conversationId: id, src })
  assert.equal(image.content[0].type, 'image')
  assert.equal(image.content[0].data, png)
  assert.equal((await call('read_image', { conversationId: 'legacy', src })).isError, true)
  const edited = (await call('generate_image', { conversationId: id, expectedRevision: (await call('get_canvas', { conversationId: id })).structuredContent.revision, modelId: model.activeModelId, prompt: '改成绿色', referenceUrls: [src] })).structuredContent
  assert.equal((await waitJob(call, id, edited.jobId)).items[0].status, 'succeeded')
  assert.equal(calls, 2)
  assert.equal((await call('generate_image', { conversationId: id, expectedRevision: result.revision, prompt: '旧版本', pageId })).isError, true)
  assert.equal(calls, 2, '冲突时不调用收费接口')
})

test('生图期间出现并发编辑，结果仍可找回且不会覆盖画板或自动重试', async t => {
  const { api, base } = await fixture(t)
  const { call } = await connect(t, base)
  const opened = (await call('open_conversation')).structuredContent
  const id = opened.conversationId
  const canvas = (await call('get_canvas', { conversationId: id })).structuredContent
  const pageId = Object.values(canvas.snapshot.store).find(r => r.typeName === 'page').id
  let calls = 0
  const url = await provider(t, async (req, res) => {
    calls++; for await (const _ of req) {}
    await api(`/api/canvas/operations?conversation=${id}`, 'POST', { expectedRevision: (await api(`/api/canvas?conversation=${id}`)).body.revision, operations: [{ type: 'create_shape', id: 'shape:concurrent', shapeType: 'text', text: '不能覆盖我' }] })
    res.end(JSON.stringify({ data: [{ b64_json: png }] }))
  })
  await api('/api/image-models', 'POST', { name: '模拟服务', protocol: 'openai-images', baseUrl: url, model: 'custom-image', apiKey: '' })
  const result = (await call('generate_image', { conversationId: id, expectedRevision: canvas.revision, prompt: '生成', pageId })).structuredContent
  const completed = await waitJob(call, id, result.jobId)
  assert.equal(completed.items[0].status, 'succeeded')
  assert.equal(calls, 1)
  assert.equal((await call('list_image_results', { conversationId: id })).structuredContent.images[0].src, completed.items[0].images[0].src)
  assert.equal((await call('list_image_results', { conversationId: 'legacy' })).structuredContent.images.length, 0)
  const latest = (await call('get_canvas', { conversationId: id })).structuredContent
  assert.ok(latest.snapshot.store['shape:concurrent'])
})

test('真实 stdio MCP 进程可被通用客户端发现并调用工具', async t => {
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const { fileURLToPath } = await import('node:url')
  const { base, root } = await fixture(t)
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../bin/hicanvas-mcp.mjs', import.meta.url))], env: { HICANVAS_URL: base, HICANVAS_CANVAS_DIR: root, HICANVAS_SETTINGS_DIR: `${root}/settings`, HICANVAS_CONVERSATION_KEY: 'stdio-reconnect' }, stderr: 'pipe' })
  const client = new Client({ name: 'generic-mcp-harness', version: '1' })
  await client.connect(transport)
  t.after(() => client.close())
  const tools = await client.listTools()
  assert.ok(tools.tools.some(tool => tool.name === 'open_conversation'))
  const result = await client.callTool({ name: 'open_conversation', arguments: { title: 'stdio 测试' } })
  assert.equal(result.structuredContent.conversation.title, 'stdio 测试')
  const canvas = await client.callTool({ name: 'get_canvas', arguments: { conversationId: result.structuredContent.conversationId } })
  assert.ok(canvas.structuredContent.snapshot.schema)
})
