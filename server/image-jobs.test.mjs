import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { fixture } from './test-helpers.mjs'
import { createImageJobs } from './image-jobs.mjs'
import { applyCanvasOperations } from './canvas-operations.mjs'
import { readJsonFile, writeJsonAtomic } from './storage.mjs'
import { join } from 'node:path'

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhQJ/wR6cvQAAAABJRU5ErkJggg==', 'base64')
async function finished(jobs, id, jobId) {
  for (let i = 0; i < 300; i++) {
    const job = await jobs.get(id, jobId)
    if (job.finished) { await jobs.waitForIdle(); return jobs.get(id, jobId) }
    await delay(10)
  }
  throw new Error('后台任务没有完成')
}

test('16 张一次建好 4×4 占位，后台限并发执行；切默认模型和编辑画布不改变任务或丢数据', async t => {
  const { workspace } = await fixture(t)
  const { id } = await workspace.open()
  const initial = await workspace.read(id)
  const pageId = Object.values(initial.snapshot.store).find(r => r.typeName === 'page').id
  let activeModel = 'model-a', active = 0, maximum = 0
  const calls = []
  let release
  const barrier = new Promise(resolve => { release = resolve })
  const jobs = createImageJobs(workspace, { get: async id => ({ id: id || activeModel }) }, { generate: async (model, request) => {
    calls.push({ model: model.id, prompt: request.prompt }); active++; maximum = Math.max(maximum, active)
    await barrier; active--
    return [{ bytes, extension: 'png' }]
  } })
  const result = await jobs.submit(id, { expectedRevision: initial.revision, pageId, requests: Array.from({ length: 16 }, (_, i) => ({ prompt: `独立主题${i}` })) })
  const reserved = await workspace.read(id)
  const holders = Object.values(reserved.snapshot.store).filter(r => r.meta?.cowartAiImageHolder)
  assert.equal(holders.length, 16)
  assert.equal(new Set(holders.map(r => r.x)).size, 4)
  assert.equal(new Set(holders.map(r => r.y)).size, 4)
  while (calls.length !== 3) await delay(5)
  activeModel = 'model-b'
  // 任务尚未结束时用户的编辑必须保留；内部写回发生冲突也不能再调用供应商。
  await workspace.mutate(id, (await workspace.read(id)).revision, snapshot => applyCanvasOperations(snapshot, [{ type: 'create_shape', id: 'shape:user', shapeType: 'text', parentId: holders[0].id, x: 24, y: 32, text: '生成期间手写的说明' }]))
  const other = await workspace.open()
  release()
  const job = await finished(jobs, id, result.jobId)
  assert.equal(calls.length, 16)
  assert.equal(new Set(calls.map(c => c.prompt)).size, 16)
  assert.deepEqual([...new Set(calls.map(c => c.model))], ['model-a'])
  assert.ok(maximum <= 3)
  assert.ok(job.items.every(item => item.status === 'succeeded'), JSON.stringify(job.items.map(({ id, status, error }) => ({ id, status, error }))))
  const final = await workspace.read(id)
  assert.ok(final.snapshot.store['shape:user'])
  assert.equal(final.snapshot.store['shape:user'].parentId, pageId)
  assert.equal(final.snapshot.store['shape:user'].x, holders[0].x + 24)
  assert.equal(final.snapshot.store['shape:user'].y, holders[0].y + 32)
  const targetImage = Object.values(final.snapshot.store).find(r => r.typeName === 'shape' && r.type === 'image' && r.x === holders[0].x && r.y === holders[0].y)
  assert.ok(final.snapshot.store['shape:user'].index > targetImage.index, '用户新增文字仍在结果图上方可见')
  assert.equal(Object.values(final.snapshot.store).filter(r => r.typeName === 'shape' && r.type === 'image').length, 16)
  assert.equal(Object.values((await workspace.read(other.id)).snapshot.store).filter(r => r.typeName === 'shape' && r.type === 'image').length, 0)
  await assert.rejects(jobs.get(other.id, result.jobId), /找不到/)
})

test('服务重启只恢复尚未发送的队列，中断的收费请求不会自动重发', async t => {
  const { workspace, root } = await fixture(t)
  const { id } = await workspace.open()
  const current = await workspace.read(id)
  const pageId = Object.values(current.snapshot.store).find(r => r.typeName === 'page').id
  const models = { get: async () => ({ id: 'model' }) }
  const paused = createImageJobs(workspace, models, { concurrency: 0 })
  const job = await paused.submit(id, { pageId, expectedRevision: current.revision, requests: [{ prompt: '已发出但未收回' }, { prompt: '尚未发出' }] })
  await paused.waitForIdle()
  assert.deepEqual((await paused.get(id, job.jobId)).items.map(item => item.status), ['queued', 'queued'], '等待落定不应启动刻意暂停的队列')
  const path = join(root, 'image-jobs', `${job.jobId}.json`)
  const persisted = await readJsonFile(path)
  persisted.items[0].status = 'running'
  await writeJsonAtomic(path, persisted)
  const calls = []
  const restarted = createImageJobs(workspace, models, { generate: async (_model, { prompt }) => { calls.push(prompt); return [{ bytes, extension: 'png' }] } })
  const result = await finished(restarted, id, job.jobId)
  assert.deepEqual(calls, ['尚未发出'])
  assert.deepEqual(result.items.map(r => r.status), ['interrupted', 'succeeded'])
})

test('删除目标后保留生成结果；某一张失败不妨碍其余图片，不自动重试收费请求', async t => {
  const { workspace } = await fixture(t)
  const { id } = await workspace.open()
  const initial = await workspace.read(id)
  const pageId = Object.values(initial.snapshot.store).find(r => r.typeName === 'page').id
  let release
  const barrier = new Promise(resolve => { release = resolve })
  let calls = 0
  const jobs = createImageJobs(workspace, { get: async () => ({ id: 'model' }) }, { generate: async (_model, { prompt }) => {
    calls++; await barrier
    if (prompt === '失败') throw Object.assign(new Error('模拟服务错误'), { status: 502 })
    return [{ bytes, extension: 'png' }]
  } })
  const result = await jobs.submit(id, { expectedRevision: initial.revision, pageId, requests: [{ prompt: '被删框' }, { prompt: '失败' }, { prompt: '成功' }] })
  // 等待已发送，再删除目标。
  while (calls !== 3) await delay(5)
  const current = await workspace.read(id)
  await workspace.mutate(id, current.revision, snapshot => applyCanvasOperations(snapshot, [{ type: 'delete', ids: [result.items[0].holderId] }]))
  release()
  const job = await finished(jobs, id, result.jobId)
  assert.deepEqual(job.items.map(item => item.status), ['saved', 'failed', 'succeeded'])
  assert.equal(calls, 3)
  const final = await workspace.read(id)
  assert.equal(final.snapshot.store[result.items[0].holderId], undefined)
  assert.equal(job.items[0].images.length, 1)
})
