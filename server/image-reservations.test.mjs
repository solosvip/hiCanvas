import '../tools/test-sandbox.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './test-helpers.mjs'
import { createImageJobs } from './image-jobs.mjs'

test('预留整批有一项不能复用时，已有标记、新框、画板版本和供应商均不变', async t => {
  const { workspace } = await fixture(t)
  const { id } = await workspace.open()
  const initial = await workspace.read(id)
  const setup = await workspace.submitCommands(id, initial.revision, 'test', snapshot => [
    { type: 'create_shape', id: 'shape:valid', shapeType: 'frame', meta: { cowartAiImageHolder: true, keep: '用户数据' } },
    { type: 'create_shape', id: 'shape:ordinary', shapeType: 'frame' },
    { type: 'create_shape', id: 'shape:busy', shapeType: 'frame', meta: { cowartAiImageHolder: true, hicanvasGeneration: { itemId: 'previous', status: 'running' } } }
  ])
  let calls = 0
  const jobs = createImageJobs(workspace, { get: async () => ({ id: 'model' }) }, { generate: async () => { calls++; return [] } })
  t.after(() => jobs.waitForIdle())
  for (const [holderId, status, message] of [
    ['shape:ordinary', 400, '只能替换 AI 图片占位框；改图请在原图旁新建目标。'],
    ['shape:busy', 409, '这个图片框正在生成，请等待当前任务完成。']
  ]) {
    await assert.rejects(jobs.submit(id, { expectedRevision: setup.revision, requests: [
      { prompt: '会先复用有效框', anchorShapeId: 'shape:valid' },
      { prompt: '会先新建框' },
      { prompt: '本项不合法', anchorShapeId: holderId }
    ] }), error => error.status === status && error.message === message)
    await jobs.waitForIdle()
    const after = await workspace.read(id)
    assert.equal(after.revision, setup.revision)
    assert.deepEqual(after.snapshot, setup.snapshot)
    assert.equal(calls, 0)
  }
})

test('预留之后写状态遇到用户移动、改名和元数据编辑，重读后保留全部修改', async t => {
  const { workspace } = await fixture(t)
  const { id } = await workspace.open()
  const initial = await workspace.read(id)
  const submitCommands = workspace.submitCommands.bind(workspace)
  let writes = 0, holderId, conflicts = 0, generated = 0
  workspace.submitCommands = async (...args) => {
    if (++writes === 2) {
      const current = await workspace.read(id)
      holderId = Object.values(current.snapshot.store).find(shape => shape.meta?.cowartAiImageHolder).id
      await submitCommands(id, current.revision, 'test', snapshot => [{ type: 'update', id: holderId, changes: { x: 123, y: 456, props: { name: '用户刚改的名字' }, meta: { note: { text: '用户备注' }, cowartAiDraftHolder: true } } }])
    }
    try { return await submitCommands(...args) }
    catch (error) { if (error.storage === 'revision-conflict') conflicts++; throw error }
  }
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  const jobs = createImageJobs(workspace, { get: async () => ({ id: 'model' }) }, { generate: async () => {
    generated++; entered.resolve(); await release.promise
    return []
  } })
  const result = await jobs.submit(id, { expectedRevision: initial.revision, requests: [{ prompt: '状态不能覆盖用户的修改' }] })
  try {
    await entered.promise
    const running = (await workspace.read(id)).snapshot.store[holderId]
    assert.equal(conflicts, 1, '确实在状态写入前插入用户编辑，触发重读')
    assert.equal(running.x, 123)
    assert.equal(running.y, 456)
    assert.equal(running.props.name, '用户刚改的名字')
    assert.deepEqual(running.meta.note, { text: '用户备注' })
    assert.equal(running.meta.cowartAiDraftHolder, true)
    assert.deepEqual(running.meta.hicanvasGeneration, { jobId: result.jobId, itemId: result.items[0].id, status: 'running' })
    assert.equal(generated, 1)
  } finally { release.resolve(); await jobs.waitForIdle() }
})

