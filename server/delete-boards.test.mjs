import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fixture } from './test-helpers.mjs'
import { createConversations } from './conversations.mjs'
import { executeCanvasCommands } from '../engine/index.js'
import { createImageJobs } from './image-jobs.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createHiCanvasMcp } from '../mcp/server.mjs'
import { createAgentRequests } from './agent-requests.mjs'
import { withFileLock } from './file-lock.mjs'

test('删除只移除目标画板，保留文件；旧绑定和重启不会复活，最后一个也能删除', async t => {
  const { workspace, api, root } = await fixture(t)
  const a = await workspace.open({ bindingKey: 'chat-a' })
  const b = await workspace.open({ title: '保留的画板' })
  const state = await workspace.read(a.id)
  const path = join(root, 'conversations', a.id, 'state.json')
  const original = await readFile(path, 'utf8')
  const missingVersion = await api(`/api/conversations/${a.id}`, 'DELETE', {})
  assert.equal(missingVersion.status, 428)
  const result = await api(`/api/conversations/${a.id}`, 'DELETE', { expectedRevision: state.revision })
  assert.equal(result.status, 200)
  assert.equal(result.body.nextConversationId, b.id)
  assert.deepEqual((await workspace.list()).map(c => c.id).sort(), ['legacy', b.id].sort())
  assert.equal(await readFile(path, 'utf8'), original)
  assert.equal((await api(`/api/canvas?conversation=${a.id}`)).status, 410)
  assert.equal((await api('/api/conversations/open', 'POST', { bindingKey: 'chat-a' })).status, 410)
  assert.equal((await api(`/api/conversations/${a.id}`, 'PUT', { title: '复活' })).status, 410)
  assert.equal((await api(`/api/conversations/${a.id}`, 'DELETE', { expectedRevision: state.revision })).status, 200)
  const restarted = createConversations(root)
  for (const c of await restarted.list()) await restarted.remove(c.id, (await restarted.read(c.id)).revision)
  assert.deepEqual(await createConversations(root).list(), [])
  await assert.rejects(restarted.open({ conversationId: 'legacy' }), e => e.status === 410)
  const fresh = await restarted.open({ bindingKey: 'chat-a', createNew: true, title: '重新开始' })
  assert.notEqual(fresh.id, a.id)
  assert.equal((await restarted.open({ bindingKey: 'chat-a' })).id, fresh.id)
})

test('删除与保存使用同一画板锁，已变化的版本拒绝删除，删除后迟到写入也被拒绝', async t => {
  const { workspace, root } = await fixture(t)
  const { id } = await workspace.open()
  const state = await workspace.read(id)
  let entered, release
  const inside = new Promise(resolve => { entered = resolve })
  const barrier = new Promise(resolve => { release = resolve })
  const save = workspace.mutate(id, state.revision, async snapshot => {
    entered(); await barrier
    return executeCanvasCommands(snapshot, [{ type: 'create_shape', shapeType: 'text', text: '并发修改保留' }]).snapshot
  })
  await inside
  const deletion = workspace.remove(id, state.revision)
  release()
  const updated = await save
  await assert.rejects(deletion, e => e.storage === 'revision-conflict')
  assert.ok((await workspace.list()).some(c => c.id === id))
  await workspace.remove(id, updated.revision)
  const deleted = await readFile(join(root, 'conversations', id, 'state.json'), 'utf8')
  await assert.rejects(workspace.mutate(id, updated.revision, s => s), e => e.status === 410)
  await assert.rejects(workspace.sidecar(id, 'view', { currentPageId: 'page:page', camera: { x: 0, y: 0, z: 1 } }), e => e.status === 410)
  assert.equal(await readFile(join(root, 'conversations', id, 'state.json'), 'utf8'), deleted)
})

test('删除会通知已打开窗口，原画板资源及请求不再可访问', async t => {
  const { workspace, api, base } = await fixture(t)
  const { id } = await workspace.open()
  const state = await workspace.read(id)
  const controller = new AbortController()
  t.after(() => controller.abort())
  const stream = await fetch(`${base}/api/canvas-events?conversation=${id}`, { signal: controller.signal })
  const reader = stream.body.getReader()
  await reader.read()
  assert.equal((await api(`/api/conversations/${id}`, 'DELETE', { expectedRevision: state.revision })).status, 200)
  const notification = new TextDecoder().decode((await reader.read()).value)
  assert.match(notification, /event: canvas-deleted/)
  assert.match(notification, new RegExp(id))
  assert.equal((await api(`/api/agent/requests?conversation=${id}`, 'POST', { prompt: '迟到请求' })).status, 410)
  assert.equal((await fetch(`${base}/c/${id}/assets/missing.png`)).status, 410)
  controller.abort()
})

