import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './test-helpers.mjs'
import { createImageJobs } from './image-jobs.mjs'
import { applyCanvasOperations } from './canvas-operations.mjs'
import { readJsonFile } from './storage.mjs'

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhQJ/wR6cvQAAAABJRU5ErkJggg==', 'base64')

async function finished(jobs, id, jobId) {
  for (let i = 0; i < 500; i++) {
    const job = await jobs.get(id, jobId)
    if (job.finished) { await jobs.waitForIdle(); return jobs.get(id, jobId) }
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
  const job = await finished(jobs, id, jobId)
  assert.equal(job.finished, true, '后台任务应在期限内结束')
  assert.equal(pendingWrites, 0, '收尾不能依赖状态轮询猜测最后一次写入是否结束')
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

test('完成状态先可见时，收尾仍等待最后一次慢写入落定再清理目录', async t => {
  const { workspace, root } = await fixture(t)
  const { id } = await workspace.open()
  const initial = await workspace.read(id)
  const mutate = workspace.mutate.bind(workspace)
  let jobId, lastWriteStarted = false, lastWriteFinished = false
  const lastWrite = Promise.withResolvers()
  const jobs = createImageJobs(workspace, { get: async () => ({ id: 'model' }) }, { generate: async () => [{ bytes, extension: 'png' }] })
  workspace.mutate = async (...args) => {
    if (jobId && (await jobs.get(id, jobId)).finished) {
      lastWriteStarted = true
      try {
        // 稳定越过旧收尾的 30ms；延迟后仍执行真实的最后一次画板落盘。
        await delay(150)
        const result = await mutate(...args)
        lastWriteFinished = true
        return result
      } finally { lastWrite.resolve() }
    }
    return mutate(...args)
  }
  ;({ jobId } = await jobs.submit(id, { expectedRevision: initial.revision, requests: [{ prompt: '收尾必须等落盘' }] }))
  try {
    const job = await finished(jobs, id, jobId)
    assert.equal(job.items[0].status, 'succeeded')
    assert.equal(lastWriteStarted, true, '确实延迟了完成状态之后的最后一次写入')
    assert.equal(lastWriteFinished, true, '开始清理时不能仍有后台写入，否则可能触发 ENOTEMPTY')
    await rm(root, { recursive: true, force: true })
    await assert.rejects(stat(root), { code: 'ENOENT' })
  } finally { if (lastWriteStarted) await lastWrite.promise }
})

test('等待落定包括仍在生成的任务和随后启动的队列，不会提前返回', async t => {
  const { workspace, root } = await fixture(t)
  const { id } = await workspace.open()
  const initial = await workspace.read(id)
  const barrier = Promise.withResolvers()
  let calls = 0
  const jobs = createImageJobs(workspace, { get: async () => ({ id: 'model' }) }, { concurrency: 1, generate: async () => {
    calls++
    await barrier.promise
    return [{ bytes, extension: 'png' }]
  } })
  const { jobId } = await jobs.submit(id, { expectedRevision: initial.revision, requests: [{ prompt: '仍在生成' }, { prompt: '后续排队' }] })
  let settled = false
  const pending = jobs.waitForIdle().then(() => { settled = true })
  try {
    await delay(30)
    assert.equal(settled, false, '供应商尚未返回时，当前空闲的写入链不代表全部落定')
  } finally { barrier.resolve(); await pending }
  assert.equal(calls, 2)
  const persisted = await readJsonFile(join(root, 'image-jobs', `${jobId}.json`))
  assert.deepEqual(persisted.items.map(item => item.status), ['succeeded', 'succeeded'], '后续任务的最终状态也已持久化')
  const final = await workspace.read(id)
  assert.equal(Object.values(final.snapshot.store).filter(record => record.typeName === 'shape' && record.type === 'image').length, 2)
})
