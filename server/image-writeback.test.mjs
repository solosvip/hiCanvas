import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { fixture } from './test-helpers.mjs'
import { createImageJobs } from './image-jobs.mjs'
import { applyCanvasOperations } from './canvas-operations.mjs'

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhQJ/wR6cvQAAAABJRU5ErkJggg==', 'base64')

async function finished(jobs, id, jobId) {
  for (let i = 0; i < 500; i++) {
    const job = await jobs.get(id, jobId)
    if (job.finished) { await delay(30); return job }
    await delay(10)
  }
  throw new Error('后台任务没有完成')
}

test('16 张并发生成在慢存储上全部写回，同一画板的后台写入不互相争抢版本', async t => {
  const { workspace } = await fixture(t)
  const { id } = await workspace.open()
  const initial = await workspace.read(id)
  const mutate = workspace.mutate.bind(workspace)
  let pendingWrites = 0, maximumWrites = 0, conflicts = 0
  workspace.mutate = async (...args) => {
    pendingWrites++
    maximumWrites = Math.max(maximumWrites, pendingWrites)
    try {
      // 放大磁盘繁忙时读取版本到落盘之间的窗口；仍执行真实存储和版本检查。
      await delay(30)
      return await mutate(...args)
    } catch (error) {
      if (error.storage === 'revision-conflict') conflicts++
      throw error
    } finally { pendingWrites-- }
  }
  const calls = []
  let generated = 0, maximumGenerated = 0, release
  const barrier = new Promise(resolve => { release = resolve })
  const jobs = createImageJobs(workspace, { get: async () => ({ id: 'model' }) }, { generate: async (_model, request) => {
    calls.push(request.prompt)
    generated++; maximumGenerated = Math.max(maximumGenerated, generated)
    if (calls.length === 3) release()
    await barrier
    generated--
    return [{ bytes, extension: 'png' }]
  } })
  const { jobId } = await jobs.submit(id, { expectedRevision: initial.revision, requests: Array.from({ length: 16 }, (_, i) => ({ prompt: `慢存储${i}` })) })
  let job
  for (let i = 0; i < 500; i++) {
    job = await jobs.get(id, jobId)
    if (job.finished && pendingWrites === 0) break
    await delay(10)
  }
  assert.equal(job.finished, true, '后台任务应在期限内结束')
  assert.ok(job.items.every(item => item.status === 'succeeded'), JSON.stringify(job.items.map(({ status, error }) => ({ status, error }))))
  assert.equal(calls.length, 16, '每张只调用一次供应商')
  assert.equal(new Set(calls).size, 16, '每个提示词恰好生成一次')
  assert.equal(maximumGenerated, 3, '生图仍然并发，不能把供应商请求也串行化')
  assert.equal(maximumWrites, 1, '同一画板的后台写入应排队，避免有限重试耗尽')
  assert.equal(conflicts, 0, '没有外部编辑时，后台任务不应自己制造版本冲突')
  const final = await workspace.read(id)
  assert.equal(Object.values(final.snapshot.store).filter(record => record.typeName === 'shape' && record.type === 'image').length, 16)
})

test('外部编辑造成的真实版本冲突仍重读合并，图片不重复生成', async t => {
  const { workspace } = await fixture(t)
  const { id } = await workspace.open()
  const initial = await workspace.read(id)
  const mutate = workspace.mutate.bind(workspace)
  let generated = 0, edited = false, conflicts = 0
  workspace.mutate = async (...args) => {
    if (generated && !edited) {
      edited = true
      const current = await workspace.read(id)
      await mutate(id, current.revision, snapshot => applyCanvasOperations(snapshot, [{ type: 'create_shape', id: 'shape:external-edit', shapeType: 'text', text: '生成期间用户继续写字' }]))
    }
    try { return await mutate(...args) }
    catch (error) { if (error.storage === 'revision-conflict') conflicts++; throw error }
  }
  const jobs = createImageJobs(workspace, { get: async () => ({ id: 'model' }) }, { generate: async () => { generated++; return [{ bytes, extension: 'png' }] } })
  const { jobId } = await jobs.submit(id, { expectedRevision: initial.revision, requests: [{ prompt: '保留用户编辑' }] })
  const job = await finished(jobs, id, jobId)
  assert.equal(conflicts, 1, '确实在读版本后插入一次外部编辑')
  assert.equal(generated, 1, '冲突只重试写回，不重发收费请求')
  assert.equal(job.items[0].status, 'succeeded')
  const final = await workspace.read(id)
  assert.ok(final.snapshot.store['shape:external-edit'], '不能用旧快照覆盖用户编辑')
  assert.equal(Object.values(final.snapshot.store).filter(record => record.typeName === 'shape' && record.type === 'image').length, 1)
})

test('一次画板写回失败后，保留图片并继续处理同一画板的后续任务', async t => {
  const { workspace } = await fixture(t)
  const { id } = await workspace.open()
  const initial = await workspace.read(id)
  const mutate = workspace.mutate.bind(workspace)
  let generated = 0, failed = false
  workspace.mutate = async (...args) => {
    if (generated === 1 && !failed) {
      failed = true
      throw Object.assign(new Error('模拟磁盘暂时不可写'), { status: 503 })
    }
    return mutate(...args)
  }
  const jobs = createImageJobs(workspace, { get: async () => ({ id: 'model' }) }, { concurrency: 1, generate: async () => { generated++; return [{ bytes, extension: 'png' }] } })
  const { jobId } = await jobs.submit(id, { expectedRevision: initial.revision, requests: [{ prompt: '写回会失败' }, { prompt: '后续继续写回' }] })
  const job = await finished(jobs, id, jobId)
  assert.deepEqual(job.items.map(item => item.status), ['saved', 'succeeded'])
  assert.equal(generated, 2, '失败后不重新生成已保存的图片')
  assert.equal(job.items[0].images.length, 1, '首次失败的图片仍可找回')
  assert.equal(job.items[0].error, '模拟磁盘暂时不可写')
  const final = await workspace.read(id)
  assert.equal(Object.values(final.snapshot.store).filter(record => record.typeName === 'shape' && record.type === 'image').length, 1)
})