test('删除画板后未发送的图片不再调用模型，已发出图片保存但不复活画板', async t => {
  const { workspace, root } = await fixture(t)
  const { id } = await workspace.open()
  let started, release, calls = 0
  const entered = new Promise(resolve => { started = resolve })
  const barrier = new Promise(resolve => { release = resolve })
  const jobs = createImageJobs(workspace, { get: async () => ({ id: 'mock' }) }, { concurrency: 1, generate: async () => {
    calls++; started(); await barrier
    return [{ bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'), extension: 'png' }]
  } })
  const job = await jobs.submit(id, { expectedRevision: (await workspace.read(id)).revision, requests: Array.from({ length: 3 }, () => ({ prompt: '合成测试' })) })
  await entered
  await workspace.remove(id, (await workspace.read(id)).revision)
  release()
  let persisted
  for (let i = 0; i < 200; i++) {
    persisted = JSON.parse(await readFile(join(root, 'image-jobs', `${job.jobId}.json`), 'utf8'))
    if (persisted.items.every(item => !['queued', 'running'].includes(item.status))) break
    await delay(10)
  }
  assert.equal(calls, 1)
  assert.deepEqual(persisted.items.map(item => item.status), ['saved', 'cancelled', 'cancelled'])
  assert.equal(persisted.items[0].images.length, 1)
  assert.ok(!(await workspace.list()).some(c => c.id === id))
  await assert.rejects(workspace.read(id), e => e.status === 410)
})

test('真实 MCP 删除工具声明破坏性、检查版本，并保留已删除绑定直到明确新建', async t => {
  const { base } = await fixture(t)
  const server = createHiCanvasMcp({ baseUrl: base, receiver: null })
  const client = new Client({ name: 'delete-boards-test', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a); await client.connect(b)
  t.after(async () => { await client.close(); await server.close() })
  const tool = (await client.listTools()).tools.find(item => item.name === 'delete_conversation')
  assert.equal(tool?.annotations.destructiveHint, true)
  const opened = (await client.callTool({ name: 'open_conversation', arguments: {} })).structuredContent
  const result = await client.callTool({ name: 'delete_conversation', arguments: { conversationId: opened.conversationId, expectedRevision: opened.revision } })
  assert.equal(result.isError, undefined)
  assert.equal(result.structuredContent.ok, true)
  assert.equal((await client.callTool({ name: 'open_conversation', arguments: {} })).isError, true)
  assert.equal((await client.callTool({ name: 'open_conversation', arguments: { createNew: true } })).isError, undefined)
})

test('删除与 Agent 请求共享生命周期锁，等待旧锁的领取不会越过删除边界', async t => {
  const { workspace, root } = await fixture(t)
  const { id } = await workspace.open()
  const requests = createAgentRequests(workspace, { deliver: async () => ({ status: 'waiting' }) })
  await requests.submit(id, { prompt: '合成请求', context: {} })
  const revision = (await workspace.read(id)).revision
  let entered, claim, deletion
  const inside = new Promise(resolve => { entered = resolve })
  const original = workspace.withActiveConversation
  workspace.withActiveConversation = (id, operation) => original(id, () => { entered(); return operation() })
  const order = []
  await withFileLock(join(root, 'agent-requests', `${id}.json.lock`), async () => {
    claim = requests.list(id, { claimBy: 'first-agent' }).then(result => { order.push('claim'); return result })
    await inside
    deletion = workspace.remove(id, revision).then(result => { order.push('delete'); return result })
  })
  await claim; await deletion
  assert.deepEqual(order, ['claim', 'delete'])
  await assert.rejects(requests.list(id, { claimBy: 'late-agent' }), e => e.status === 410)
  await assert.rejects(requests.submit(id, { prompt: '迟到请求' }), e => e.status === 410)
})