test('预留之后目标被新任务接管，迟到状态不能覆盖新 itemId 或用户元数据', async t => {
  const { workspace } = await fixture(t)
  const { id } = await workspace.open()
  const initial = await workspace.read(id)
  const submitCommands = workspace.submitCommands.bind(workspace)
  let writes = 0, holderId
  const nextStatus = { jobId: 'new-job', itemId: 'new-item', status: 'queued' }
  workspace.submitCommands = async (...args) => {
    if (++writes === 2) {
      const current = await workspace.read(id)
      holderId = Object.values(current.snapshot.store).find(shape => shape.meta?.cowartAiImageHolder).id
      await submitCommands(id, current.revision, 'test', snapshot => [{ type: 'update', id: holderId, changes: { meta: { hicanvasGeneration: nextStatus, userNote: '新任务保留' } } }])
    }
    return submitCommands(...args)
  }
  const jobs = createImageJobs(workspace, { get: async () => ({ id: 'model' }) }, { generate: async () => { throw Object.assign(new Error('合成失败'), { status: 502 }) } })
  const result = await jobs.submit(id, { expectedRevision: initial.revision, requests: [{ prompt: '迟到状态' }] })
  await jobs.waitForIdle()
  const after = (await workspace.read(id)).snapshot.store[holderId]
  assert.deepEqual(after.meta.hicanvasGeneration, nextStatus)
  assert.equal(after.meta.userNote, '新任务保留')
  assert.equal((await jobs.get(id, result.jobId)).items[0].status, 'failed')
})

test('本机批量接口保持忙碌框和已删目标的 409，以及参数错误的 400 和原文案', async t => {
  const { workspace, api, base } = await fixture(t)
  const { id } = await workspace.open()
  const initial = await workspace.read(id)
  const setup = await workspace.submitCommands(id, initial.revision, 'test', snapshot => [
    { type: 'create_shape', id: 'shape:busy', shapeType: 'frame', meta: { cowartAiImageHolder: true, hicanvasGeneration: { itemId: 'previous', status: 'running' } } },
    { type: 'create_shape', id: 'shape:ordinary', shapeType: 'frame' }
  ])
  const model = await api('/api/image-models', 'POST', { name: '隔离模拟配置', protocol: 'openai-images', baseUrl: `${base}/synthetic-provider`, model: 'synthetic', apiKey: 'synthetic-test-only' })
  assert.equal(model.status, 200)
  const pageId = Object.values(setup.snapshot.store).find(record => record.typeName === 'page').id
  for (const [args, status, message] of [
    [{ requests: [{ prompt: '忙碌', anchorShapeId: 'shape:busy' }] }, 409, '这个图片框正在生成，请等待当前任务完成。'],
    [{ anchorShapeId: 'shape:deleted', requests: [{ prompt: '已删' }] }, 409, '原目标框已删除。'],
    [{ requests: [{ prompt: '普通框', anchorShapeId: 'shape:ordinary' }] }, 400, '只能替换 AI 图片占位框；改图请在原图旁新建目标。'],
    [{ requests: [{ prompt: '误把页面当图片框', anchorShapeId: pageId }] }, 400, '只能替换 AI 图片占位框；改图请在原图旁新建目标。'],
    [{ columns: 0, requests: [{ prompt: '列数' }] }, 400, '每行数量需要 1 至 16。'],
    [{ gap: -1, requests: [{ prompt: '间距' }] }, 400, '图片框尺寸或间距无效。'],
    [{ requests: [{ prompt: '比例', aspectRatio: '0:1' }] }, 400, '图片比例请填写宽:高。']
  ]) {
    const response = await api(`/api/images/jobs?conversation=${id}`, 'POST', { expectedRevision: setup.revision, ...args })
    assert.equal(response.status, status)
    assert.equal(response.body.error, message)
    const after = await workspace.read(id)
    assert.equal(after.revision, setup.revision)
    assert.deepEqual(after.snapshot, setup.snapshot)
  }
})
