import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readJsonFile, writeJsonAtomic } from './storage.mjs'
import { withFileLock, httpError } from './file-lock.mjs'
import { getCanvasEvents } from './events.mjs'
import { prepareRexReceiver, deliverRexRequest } from './rex-delivery.mjs'

export function createAgentRequests(workspace, { prepare = prepareRexReceiver, deliver = deliverRexRequest } = {}) {
  const events = getCanvasEvents(workspace)
  const file = id => join(workspace.root, 'agent-requests', `${id}.json`)
  async function markTarget(id, request, status) {
    if (!request.context.targetShapeId) return
    // 状态文件锁与目标框更新保持同序；迟到的投递回执不能回退已完成状态。
    return update(id, async state => {
      const actual = state.requests.find(r => r.id === request.id)
      const latest = state.requests.findLast(r => r.context.targetShapeId === request.context.targetShapeId)
      if (!actual || latest?.id !== request.id) return
      const next = ['completed', 'failed'].includes(actual.status) ? actual.status : actual.status === 'working' ? 'working' : status
      for (let i = 0; i < 4; i++) {
        const current = await workspace.read(id)
        const shape = current.snapshot.store[request.context.targetShapeId]
        if (shape?.type !== 'frame') return
        try {
          const result = await workspace.mutate(id, current.revision, snapshot => {
            snapshot.store[shape.id].meta.hicanvasGeneration = { requestId: request.id, status: next, ...(actual.message ? { error: actual.message } : {}) }
            return snapshot
          })
          events.broadcast(result)
          return
        } catch (e) { if (e.storage !== 'revision-conflict') throw e }
      }
    })
  }
  async function update(id, fn, readOnly = false) {
    await workspace.requireConversation(id)
    return withFileLock(`${file(id)}.lock`, async () => {
      let state
      try { state = await readJsonFile(file(id)) } catch (e) { if (e.code !== 'ENOENT') throw e; state = { receiver: null, requests: [] } }
      const result = await fn(state)
      if (!readOnly) await writeJsonAtomic(file(id), state)
      return result
    })
  }
  async function notify(id, request, force = false) {
    const attemptId = randomUUID()
    const claim = await update(id, state => {
      const current = state.requests.find(r => r.id === request.id)
      const busy = current.delivery?.status === 'dispatching' && current.delivery.startedAt > Date.now() - 60000
      if (['completed', 'failed'].includes(current.status) || (!force && (busy || current.delivery?.status === 'delivered'))) return { skip: current }
      current.delivery = { status: 'dispatching', attemptId, startedAt: Date.now() }
      return { receiver: state.receiver }
    })
    if (claim.skip) return claim.skip
    let delivery
    try { delivery = await deliver(claim.receiver, id, request.id) }
    catch { delivery = { status: 'waiting', message: '请求已保存，Agent 暂时无法接收；重新连接后可继续处理。' } }
    const updated = await update(id, state => {
      const current = state.requests.find(r => r.id === request.id)
      if (current.delivery?.attemptId === attemptId) current.delivery = delivery
      return current
    })
    await markTarget(id, updated, updated.delivery?.status === 'waiting' ? 'waiting' : 'pending')
    return updated
  }
  async function connect(id, receiver) {
    const prepared = receiver ? await prepare(receiver) : null
    const changed = await update(id, state => {
      const changed = JSON.stringify(state.receiver) !== JSON.stringify(prepared)
      state.receiver = prepared
      return changed
    })
    const pending = await list(id)
    for (const request of pending) if (changed || request.delivery?.status !== 'delivered') await notify(id, request, changed)
    return { connected: !!prepared, mode: prepared ? 'rex' : 'mcp', pending: pending.length }
  }
  async function submit(id, input) {
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 64000) throw httpError('请求描述需要 1 至 64000 个字符。')
    if (input.context !== undefined && (!input.context || typeof input.context !== 'object' || Array.isArray(input.context))) throw httpError('请求上下文无效。')
    if (input.content !== undefined && (!Array.isArray(input.content) || JSON.stringify(input.content).length > 30 * 1024 * 1024)) throw httpError('请求附件无效或过大。')
    const request = await update(id, state => {
      const duplicate = input.clientRequestId && state.requests.find(r => r.clientRequestId === input.clientRequestId)
      if (duplicate) return duplicate
      if (input.context?.targetShapeId && state.requests.some(r => r.context.targetShapeId === input.context.targetShapeId && ['pending', 'working'].includes(r.status))) throw httpError('这个目标已有待处理任务，请等待完成。', 409)
      const value = { id: randomUUID(), conversationId: id, prompt: input.prompt, content: input.content || [], context: input.context || {}, status: 'pending', createdAt: new Date().toISOString(), clientRequestId: input.clientRequestId }
      state.requests.push(value)
      return value
    })
    if (request.delivery?.status === 'delivered') return request
    await markTarget(id, request, 'pending')
    return notify(id, request)
  }
  async function list(id, { requestId, claimBy, includeFinished = false } = {}) {
    const requests = await update(id, state => state.requests.filter(r => (!requestId || r.id === requestId) && (includeFinished || !['completed', 'failed'].includes(r.status))).map(r => {
      if (claimBy) {
        if (r.claimedBy && r.claimedBy !== claimBy && r.claimExpiresAt > Date.now()) return null
        r.claimedBy = claimBy; r.claimExpiresAt = Date.now() + 10 * 60 * 1000; r.status = 'working'
      }
      return r
    }).filter(Boolean), !claimBy)
    if (claimBy) for (const request of requests) await markTarget(id, request, 'working')
    return requests
  }
  async function complete(id, requestId, input) {
    const request = await update(id, state => {
      const request = state.requests.find(r => r.id === requestId)
      if (!request) throw httpError('找不到这个画板请求。', 404)
      if (input.claimBy && request.claimedBy && request.claimedBy !== input.claimBy) throw httpError('这个请求已由另一 Agent 领取。', 409)
      if (!['completed', 'failed'].includes(input.status)) throw httpError('完成状态无效。')
      request.status = input.status; request.message = String(input.message || '').slice(0, 2000); request.finishedAt = new Date().toISOString()
      return request
    })
    await markTarget(id, request, input.status)
    return request
  }
  return { connect, submit, list, complete }
}
