import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareRexReceiver, deliverRexRequest } from './rex-delivery.mjs'
import { createAgentRequests } from './agent-requests.mjs'
import { fixture } from './test-helpers.mjs'
import { applyCanvasOperations } from './canvas-operations.mjs'

const receiver = { kind: 'rex', sessionId: 'session:test', blockId: 'block:test' }
test('REX 回传只发到原 AI 进程，不会把用户提示词输入 shell，也不执行客户端指定的程序', async () => {
  const calls = []
  let foreground = { name: 'codex', pid: 321 }
  const invoke = async (_receiver, method, args) => {
    calls.push({ method, args })
    return { foreground }
  }
  const target = await prepareRexReceiver({ ...receiver, binary: '/untrusted/program' }, invoke)
  assert.equal(target.binary, undefined)
  await deliverRexRequest(target, 'conv-id', 'request-id', invoke)
  assert.match(calls.at(-1).args.data, /get_canvas_requests/)
  assert.match(calls.at(-1).args.data, /conv-id/)
  foreground = { name: 'zsh', pid: 654 }
  await assert.rejects(deliverRexRequest(target, 'conv-id', 'request-id', invoke), /原 Agent 已退出/)
  await assert.rejects(prepareRexReceiver(receiver, invoke), /没有正在运行的 AI/)
  await assert.rejects(prepareRexReceiver({ ...receiver, server: 'https://other.test' }, invoke), /本机 Unix socket/)
})

test('并发重复点击只投递一次；迟到的回执不回退终态，新任务可再次使用同一目标', async t => {
  const { workspace } = await fixture(t)
  const { id } = await workspace.open()
  const current = await workspace.read(id)
  await workspace.mutate(id, current.revision, snapshot => applyCanvasOperations(snapshot, [{ type: 'create_shape', id: 'shape:target', shapeType: 'frame', meta: { cowartAiDraftHolder: true } }]))
  let release, deliveries = 0
  const barrier = new Promise(resolve => { release = resolve })
  const requests = createAgentRequests(workspace, { prepare: async r => r, deliver: async () => { deliveries++; await barrier; return { status: 'delivered' } } })
  await requests.connect(id, receiver)
  const input = { prompt: '制作网页', clientRequestId: 'double-click', context: { targetShapeId: 'shape:target' } }
  const first = requests.submit(id, input)
  while (!deliveries) await new Promise(resolve => setTimeout(resolve, 5))
  const second = await requests.submit(id, input)
  assert.equal(deliveries, 1)
  const [claimed] = await requests.list(id, { claimBy: 'agent' })
  await requests.complete(id, claimed.id, { status: 'completed', claimBy: 'agent' })
  release(); await first
  const finished = (await workspace.read(id)).snapshot.store['shape:target'].meta.hicanvasGeneration
  assert.equal(finished.status, 'completed')
  assert.equal(second.id, claimed.id)
  const next = await requests.submit(id, { ...input, clientRequestId: 'next-click' })
  assert.equal((await workspace.read(id)).snapshot.store['shape:target'].meta.hicanvasGeneration.requestId, next.id)
  assert.equal(deliveries, 2)
})

test('已通知但未领取的请求，接收进程更换后重新唤起新 Agent', async t => {
  const { workspace } = await fixture(t)
  const { id } = await workspace.open()
  const recipients = []
  const requests = createAgentRequests(workspace, { prepare: async r => r, deliver: async r => { recipients.push(r.pid); return { status: 'delivered' } } })
  await requests.connect(id, { ...receiver, pid: 1 })
  await requests.submit(id, { prompt: '先保存请求' })
  await requests.connect(id, { ...receiver, pid: 2 })
  assert.deepEqual(recipients, [1, 2])
})

test('画板请求经绑定接收器发出；持久化后重连可领取，重复点击标识不会重复派发', async t => {
  const { workspace } = await fixture(t)
  const { id } = await workspace.open()
  const received = []
  const options = { prepare: async r => r, deliver: async (r, conversationId, requestId) => { received.push({ r, conversationId, requestId }); return { status: 'delivered' } } }
  const requests = createAgentRequests(workspace, options)
  await requests.connect(id, receiver)
  const first = await requests.submit(id, { prompt: '请制作影片', clientRequestId: 'same-click' })
  await requests.submit(id, { prompt: '请制作影片', clientRequestId: 'same-click' })
  assert.equal(received.length, 1)
  assert.equal(received[0].conversationId, id)
  assert.equal(received[0].requestId, first.id)
  const reopened = createAgentRequests(workspace, options)
  assert.equal((await reopened.list(id, { claimBy: 'agent-a' }))[0].id, first.id)
  assert.equal((await reopened.list(id, { claimBy: 'agent-b' })).length, 0)
  await assert.rejects(reopened.complete(id, first.id, { status: 'completed', claimBy: 'agent-b' }), /另一 Agent/)
  await reopened.complete(id, first.id, { status: 'completed', claimBy: 'agent-a' })
  assert.equal((await reopened.list(id)).length, 0)
})
